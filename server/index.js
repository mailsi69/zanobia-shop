'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { db, getSetting, setSetting, allSettings, seed, DATA_DIR, DB_FILE, backupTo } = require('./db');
const { sign, requireAuth, requireRole } = require('./lib/auth');
const { calcShipping, US_STATES } = require('./lib/shipping');
const { calcTax } = require('./lib/tax');
const { startPayment, confirmPayment, refundPayment, paymentMode, publishableKey } = require('./lib/payment');
const { sendMail, orderEmails } = require('./lib/email');

seed(); // ensure schema + demo data + admin accounts on boot

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // correct client IPs behind Render/other proxies

// Security headers (lightweight; no external deps).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('⚠ JWT_SECRET is not set. Set a long random JWT_SECRET in production for secure logins.');
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const PUB = path.join(__dirname, '..', 'public');
// Uploaded product images. On a host with a persistent disk, set DATA_DIR so both
// the database and the photos live on the disk and survive redeploys.
const UPLOADS = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(PUB, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

/* ── Helpers ──────────────────────────────────────────────── */
const J = (v, d) => { try { return JSON.parse(v); } catch { return d; } };

// Store an opted-in customer for future deals (only called with consent).
function upsertCustomer({ email, name, phone, state, spentCents = 0 }) {
  if (!email) return;
  db.prepare(`INSERT INTO customers (email,name,phone,state,marketing_consent,orders_count,total_spent_cents)
    VALUES (@email,@name,@phone,@state,1,1,@spent)
    ON CONFLICT(email) DO UPDATE SET
      name=COALESCE(NULLIF(excluded.name,''),customers.name),
      phone=COALESCE(NULLIF(excluded.phone,''),customers.phone),
      state=COALESCE(NULLIF(excluded.state,''),customers.state),
      marketing_consent=1,
      orders_count=customers.orders_count+1,
      total_spent_cents=customers.total_spent_cents+@spent,
      updated_at=datetime('now')`)
    .run({ email: String(email).toLowerCase(), name: name || '', phone: phone || '', state: state || '', spent: spentCents });
}
function pubProduct(r) {
  return {
    id: r.id, title: r.title, slug: r.slug, description: r.description,
    price_cents: r.price_cents, compare_at_cents: r.compare_at_cents,
    category: r.category, sizes: J(r.sizes, []), colors: J(r.colors, []),
    images: J(r.images, []), stock: r.stock, weight_oz: r.weight_oz,
    status: r.status, featured: !!r.featured, tags: J(r.tags, []),
    seo_title: r.seo_title, seo_description: r.seo_description,
    on_sale: !!(r.compare_at_cents && r.compare_at_cents > r.price_cents)
  };
}
function storePublic() {
  const s = allSettings();
  return {
    store_name: s.store_name, tagline: s.tagline, currency: s.currency,
    phone: s.phone, address: s.address, store_email: s.store_email,
    social: s.social, seo_title: s.seo_title, seo_description: s.seo_description,
    promo_code: s.promo_code, promo_percent: s.promo_percent,
    free_ship_threshold_cents: s.free_ship_threshold_cents,
    collect_customer_data: s.collect_customer_data,
    marketing_consent_label: s.marketing_consent_label,
    privacy_policy: s.privacy_policy,
    payment_mode: paymentMode, stripe_pk: publishableKey,
    states: US_STATES
  };
}

/* ── Pricing engine (single source of truth) ──────────────── */
function buildQuote({ items = [], address = {}, code = '', email = '' }) {
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error('Your cart is empty.'); e.code = 'EMPTY'; throw e;
  }
  const getP = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  let subtotal = 0, fullPriceSubtotal = 0;

  for (const it of items) {
    const p = getP.get(it.id);
    if (!p || p.status !== 'active') { const e = new Error('An item is no longer available.'); e.code = 'GONE'; throw e; }
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    if (p.stock < qty) { const e = new Error(`Only ${p.stock} left of "${p.title}".`); e.code = 'STOCK'; throw e; }
    const line = { id: p.id, title: p.title, slug: p.slug, price_cents: p.price_cents,
      qty, size: it.size || null, weight_oz: p.weight_oz,
      image: J(p.images, [])[0] || null, on_sale: !!(p.compare_at_cents && p.compare_at_cents > p.price_cents) };
    lines.push(line);
    subtotal += p.price_cents * qty;
    if (!line.on_sale) fullPriceSubtotal += p.price_cents * qty;
  }

  // Promo: APP15 = % off full-price items, first order per email only.
  let discount = 0, appliedCode = null;
  if (code) {
    const promoCode = String(getSetting('promo_code', 'APP15')).toUpperCase();
    const pct = Number(getSetting('promo_percent', 15));
    if (String(code).toUpperCase() !== promoCode) { const e = new Error('That code isn’t valid.'); e.code = 'CODE'; throw e; }
    const prior = email ? db.prepare('SELECT COUNT(*) c FROM orders WHERE lower(email)=lower(?)').get(email).c : 0;
    if (prior > 0) { const e = new Error('APP15 is for your first order only.'); e.code = 'CODE_USED'; throw e; }
    if (fullPriceSubtotal <= 0) { const e = new Error('APP15 applies to full-price items only.'); e.code = 'CODE_SALE'; throw e; }
    discount = Math.round(fullPriceSubtotal * (pct / 100));
    appliedCode = promoCode;
  }

  // Shipping + tax need a US state.
  let shipping = null, tax = null, taxRate = 0, shipInfo = null;
  const state = (address.state || '').toUpperCase();
  const country = (address.country || 'US').toUpperCase();
  if (state) {
    const taxable = Math.max(0, subtotal - discount);
    shipInfo = calcShipping({ items: lines, subtotalCents: subtotal, state, country });
    shipping = shipInfo.cents;
    const t = calcTax({ state, taxableCents: taxable, shippingCents: shipping, isApparel: true });
    tax = t.cents; taxRate = t.rate;
  }

  const total = subtotal - discount + (shipping || 0) + (tax || 0);
  return {
    items: lines,
    subtotal_cents: subtotal,
    discount_cents: discount, discount_code: appliedCode,
    shipping_cents: shipping, free_shipping: shipInfo ? shipInfo.freeApplied : null,
    tax_cents: tax, tax_rate: taxRate,
    total_cents: total,
    needs_address: state ? false : true
  };
}

/* ══════════════ PUBLIC STORE API ══════════════ */
app.get('/api/store', (_req, res) => res.json(storePublic()));

app.get('/api/products', (req, res) => {
  const { q = '', category = '', collection = '' } = req.query;
  let sql = `SELECT * FROM products WHERE status='active'`;
  const args = [];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (collection === 'sale') sql += ' AND compare_at_cents IS NOT NULL AND compare_at_cents > price_cents';
  else if (collection === 'new') { sql += ' AND tags LIKE ?'; args.push('%new-arrival%'); }
  else if (collection === 'summer') { sql += ' AND tags LIKE ?'; args.push('%summer%'); }
  else if (collection) { sql += ' AND tags LIKE ?'; args.push(`%${collection}%`); }
  if (q) { sql += ' AND (title LIKE ? OR description LIKE ? OR tags LIKE ? OR category LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY featured DESC, created_at DESC';
  res.json(db.prepare(sql).all(...args).map(pubProduct));
});

app.get('/api/products/:slug', (req, res) => {
  const p = db.prepare(`SELECT * FROM products WHERE slug=? AND status='active'`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  res.json(pubProduct(p));
});

app.get('/api/categories', (_req, res) => {
  const rows = db.prepare(`SELECT DISTINCT category FROM products WHERE status='active' ORDER BY category`).all();
  res.json(rows.map((r) => r.category));
});

/* ── Live quote (checkout recalculates shipping+tax as the address is typed) ── */
app.post('/api/quote', (req, res) => {
  try { res.json(buildQuote(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message, code: e.code }); }
});

/* ── Checkout: create order + payment intent ── */
app.post('/api/checkout', async (req, res) => {
  try {
    const { items, address, code, email, name, phone, consent } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!address || !address.state || !address.line1 || !address.city || !address.zip)
      return res.status(400).json({ error: 'Complete shipping address (line1, city, state, ZIP) is required.' });

    const q = buildQuote({ items, address, code, email });
    const number = 'ZS-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100);

    const shipAddr = {
      line1: address.line1, line2: address.line2 || '', city: address.city,
      state: String(address.state).toUpperCase(), zip: address.zip, country: 'US'
    };

    const base = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const pay = await startPayment({
      order: { number, email, total_cents: q.total_cents },
      successUrl: `${base}/success?o=${encodeURIComponent(number)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/checkout?canceled=1`
    });

    const info = db.prepare(`INSERT INTO orders
      (number,email,customer_name,phone,ship_address,items,subtotal_cents,discount_cents,discount_code,
       shipping_cents,tax_cents,total_cents,status,payment_status,payment_ref,marketing_consent)
      VALUES (@number,@email,@name,@phone,@ship,@items,@sub,@disc,@code,@ship_c,@tax,@total,@status,@pay,@ref,@consent)`)
      .run({
        number, email, name: name || '', phone: phone || '',
        ship: JSON.stringify(shipAddr), items: JSON.stringify(q.items),
        sub: q.subtotal_cents, disc: q.discount_cents, code: q.discount_code,
        ship_c: q.shipping_cents, tax: q.tax_cents, total: q.total_cents,
        status: 'pending', pay: 'unpaid', ref: pay.ref,
        consent: consent ? 1 : 0
      });

    const orderId = info.lastInsertRowid;

    // Mock gateway captures immediately -> finalize now.
    if (pay.captured) {
      await finalizeOrder(orderId);
      return res.json({ order_number: number, paid: true, mode: paymentMode });
    }
    // Stripe: send the browser to the secure hosted checkout page.
    res.json({ order_number: number, paid: false, mode: paymentMode, checkout_url: pay.url });
  } catch (e) {
    console.error('CHECKOUT FAILED →', e && e.message);
    res.status(400).json({ error: e.message, code: e.code });
  }
});

// Public order tracking: look up your own order by number + email (no account needed).
app.post('/api/order/lookup', (req, res) => {
  const { number, email } = req.body || {};
  if (!number || !email) return res.status(400).json({ error: 'Order number and email are required.' });
  const o = db.prepare('SELECT * FROM orders WHERE number=? AND lower(email)=lower(?)').get(String(number).trim(), String(email).trim());
  if (!o) return res.status(404).json({ error: "We couldn't find an order with that number and email." });
  res.json({
    number: o.number, status: o.status, payment_status: o.payment_status,
    placed: o.created_at, total_cents: o.total_cents, tracking_number: o.tracking_number || null,
    refunded_cents: o.refunded_cents || 0, items: J(o.items, []).map(i => ({ title: i.title, qty: i.qty, size: i.size }))
  });
});

app.post('/api/checkout/confirm', async (req, res) => {
  try {
    const { order_number, session_id } = req.body || {};
    const order = db.prepare('SELECT * FROM orders WHERE number=?').get(order_number);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.payment_status === 'paid') return res.json({ order_number, paid: true });
    const { paid, paymentRef } = await confirmPayment({ sessionId: session_id, existingRef: order.payment_ref });
    if (!paid) return res.status(402).json({ error: 'Payment not completed yet.' });
    if (paymentRef && paymentRef !== order.payment_ref) db.prepare('UPDATE orders SET payment_ref=? WHERE id=?').run(paymentRef, order.id);
    await finalizeOrder(order.id);
    res.json({ order_number, paid: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Decrement stock, mark paid, email owner + customer.
async function finalizeOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const items = J(order.items, []);
  const tx = db.transaction(() => {
    for (const it of items) db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id=?').run(it.qty, it.id);
    db.prepare(`UPDATE orders SET status='paid', payment_status='paid' WHERE id=?`).run(orderId);
  });
  tx();
  const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  fresh.items = items; fresh.ship_address = J(fresh.ship_address, {});
  const store = allSettings();
  // Keep opted-in customers for future deals (with consent).
  try {
    if (store.collect_customer_data && fresh.marketing_consent) {
      upsertCustomer({ email: fresh.email, name: fresh.customer_name, phone: fresh.phone, state: fresh.ship_address.state, spentCents: fresh.total_cents });
    }
  } catch (e) { console.error('customer capture error:', e.message); }
  try {
    const mails = orderEmails(fresh, store);
    await sendMail(mails.owner);
    await sendMail(mails.customer);
  } catch (e) { console.error('email error:', e.message); }
}

/* ══════════════ AUTH ══════════════ */
// Simple in-memory brute-force guard: max 8 failed logins per IP per 15 min.
const loginHits = new Map();
function loginLimited(ip) {
  const now = Date.now(), win = 15 * 60 * 1000, rec = loginHits.get(ip);
  if (rec && now - rec.first < win && rec.count >= 8) return true;
  return false;
}
function noteLoginFail(ip) {
  const now = Date.now(), win = 15 * 60 * 1000, rec = loginHits.get(ip);
  if (!rec || now - rec.first > win) loginHits.set(ip, { first: now, count: 1 });
  else rec.count++;
}
function clearLogin(ip) { loginHits.delete(ip); }

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    noteLoginFail(ip);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  clearLogin(ip);
  const token = sign(u);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

// Change your own password.
app.post('/api/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u || !bcrypt.compareSync(current || '', u.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(next), 10), u.id);
  res.json({ ok: true });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

/* ══════════════ ADMIN (admin + super_admin) ══════════════ */
const admin = express.Router();
admin.use(requireRole('admin'));

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }

admin.get('/products', (_req, res) =>
  res.json(db.prepare('SELECT * FROM products ORDER BY updated_at DESC').all().map(pubProduct)));

// Upload / create a product.
admin.post('/products', (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title is required.' });
  let slug = slugify(b.slug || b.title);
  while (db.prepare('SELECT 1 FROM products WHERE slug=?').get(slug)) slug += '-' + Math.floor(Math.random() * 90 + 10);
  const info = db.prepare(`INSERT INTO products
    (title,slug,description,price_cents,compare_at_cents,category,sizes,colors,images,stock,weight_oz,status,featured,seo_title,seo_description,tags)
    VALUES (@title,@slug,@description,@price,@compare,@category,@sizes,@colors,@images,@stock,@weight,@status,@featured,@st,@sd,@tags)`)
    .run({
      title: b.title, slug, description: b.description || '',
      price: Math.round(Number(b.price_cents) || 0),
      compare: b.compare_at_cents ? Math.round(Number(b.compare_at_cents)) : null,
      category: b.category || 'General',
      sizes: JSON.stringify(b.sizes || []), colors: JSON.stringify(b.colors || []),
      images: JSON.stringify(b.images || []),
      stock: Math.round(Number(b.stock) || 0), weight: Number(b.weight_oz) || 12,
      status: ['draft', 'active', 'archived'].includes(b.status) ? b.status : 'draft',
      featured: b.featured ? 1 : 0,
      st: b.seo_title || `${b.title} — Zanobia Sewing`,
      sd: b.seo_description || String(b.description || '').slice(0, 155),
      tags: JSON.stringify(b.tags || [])
    });
  res.status(201).json(pubProduct(db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid)));
});

// Edit a product. Admin: content + status/draft. Super admin: everything (same handler).
admin.put('/products/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Product not found.' });
  const b = req.body || {};
  const merged = {
    title: b.title ?? cur.title,
    description: b.description ?? cur.description,
    price_cents: b.price_cents != null ? Math.round(Number(b.price_cents)) : cur.price_cents,
    compare_at_cents: b.compare_at_cents !== undefined ? (b.compare_at_cents ? Math.round(Number(b.compare_at_cents)) : null) : cur.compare_at_cents,
    category: b.category ?? cur.category,
    sizes: JSON.stringify(b.sizes ?? J(cur.sizes, [])),
    colors: JSON.stringify(b.colors ?? J(cur.colors, [])),
    images: JSON.stringify(b.images ?? J(cur.images, [])),
    stock: b.stock != null ? Math.round(Number(b.stock)) : cur.stock,
    weight_oz: b.weight_oz != null ? Number(b.weight_oz) : cur.weight_oz,
    status: ['draft', 'active', 'archived'].includes(b.status) ? b.status : cur.status,
    featured: b.featured != null ? (b.featured ? 1 : 0) : cur.featured,
    seo_title: b.seo_title ?? cur.seo_title,
    seo_description: b.seo_description ?? cur.seo_description,
    tags: JSON.stringify(b.tags ?? J(cur.tags, [])),
    id: cur.id
  };
  db.prepare(`UPDATE products SET title=@title,description=@description,price_cents=@price_cents,
    compare_at_cents=@compare_at_cents,category=@category,sizes=@sizes,colors=@colors,images=@images,
    stock=@stock,weight_oz=@weight_oz,status=@status,featured=@featured,seo_title=@seo_title,
    seo_description=@seo_description,tags=@tags,updated_at=datetime('now') WHERE id=@id`).run(merged);
  res.json(pubProduct(db.prepare('SELECT * FROM products WHERE id=?').get(cur.id)));
});

// Quick status toggle (draft <-> active) — the "keep in draft" control.
admin.patch('/products/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['draft', 'active', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const r = db.prepare(`UPDATE products SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ok: true, status });
});

admin.delete('/products/:id', (req, res) => {
  const r = db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ok: true });
});

// Orders
admin.get('/orders', (_req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all();
  res.json(rows.map((o) => ({ ...o, items: J(o.items, []), ship_address: J(o.ship_address, {}) })));
});
admin.patch('/orders/:id', async (req, res) => {
  const { status, tracking_number } = req.body || {};
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (status && !['pending', 'paid', 'fulfilled', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const newStatus = status || order.status;
  const newTracking = (tracking_number !== undefined) ? String(tracking_number).trim() : order.tracking_number;
  db.prepare('UPDATE orders SET status=?, tracking_number=? WHERE id=?').run(newStatus, newTracking, order.id);
  // Email the customer when a tracking number is newly added.
  if (newTracking && newTracking !== order.tracking_number) {
    const s = allSettings();
    sendMail({
      to: order.email,
      subject: `Your ${s.store_name} order ${order.number} has shipped`,
      text: `Good news — your order ${order.number} is on its way.\n\nTracking number: ${newTracking}\n\nThank you for shopping with ${s.store_name}.`
    }).catch(e => console.error('tracking email:', e.message));
  }
  res.json({ ok: true, status: newStatus, tracking_number: newTracking });
});

// Sales summary for the admin dashboard.
admin.get('/stats', (_req, res) => {
  const paid = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) rev, COALESCE(SUM(refunded_cents),0) ref FROM orders WHERE payment_status='paid'`).get();
  const pending = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='pending'`).get();
  const units = db.prepare(`SELECT items FROM orders WHERE payment_status='paid'`).all();
  const tally = {};
  for (const r of units) for (const it of J(r.items, [])) tally[it.title] = (tally[it.title] || 0) + (it.qty || 1);
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, qty]) => ({ title, qty }));
  const low = db.prepare(`SELECT title, stock FROM products WHERE status='active' AND stock<=3 ORDER BY stock ASC LIMIT 8`).all();
  res.json({
    revenue_cents: paid.rev, refunded_cents: paid.ref, net_cents: paid.rev - paid.ref,
    paid_orders: paid.n, pending_orders: pending.n, top_products: top, low_stock: low
  });
});

// Image upload -> returns a URL admins can attach to a product.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, UPLOADS),
    filename: (_r, f, cb) => cb(null, Date.now() + '-' + f.originalname.replace(/[^\w.-]/g, '_'))
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});
admin.post('/upload', upload.array('images', 8), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ urls });
});

app.use('/api/admin', admin);

/* ══════════════ SUPER ADMIN ONLY ══════════════ */
const sa = express.Router();
sa.use(requireRole('super_admin'));

// Store settings — name, phone, address, shipping, tax, social, SEO, promo — anything.
sa.get('/settings', (_req, res) => res.json(allSettings()));
sa.put('/settings', (req, res) => {
  const editable = ['store_name', 'tagline', 'store_email', 'phone', 'address', 'currency',
    'free_ship_threshold_cents', 'ship_base_cents', 'ship_per_lb_cents', 'ship_akhi_surcharge_cents',
    'ship_tax_shipping', 'tax_overrides', 'social', 'seo_title', 'seo_description', 'promo_code', 'promo_percent',
    'collect_customer_data', 'marketing_consent_label', 'privacy_policy'];
  for (const k of editable) if (k in (req.body || {})) setSetting(k, req.body[k]);
  res.json(allSettings());
});

// Manage staff accounts.
sa.get('/users', (_req, res) =>
  res.json(db.prepare('SELECT id,email,name,role,created_at FROM users ORDER BY id').all()));
sa.post('/users', (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const r = ['admin', 'super_admin'].includes(role) ? role : 'admin';
  try {
    const info = db.prepare('INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)')
      .run(email, bcrypt.hashSync(password, 10), name || '', r);
    res.status(201).json({ id: info.lastInsertRowid, email, name, role: r });
  } catch { res.status(409).json({ error: 'That email already exists.' }); }
});
sa.delete('/users/:id', (req, res) => {
  const me = req.user.id;
  if (Number(req.params.id) === me) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const r = db.prepare(`DELETE FROM users WHERE id=? AND role!='super_admin' OR (id=? AND (SELECT COUNT(*) FROM users WHERE role='super_admin')>1)`).run(req.params.id, req.params.id);
  if (!r.changes) return res.status(400).json({ error: 'Cannot remove the last super admin.' });
  res.json({ ok: true });
});

// Opted-in customer list (for future deals) + CSV export.
sa.get('/customers', (_req, res) =>
  res.json(db.prepare('SELECT id,email,name,phone,state,orders_count,total_spent_cents,created_at FROM customers ORDER BY updated_at DESC').all()));
sa.get('/customers.csv', (_req, res) => {
  const rows = db.prepare('SELECT email,name,phone,state,orders_count,total_spent_cents,created_at FROM customers ORDER BY created_at DESC').all();
  const head = 'email,name,phone,state,orders,total_spent_usd,joined';
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => [r.email, r.name, r.phone, r.state, r.orders_count, (r.total_spent_cents / 100).toFixed(2), r.created_at].map(esc).join(',')).join('\n');
  res.type('text/csv').attachment('zanobia-customers.csv').send(head + '\n' + body);
});

// Reset a staff member's password.
sa.post('/users/:id/password', (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true });
});

// Refund an order (full or partial). Works with Stripe; in demo mode it just records the refund.
sa.post('/orders/:id/refund', async (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    if (o.payment_status !== 'paid') return res.status(400).json({ error: 'Only paid orders can be refunded.' });
    const amount = req.body && req.body.amount_cents ? Math.min(Number(req.body.amount_cents), o.total_cents - (o.refunded_cents || 0)) : (o.total_cents - (o.refunded_cents || 0));
    if (amount <= 0) return res.status(400).json({ error: 'Nothing left to refund.' });
    await refundPayment({ paymentRef: o.payment_ref, amountCents: amount });
    const refunded = (o.refunded_cents || 0) + amount;
    const fully = refunded >= o.total_cents;
    db.prepare('UPDATE orders SET refunded_cents=?, status=?, payment_status=? WHERE id=?')
      .run(refunded, fully ? 'cancelled' : o.status, fully ? 'refunded' : o.payment_status, o.id);
    const s = allSettings();
    sendMail({ to: o.email, subject: `Refund from ${s.store_name} — order ${o.number}`,
      text: `We've refunded ${(amount / 100).toFixed(2)} ${String(s.currency || 'USD').toUpperCase()} to your original payment method for order ${o.number}.\n\nThank you, ${s.store_name}.` })
      .catch(e => console.error('refund email:', e.message));
    res.json({ ok: true, refunded_cents: refunded, fully });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Download a full database backup (super admin).
sa.get('/backup', async (_req, res) => {
  try {
    const tmp = path.join(DATA_DIR, `backup-download-${Date.now()}.db`);
    await backupTo(tmp);
    res.download(tmp, `zanobia-backup-${new Date().toISOString().slice(0, 10)}.db`, () => { try { fs.unlinkSync(tmp); } catch {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api/super', sa);

/* ══════════════ SEO ══════════════ */
app.get('/robots.txt', (_req, res) => {
  const site = process.env.SITE_URL || '';
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  const site = process.env.SITE_URL || '';
  const rows = db.prepare(`SELECT slug, updated_at FROM products WHERE status='active'`).all();
  const urls = [`<url><loc>${site}/</loc></url>`]
    .concat(rows.map((r) => `<url><loc>${site}/p/${r.slug}</loc><lastmod>${(r.updated_at || '').slice(0, 10)}</lastmod></url>`));
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
});

app.get('/health', (_req, res) => res.json({ ok: true, payment_mode: paymentMode }));

/* ── Static + SPA routing ─────────────────────────────────── */
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(PUB, { extensions: ['html'] }));
app.get(['/', '/p/:slug', '/cart', '/checkout', '/success', '/wishlist', '/privacy', '/track'], (_req, res) => res.sendFile(path.join(PUB, 'index.html')));
app.get(['/admin', '/admin/*'], (_req, res) => res.sendFile(path.join(PUB, 'admin.html')));

// ── Automatic database backups (rotating, keeps the last 7) ──
async function runBackup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await backupTo(path.join(dir, `zanobia-${new Date().toISOString().replace(/[:.]/g, '-')}.db`));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    while (files.length > 7) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch {} }
  } catch (e) { console.error('backup failed:', e.message); }
}

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🧵 Zanobia Sewing running → http://localhost:${PORT}`);
    console.log(`     Admin console         → http://localhost:${PORT}/admin`);
    console.log(`     Payment mode          → ${paymentMode.toUpperCase()}\n`);
    runBackup();
    setInterval(runBackup, 12 * 60 * 60 * 1000).unref();
  });
}
module.exports = { app, buildQuote };
