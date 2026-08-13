'use strict';
/**
 * Database layer — SQLite via better-sqlite3.
 * Creates the schema on first run and seeds demo data + admin accounts.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'zanobia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',        -- 'admin' | 'super_admin'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  compare_at_cents INTEGER,                   -- original price (for "on sale")
  category TEXT DEFAULT 'General',
  sizes TEXT DEFAULT '[]',                    -- JSON array
  colors TEXT DEFAULT '[]',                   -- JSON array
  images TEXT DEFAULT '[]',                   -- JSON array of URLs
  stock INTEGER NOT NULL DEFAULT 0,
  weight_oz REAL NOT NULL DEFAULT 12,         -- shipping weight
  status TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'active' | 'archived'
  featured INTEGER NOT NULL DEFAULT 0,        -- 1 = show in Highlights strip
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',                     -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  customer_name TEXT,
  phone TEXT,
  ship_address TEXT NOT NULL,                 -- JSON {line1,line2,city,state,zip,country}
  items TEXT NOT NULL,                        -- JSON snapshot of line items
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_code TEXT,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'paid' | 'fulfilled' | 'cancelled'
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_ref TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Opted-in customers, kept for future deals (only stored with consent).
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  state TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 1,   -- 1 = agreed to receive offers
  consent_source TEXT DEFAULT 'checkout',
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

/* ── Lightweight migrations (safe to run every boot) ──────── */
try { db.prepare('SELECT marketing_consent FROM orders LIMIT 1').get(); }
catch { db.exec(`ALTER TABLE orders ADD COLUMN marketing_consent INTEGER DEFAULT 0`); }
try { db.prepare('SELECT tracking_number FROM orders LIMIT 1').get(); }
catch { db.exec(`ALTER TABLE orders ADD COLUMN tracking_number TEXT`); }
try { db.prepare('SELECT refunded_cents FROM orders LIMIT 1').get(); }
catch { db.exec(`ALTER TABLE orders ADD COLUMN refunded_cents INTEGER DEFAULT 0`); }

/* ── Settings helpers ─────────────────────────────────────── */
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);
function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function setSetting(key, value) {
  _setSetting.run(key, JSON.stringify(value));
}
function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

/* ── Default store settings (Super Admin editable) ────────── */
const DEFAULT_SETTINGS = {
  store_name: 'Zanobia Sewing',
  tagline: 'Couture, cut by hand.',
  store_email: process.env.STORE_EMAIL || 'owner@zanobiasewing.com',
  phone: '+1 (000) 000-0000',
  address: '1 Palmyra Lane, Suite 100, Durham, NC 27701, USA',
  currency: 'USD',
  // Shipping (USA only)
  free_ship_threshold_cents: 15000,   // free shipping at $150+
  ship_base_cents: 695,               // base handling+first pound
  ship_per_lb_cents: 250,             // each additional pound
  ship_akhi_surcharge_cents: 900,     // Alaska / Hawaii surcharge
  ship_tax_shipping: false,           // whether shipping is taxable
  // Social + SEO
  social: {
    instagram: 'https://instagram.com/zanobiasewing',
    facebook: 'https://facebook.com/zanobiasewing',
    tiktok: 'https://tiktok.com/@zanobiasewing',
    pinterest: 'https://pinterest.com/zanobiasewing',
    whatsapp: ''
  },
  seo_title: 'Zanobia Sewing — Designer Clothing, Shoes & Accessories',
  seo_description:
    'Shop Zanobia Sewing: hand-finished designer clothing, shoes and accessories. New app users get 15% off their first order with code APP15.',
  promo_code: 'APP15',
  promo_percent: 15,
  // Customer data collection (with consent) for future deals
  collect_customer_data: true,
  marketing_consent_label: 'Email me about new arrivals, sales and exclusive offers.',
  privacy_policy:
    'Zanobia Sewing collects the name, email, phone and shipping address you provide at checkout ' +
    'in order to process and deliver your order. We store this information securely and do not sell it. ' +
    'If you tick the marketing box, we also keep your email and name to send you news of new arrivals, ' +
    'sales and offers — you can unsubscribe at any time by replying "STOP" to any message or emailing us. ' +
    'We keep order records as required for tax and accounting. To request a copy of your data or its deletion, ' +
    'contact us at the email in the footer.'
};

function ensureSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (_getSetting.get(k) === undefined) setSetting(k, v);
  }
}

/* ── Seed ─────────────────────────────────────────────────── */
function seed() {
  ensureSettings();

  // Admin accounts — credentials come from env vars (never hard-coded secrets).
  // If a *_PASSWORD env var is set, the login is created AND kept in sync on every
  // boot (so rotating the code just works). Without env vars, weak demo defaults are
  // used so the app still runs out of the box for local practice.
  function seedUser(email, password, name, role, rotate) {
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    const hash = bcrypt.hashSync(password, 10);
    if (!existing) db.prepare('INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)').run(email, hash, name, role);
    else if (rotate) db.prepare('UPDATE users SET password_hash=?, role=? WHERE email=?').run(hash, role, email);
  }
  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'super@zanobiasewing.com';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@zanobiasewing.com';
  const superPass = process.env.SUPER_ADMIN_PASSWORD;
  const adminPass = process.env.ADMIN_PASSWORD;
  seedUser(superEmail, superPass || 'changeme-super', 'Super Admin', 'super_admin', !!superPass);
  seedUser(adminEmail, adminPass || 'changeme-admin', 'Store Admin', 'admin', !!adminPass);

  // Demo catalogue (only if empty)
  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO products
      (title,slug,description,price_cents,compare_at_cents,category,sizes,colors,images,stock,weight_oz,status,featured,seo_title,seo_description,tags)
      VALUES (@title,@slug,@description,@price_cents,@compare_at_cents,@category,@sizes,@colors,@images,@stock,@weight_oz,@status,@featured,@seo_title,@seo_description,@tags)`);
    const ph = (seed, w = 900, h = 1200) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
    // [title, slug, description, price, compare, category, sizes, colors, stock, weight, featured, extraTags]
    const demo = [
      ['Palmyra Silk Abaya', 'palmyra-silk-abaya', 'A floor-length abaya in liquid silk with a hand-rolled hem and a fine gold seam at the cuff.', 24800, 32000, 'Dresses', ['XS','S','M','L','XL'], ['Aubergine','Sand','Onyx'], 5, 22, 1, ['new-arrival']],
      ['Zenobia Wrap Coat', 'zenobia-wrap-coat', 'A double-faced wool wrap coat with a self belt. Fully lined, tailored in the studio.', 39900, null, 'Outerwear', ['S','M','L'], ['Camel','Ink'], 3, 40, 1, ['new-arrival']],
      ['Desert Rose Blouse', 'desert-rose-blouse', 'Featherweight cotton voile blouse with covered buttons and a mandarin collar.', 8900, 11000, 'Blouses', ['XS','S','M','L'], ['Ivory','Rose'], 12, 8, 1, ['summer']],
      ['Aurelian Trouser', 'aurelian-trouser', 'High-rise wide-leg trouser in a pressed crepe. Deep pockets, clean front.', 12900, null, 'Pants', ['24','26','28','30','32'], ['Black','Stone'], 9, 14, 0, ['new-arrival']],
      ['Gilded Slide Sandal', 'gilded-slide-sandal', 'Antique-gold leather slide with a stitched footbed. Made to be lived in.', 15900, 19900, 'Shoes', ['36','37','38','39','40','41'], ['Gold'], 7, 18, 1, ['summer']],
      ['Seam Line Tote', 'seam-line-tote', 'Structured vegetable-tanned tote with our signature contrast saddle stitch.', 18900, null, 'Bags', ['One Size'], ['Tan','Plum'], 6, 26, 0, ['new-arrival']],
      ['Oasis Midi Skirt', 'oasis-midi-skirt', 'Bias-cut satin midi that moves like water. Concealed side zip.', 10900, 14000, 'Dresses', ['XS','S','M','L'], ['Emerald','Ink'], 0, 10, 0, ['summer']],
      ['Empress Cashmere Scarf', 'empress-cashmere-scarf', 'Two-ply cashmere scarf, hand-loomed, with a hand-knotted fringe.', 7900, null, 'Accessories', ['One Size'], ['Camel','Grey','Wine'], 15, 6, 1, []],
      // Summer collection
      ['Solstice Linen Dress', 'solstice-linen-dress', 'Breezy tiered dress in washed European linen. Adjustable straps, side pockets.', 11900, 14900, 'Dresses', ['XS','S','M','L','XL'], ['White','Sand','Sky'], 14, 12, 1, ['summer','new-arrival']],
      ['Dune Camp Shirt', 'dune-camp-shirt', 'Relaxed short-sleeve camp shirt in airy cotton gauze. An easy summer layer.', 7400, null, 'Blouses', ['S','M','L'], ['Sand','Sage'], 18, 7, 0, ['summer']],
      // Men
      ['Aurelius Linen Shirt', 'aurelius-linen-shirt', "Men's tailored linen shirt with mother-of-pearl buttons and a clean spread collar.", 9800, 12000, 'Men', ['S','M','L','XL'], ['White','Indigo','Olive'], 16, 9, 1, ['summer','new-arrival']],
      ['Cyrus Tailored Trouser', 'cyrus-tailored-trouser', "Men's flat-front trouser in a resilient wool blend. Tailored, not tight.", 14500, null, 'Men', ['30','32','34','36','38'], ['Charcoal','Navy'], 11, 15, 0, ['new-arrival']],
      ['Silk Road Pocket Square', 'silk-road-pocket-square', "Hand-rolled silk pocket square with a woven Palmyra motif. A finishing touch.", 4200, null, 'Men', ['One Size'], ['Wine','Gold'], 25, 2, 0, []],
      // Bedroom Linen
      ['Palmyra Linen Duvet Set', 'palmyra-linen-duvet-set', 'Stonewashed pure-linen duvet cover with two pillowcases. Softer with every wash.', 21900, 26900, 'Bedroom Linen', ['Full','Queen','King'], ['Oat','Clay','Mist'], 8, 60, 1, ['new-arrival']],
      ['Oasis Linen Pillowcase Pair', 'oasis-linen-pillowcase-pair', 'A pair of French-flax pillowcases with an envelope closure and a fine gold seam.', 5900, null, 'Bedroom Linen', ['Standard','King'], ['Oat','Clay','Mist'], 20, 10, 0, ['summer']],
      ['Nomad Waffle Throw', 'nomad-waffle-throw', 'Airy waffle-weave cotton throw for the foot of the bed or the sofa.', 8900, 10900, 'Bedroom Linen', ['One Size'], ['Sand','Sage','Wine'], 12, 22, 0, []]
    ];
    for (const d of demo) {
      const [title, slug, description, price, compare, category, sizes, colors, stock, weight, featured, extraTags = []] = d;
      const tags = Array.from(new Set([category.toLowerCase(), ...extraTags]));
      ins.run({
        title, slug, description,
        price_cents: price, compare_at_cents: compare,
        category, sizes: JSON.stringify(sizes), colors: JSON.stringify(colors),
        images: JSON.stringify([ph(slug + '1'), ph(slug + '2'), ph(slug + '3')]),
        stock, weight_oz: weight,
        status: stock === 0 ? 'draft' : 'active',
        featured,
        seo_title: `${title} — Zanobia Sewing`,
        seo_description: description.slice(0, 155),
        tags: JSON.stringify(tags)
      });
    }
    console.log(`  seeded ${demo.length} demo products`);
  }
}

const DB_FILE = path.join(DATA_DIR, 'zanobia.db');

// Create a consistent snapshot of the database to destPath (used for backups).
async function backupTo(destPath) { await db.backup(destPath); return destPath; }

module.exports = { db, getSetting, setSetting, allSettings, ensureSettings, seed, DATA_DIR, DB_FILE, backupTo };

// Allow: `npm run seed`
if (require.main === module) {
  seed();
  console.log('✔ database ready at data/zanobia.db');
}
