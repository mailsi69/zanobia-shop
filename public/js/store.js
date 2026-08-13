'use strict';
/* ═══ Zanobia Sewing — storefront (AURA theme) ═══ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (p, o) => fetch('/api' + p, o).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });
const money = c => '$' + (Number(c) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const State = {
  store: null,
  cart: JSON.parse(localStorage.getItem('zs_cart') || '[]'),
  wish: JSON.parse(localStorage.getItem('zs_wish') || '[]'),
  saveCart() { localStorage.setItem('zs_cart', JSON.stringify(this.cart)); renderCartCount(); },
  saveWish() { localStorage.setItem('zs_wish', JSON.stringify(this.wish)); }
};

/* ── Cart ops ── */
function addToCart(p, size, qty = 1) {
  const key = p.id + '|' + (size || '');
  const found = State.cart.find(i => i.key === key);
  if (found) found.qty = Math.min(99, found.qty + qty);
  else State.cart.push({ key, id: p.id, title: p.title, slug: p.slug, price_cents: p.price_cents, image: (p.images || [])[0] || null, size: size || null, qty });
  State.saveCart(); openCart(); renderCart();
}
function setQty(key, d) { const i = State.cart.find(x => x.key === key); if (!i) return; i.qty += d; if (i.qty < 1) State.cart = State.cart.filter(x => x.key !== key); State.saveCart(); renderCart(); }
function removeItem(key) { State.cart = State.cart.filter(x => x.key !== key); State.saveCart(); renderCart(); }
const cartCount = () => State.cart.reduce((s, i) => s + i.qty, 0);
const cartSubtotal = () => State.cart.reduce((s, i) => s + i.price_cents * i.qty, 0);
function renderCartCount() { const n = cartCount(), el = $('#cartCount'); el.textContent = n; el.classList.toggle('hidden', n === 0); }

/* ── Wishlist ── */
const inWish = slug => State.wish.includes(slug);
function toggleWish(slug) { if (inWish(slug)) State.wish = State.wish.filter(s => s !== slug); else State.wish.push(slug); State.saveWish(); $$(`.wish[data-slug="${CSS.escape(slug)}"]`).forEach(w => w.classList.toggle('on', inWish(slug))); }

/* ── Cart drawer ── */
const drawer = $('#drawer'), scrim = $('#scrim');
function openCart() { drawer.classList.add('on'); scrim.classList.add('on'); }
function closeCart() { drawer.classList.remove('on'); scrim.classList.remove('on'); }
$('#cartBtn').onclick = () => { renderCart(); openCart(); };
$('#closeCart').onclick = closeCart; scrim.onclick = closeCart;

function renderCart() {
  const box = $('#cartItems'), foot = $('#cartFooter');
  if (!State.cart.length) {
    box.innerHTML = `<div class="empty">Your bag is empty.<br><br><button class="btn btn-ghost" onclick="closeCart()">Keep shopping</button></div>`;
    foot.innerHTML = ''; return;
  }
  box.innerHTML = State.cart.map(i => `
    <div class="line">
      <img src="${esc(i.image) || ''}" alt="${esc(i.title)}" loading="lazy">
      <div class="l-body">
        <h4>${esc(i.title)}</h4>
        <div class="meta">${i.size ? 'Size ' + esc(i.size) + ' · ' : ''}${money(i.price_cents)}</div>
        <div class="qty"><button onclick="setQty('${i.key}',-1)">−</button><span>${i.qty}</span><button onclick="setQty('${i.key}',1)">+</button></div>
        <div class="rm" onclick="removeItem('${i.key}')" style="cursor:pointer">Remove</div>
      </div>
    </div>`).join('');
  const sub = cartSubtotal(), thr = State.store.free_ship_threshold_cents, away = thr - sub;
  foot.innerHTML = `
    <div class="sumrow"><span>Subtotal</span><span>${money(sub)}</span></div>
    ${away > 0 ? `<div class="sumrow"><span>Add ${money(away)} for free shipping</span><span></span></div>` : `<div class="sumrow"><span>Shipping</span><span class="free">Free</span></div>`}
    <div class="hint" style="margin:6px 0 12px">Taxes & shipping calculated at checkout.</div>
    <button class="btn btn-primary" onclick="closeCart();nav('/checkout')">Checkout · ${money(sub)}</button>`;
}

/* ── Router ── */
function nav(path) { history.pushState({}, '', path); route(); window.scrollTo(0, 0); }
window.onpopstate = route;
document.addEventListener('click', e => { const a = e.target.closest('a[data-nav]'); if (a) { e.preventDefault(); nav(a.getAttribute('href')); } });
async function route() {
  const path = location.pathname;
  if (path.startsWith('/p/')) return viewProduct(path.slice(3));
  if (path === '/checkout') return viewCheckout();
  if (path.startsWith('/success')) return viewSuccess();
  if (path === '/wishlist') return viewWishlist();
  if (path === '/privacy') return viewPrivacy();
  if (path === '/track') return viewTrack();
  return viewHome();
}

/* ── SEO helper ── */
function setSEO({ title, desc, ld }) {
  document.title = title;
  const m = document.querySelector('meta[name=description]'); if (m) m.content = desc;
  let s = document.getElementById('ld-page'); if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld-page'; document.head.appendChild(s); }
  s.textContent = ld ? JSON.stringify(ld) : '';
}

/* ── Card ── */
function card(p) {
  const img = (p.images || [])[0] || '';
  const sold = p.stock <= 0;
  const isNew = (p.tags || []).includes('new-arrival');
  return `<a class="card" href="/p/${esc(p.slug)}" data-nav>
    <div class="ph">
      ${p.on_sale ? '<span class="badge">Sale</span>' : (isNew ? '<span class="badge new">New</span>' : '')}
      ${sold ? '<span class="badge sold" style="top:auto;bottom:10px">Sold out</span>' : (p.stock <= 3 ? `<span class="badge" style="top:auto;bottom:10px;background:var(--gold)">Only ${p.stock} left</span>` : '')}
      <button class="wish ${inWish(p.slug) ? 'on' : ''}" data-slug="${esc(p.slug)}" aria-label="Save to wishlist" onclick="event.preventDefault();event.stopPropagation();toggleWish('${esc(p.slug)}')">
        <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-8.5C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 7C19 16.5 12 21 12 21z"/></svg>
      </button>
      <img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy">
    </div>
    <div class="body">
      <div class="cat">${esc(p.category)}</div>
      <h3>${esc(p.title)}</h3>
      <div class="price"><span class="now">${money(p.price_cents)}</span>${p.on_sale ? `<span class="was">${money(p.compare_at_cents)}</span>` : ''}</div>
    </div></a>`;
}
const skeletons = n => Array.from({ length: n }).map(() => `<div class="card"><div class="ph skeleton"></div><div class="body"><div class="skeleton" style="height:12px;width:60%;border-radius:4px"></div></div></div>`).join('');

/* value-prop strip */
const VALUES = `<div class="wrap"><div class="values">
  <div class="value"><div class="v-ico aqua"><svg viewBox="0 0 24 24"><path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg></div><b>Free Shipping</b><span>on orders over $150</span></div>
  <div class="value"><div class="v-ico foam"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9"/><path d="M3 5v4h4"/></svg></div><b>Easy Returns</b><span>within 14 days</span></div>
  <div class="value"><div class="v-ico pink"><svg viewBox="0 0 24 24"><path d="M12 21c-4-3-7-6-7-10a3.5 3.5 0 017 0 3.5 3.5 0 017 0c0 4-3 7-7 10z"/></svg></div><b>Hand-Finished</b><span>crafted with care</span></div>
  <div class="value"><div class="v-ico gold"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg></div><b>Secure Payments</b><span>100% protected</span></div>
</div></div>`;

/* ── Home ── */
let activeFilter = { type: 'all', value: '' };
async function viewHome() {
  const s = State.store;
  setSEO({ title: s.seo_title, desc: s.seo_description, ld: null });
  activeFilter = { type: 'all', value: '' };
  $('#app').innerHTML = `
    <section class="hero bp-bg"><div class="wrap">
      <div class="lockup">
        <img class="emblem" src="/img/emblem.svg" alt="">
        <h1 class="word">Zanobia</h1>
        <div class="sub"><span class="dash"></span>Sewing<span class="dash"></span></div>
        <div class="heart">❤</div>
        <div class="tagline">Chic. Timeless. You.</div>
        <div class="boutique">Online Boutique</div>
      </div>
      <div class="hero-cta">
        <button class="btn btn-primary" onclick="scrollToGrid()">Shop Now</button>
        <button class="btn btn-ghost" onclick="scrollToGrid()">View Collection</button>
      </div>
    </div></section>
    ${VALUES}
    <div class="wrap"><div class="seam"></div></div>
    <div class="wrap"><div class="chips" id="chips"></div></div>
    <section class="wrap" id="highlights"></section>
    <section class="wrap">
      <div class="sec-head"><div><div class="kicker">Tradition in every print</div><h2 id="gridTitle">New Arrivals</h2></div></div>
      <div class="grid" id="grid">${skeletons(8)}</div>
    </section>`;
  loadCats(); loadHighlights(); loadGrid();
}
function scrollToGrid() { const g = $('#chips'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

const SPECIALS = [
  ['new', 'New Arrivals'], ['summer', 'Summer Collection'], ['sale', 'Sale']
];
async function loadCats() {
  const cats = await api('/categories').catch(() => []);
  const el = $('#chips'); if (!el) return;
  const chip = (type, value, label, special) =>
    `<button class="chip ${special ? 'special' : ''} ${activeFilter.type === type && activeFilter.value === value ? 'active' : ''}" data-type="${type}" data-value="${esc(value)}">${esc(label)}</button>`;
  el.innerHTML = chip('all', '', 'All')
    + SPECIALS.map(([v, l]) => chip('collection', v, l, true)).join('')
    + cats.map(c => chip('category', c, c)).join('');
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    activeFilter = { type: b.dataset.type, value: b.dataset.value };
    el.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
    const label = b.textContent;
    $('#gridTitle').textContent = activeFilter.type === 'all' ? 'New Arrivals' : label;
    loadGrid();
  });
}
async function loadHighlights() {
  const all = await api('/products').catch(() => []);
  const feat = all.filter(p => p.featured).slice(0, 10);
  const el = $('#highlights'); if (!el || !feat.length) return;
  el.innerHTML = `<div class="sec-head"><div><div class="kicker">Continuously featured</div><h2>Highlights</h2></div></div>
    <div class="rail">${feat.map(card).join('')}</div>`;
}
async function loadGrid() {
  let qs = '';
  if (activeFilter.type === 'category') qs = '?category=' + encodeURIComponent(activeFilter.value);
  else if (activeFilter.type === 'collection') qs = '?collection=' + encodeURIComponent(activeFilter.value);
  const items = await api('/products' + qs).catch(() => []);
  const el = $('#grid'); if (!el) return;
  el.innerHTML = items.length ? items.map(card).join('') : `<div class="empty" style="grid-column:1/-1">Nothing here yet — check back soon.</div>`;
}

/* ── Product ── */
async function viewProduct(slug) {
  const app = $('#app');
  app.innerHTML = `<div class="wrap"><div class="empty">Loading…</div></div>`;
  let p;
  try { p = await api('/products/' + encodeURIComponent(slug)); }
  catch { app.innerHTML = `<div class="wrap"><div class="empty">Product not found.<br><br><a class="btn btn-ghost" href="/" data-nav>Back to shop</a></div></div>`; return; }
  setSEO({
    title: p.seo_title || p.title, desc: p.seo_description || p.description,
    ld: { '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.description, image: p.images, sku: 'ZS-' + p.id, brand: { '@type': 'Brand', name: 'Zanobia Sewing' }, offers: { '@type': 'Offer', priceCurrency: 'USD', price: (p.price_cents / 100).toFixed(2), availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } }
  });
  const imgs = p.images.length ? p.images : [''];
  const sold = p.stock <= 0;
  app.innerHTML = `<div class="wrap pdp"><div class="layout">
    <div class="gallery">
      <div class="main"><img id="mainImg" src="${esc(imgs[0])}" alt="${esc(p.title)}"></div>
      <div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" class="${i === 0 ? 'on' : ''}" data-i="${i}" alt="View ${i + 1}">`).join('')}</div>
    </div>
    <div class="info">
      <div class="cat">${esc(p.category)}</div>
      <h1>${esc(p.title)}</h1>
      <div class="price"><span class="now">${money(p.price_cents)}</span>${p.on_sale ? `<span class="was">${money(p.compare_at_cents)}</span>` : ''}</div>
      <p class="desc">${esc(p.description)}</p>
      ${p.sizes.length ? `<div class="opt-label">Size</div><div class="sizes" id="sizes">${p.sizes.map((s, i) => `<button class="size ${i === 0 ? 'on' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${p.colors.length ? `<div class="opt-label">Colour</div><div class="swatches">${p.colors.map(c => `<span class="swatch">${esc(c)}</span>`).join('')}</div>` : ''}
      <div style="margin-top:22px;display:flex;gap:10px">
        <button class="btn btn-ghost" style="width:auto" onclick="toggleWish('${esc(p.slug)}')"><span class="wish ${inWish(p.slug) ? 'on' : ''}" data-slug="${esc(p.slug)}" style="position:static;width:auto;height:auto;background:none"><svg viewBox="0 0 24 24" width="18" height="18" style="stroke:var(--rose);fill:${inWish(p.slug) ? 'var(--rose)' : 'none'}"><path d="M12 21s-7-4.5-9.5-8.5C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 7C19 16.5 12 21 12 21z"/></svg></span>&nbsp;Save</button>
      </div>
    </div></div></div>
    <div class="buybar"><div class="buybar-inner">
      <span class="pr">${money(p.price_cents)}</span>
      <button class="btn btn-primary" id="addBtn" ${sold ? 'disabled' : ''}>${sold ? 'Sold out' : 'Add to bag'}</button>
    </div></div>`;
  let size = p.sizes[0] || null;
  $$('#sizes .size', app).forEach(b => b.onclick = () => { size = b.dataset.size; $$('#sizes .size', app).forEach(x => x.classList.toggle('on', x === b)); });
  $$('.thumbs img', app).forEach(t => t.onclick = () => { $('#mainImg').src = t.src; $$('.thumbs img', app).forEach(x => x.classList.toggle('on', x === t)); });
  const addBtn = $('#addBtn'); if (addBtn && !sold) addBtn.onclick = () => addToCart(p, size);
}

/* ── Wishlist view ── */
async function viewWishlist() {
  setSEO({ title: 'Wishlist — Zanobia Sewing', desc: 'Your saved pieces.', ld: null });
  const app = $('#app');
  app.innerHTML = `<div class="wrap"><div class="sec-head"><div><div class="kicker">Saved for later</div><h2>Your Wishlist</h2></div></div><div class="grid" id="grid">${skeletons(4)}</div></div>`;
  const all = await api('/products').catch(() => []);
  const items = all.filter(p => inWish(p.slug));
  $('#grid').innerHTML = items.length ? items.map(card).join('')
    : `<div class="empty" style="grid-column:1/-1">No saved pieces yet. Tap the ❤ on any product to save it.<br><br><a class="btn btn-ghost" href="/" data-nav style="max-width:220px;margin:0 auto">Browse the collection</a></div>`;
}

/* ── Checkout ── */
let quoteTimer, lastQuote = null;
async function viewCheckout() {
  if (!State.cart.length) { nav('/'); return; }
  setSEO({ title: 'Checkout — Zanobia Sewing', desc: 'Secure checkout.', ld: null });
  const states = State.store.states;
  const consentLabel = State.store.marketing_consent_label || 'Email me about new arrivals, sales and offers.';
  const app = $('#app');
  app.innerHTML = `<div class="wrap checkout">
    <h1>Checkout</h1>
    <p class="hint">Zanobia ships within the United States. Shipping & tax are calculated from your address.</p>
    <div class="seam" style="margin:16px 0 22px"></div>

    <h2 style="font-size:19px;margin-bottom:12px">Contact</h2>
    <div class="row2">
      <div class="field"><label>Full name</label><input id="f_name" autocomplete="name" placeholder="Zenobia Q."></div>
      <div class="field"><label>Phone</label><input id="f_phone" autocomplete="tel" placeholder="(919) 555-0100"></div>
    </div>
    <div class="field"><label>Email</label><input id="f_email" type="email" autocomplete="email" placeholder="you@email.com"></div>

    <h2 style="font-size:19px;margin:18px 0 12px">Shipping address</h2>
    <div class="field"><label>Address</label><input id="f_line1" autocomplete="address-line1" placeholder="Street address"></div>
    <div class="field"><label>Apartment, suite (optional)</label><input id="f_line2" autocomplete="address-line2"></div>
    <div class="row3">
      <div class="field"><label>City</label><input id="f_city" autocomplete="address-level2"></div>
      <div class="field"><label>State</label><select id="f_state"><option value="">—</option>${Object.keys(states).map(k => `<option value="${k}">${k}</option>`).join('')}</select></div>
      <div class="field"><label>ZIP</label><input id="f_zip" autocomplete="postal-code" inputmode="numeric"></div>
    </div>

    <div class="opt-label">Promo code</div>
    <div class="promo-line"><input id="f_code" placeholder="APP15" value=""><button id="applyCode">Apply</button></div>
    <div id="codeNote"></div>

    <div class="seam" style="margin:22px 0"></div>
    <div id="summary"></div>

    <div class="consent">
      <input type="checkbox" id="f_consent" checked>
      <label for="f_consent">${esc(consentLabel)} You can unsubscribe anytime. See our <a href="/privacy" data-nav>Privacy Policy</a>.</label>
    </div>

    <div id="payNote"></div>
    <button class="btn btn-primary" id="placeBtn" style="margin-top:14px" disabled>Enter address to continue</button>
    <p class="hint" style="margin-top:14px;text-align:center">Demo build uses a mock payment gateway. Connect Stripe keys in .env for live cards.</p>
  </div>`;
  ['f_state', 'f_line1', 'f_city', 'f_zip', 'f_email'].forEach(id => $('#' + id).addEventListener('input', debouncedQuote));
  $('#f_state').addEventListener('change', debouncedQuote);
  $('#applyCode').onclick = () => refreshQuote(true);
  $('#placeBtn').onclick = placeOrder;
  refreshQuote();
}
function debouncedQuote() { clearTimeout(quoteTimer); quoteTimer = setTimeout(() => refreshQuote(false), 350); }
async function refreshQuote(fromCode) {
  const address = { line1: $('#f_line1')?.value, city: $('#f_city')?.value, state: $('#f_state')?.value, zip: $('#f_zip')?.value, country: 'US' };
  const email = $('#f_email')?.value || '';
  const code = $('#f_code')?.value?.trim() || '';
  const items = State.cart.map(i => ({ id: i.id, qty: i.qty, size: i.size }));
  const codeNote = $('#codeNote');
  try {
    const q = await api('/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, address, code, email }) });
    lastQuote = q; renderSummary(q);
    if (code && q.discount_code) codeNote.innerHTML = `<div class="note ok">${q.discount_code} applied — you saved ${money(q.discount_cents)}.</div>`;
    else if (!code) codeNote.innerHTML = '';
    const ready = !q.needs_address;
    const btn = $('#placeBtn'); btn.disabled = !ready;
    btn.textContent = ready ? `Pay ${money(q.total_cents)}` : 'Enter address to continue';
  } catch (e) {
    if (fromCode || code) codeNote.innerHTML = `<div class="note err">${esc(e.message)}</div>`;
    renderSummary({ subtotal_cents: cartSubtotal(), discount_cents: 0, shipping_cents: null, tax_cents: null, total_cents: cartSubtotal(), needs_address: true });
  }
}
function renderSummary(q) {
  $('#summary').innerHTML = `
    <div class="sumrow"><span>Subtotal</span><span>${money(q.subtotal_cents)}</span></div>
    ${q.discount_cents ? `<div class="sumrow"><span>Discount ${q.discount_code || ''}</span><span>−${money(q.discount_cents)}</span></div>` : ''}
    <div class="sumrow"><span>Shipping</span><span>${q.shipping_cents == null ? '—' : (q.free_shipping ? '<span class="free">Free</span>' : money(q.shipping_cents))}</span></div>
    <div class="sumrow"><span>Tax${q.tax_rate ? ` (${(q.tax_rate * 100).toFixed(2)}%)` : ''}</span><span>${q.tax_cents == null ? '—' : money(q.tax_cents)}</span></div>
    <div class="sumrow total"><span>Total</span><span>${money(q.total_cents)}</span></div>`;
}
async function placeOrder() {
  const btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Processing…';
  const payload = {
    items: State.cart.map(i => ({ id: i.id, qty: i.qty, size: i.size })),
    address: { line1: $('#f_line1').value, line2: $('#f_line2').value, city: $('#f_city').value, state: $('#f_state').value, zip: $('#f_zip').value, country: 'US' },
    email: $('#f_email').value, name: $('#f_name').value, phone: $('#f_phone').value,
    code: $('#f_code').value.trim(), consent: $('#f_consent').checked
  };
  try {
    const res = await api('/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.checkout_url) {            // Stripe: go to the secure hosted payment page
      window.location.href = res.checkout_url;
      return;
    }
    State.cart = []; State.saveCart();  // Mock/demo: already paid
    nav('/success?o=' + encodeURIComponent(res.order_number));
  } catch (e) {
    $('#payNote').innerHTML = `<div class="note err">${esc(e.message)}</div>`;
    btn.disabled = false; btn.textContent = 'Try again';
  }
}

async function viewSuccess() {
  const params = new URLSearchParams(location.search);
  const o = params.get('o') || '';
  const session = params.get('session_id');
  setSEO({ title: 'Order confirmed — Zanobia Sewing', desc: 'Thank you for your order.', ld: null });
  // Returning from Stripe hosted checkout: confirm payment, then clear the cart.
  if (session && o) {
    try {
      await api('/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: o, session_id: session }) });
      State.cart = []; State.saveCart();
    } catch (_) {}
  }
  $('#app').innerHTML = `<div class="success">
    <div class="mark"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div>
    <h1>Thank you.</h1>
    <p class="hint">A confirmation has been emailed to you, and our studio has been notified.</p>
    ${o ? `<div class="ord">Order ${esc(o)}</div>` : ''}
    <p style="color:var(--stone)">We're preparing your pieces with care. You'll receive tracking when they ship.</p>
    <div style="max-width:280px;margin:26px auto 0"><a class="btn btn-primary" href="/" data-nav>Continue shopping</a></div>
    <p class="hint" style="margin-top:16px">Track this order anytime: <a href="/track" data-nav style="color:var(--teal);text-decoration:underline">Track order</a></p>
  </div>`;
}

async function viewTrack() {
  setSEO({ title: 'Track your order — Zanobia Sewing', desc: 'Check the status of your order.', ld: null });
  const prefill = new URLSearchParams(location.search).get('o') || '';
  $('#app').innerHTML = `<div class="checkout" style="max-width:520px">
    <h1>Track your order</h1>
    <p class="hint">Enter your order number and the email you used at checkout.</p>
    <div class="seam" style="margin:16px 0 22px"></div>
    <div class="field"><label>Order number</label><input id="t_num" value="${esc(prefill)}" placeholder="ZS-XXXXXX-123"></div>
    <div class="field"><label>Email</label><input id="t_email" type="email" placeholder="you@email.com"></div>
    <button class="btn btn-primary" id="t_go">Check status</button>
    <div id="t_out" style="margin-top:18px"></div>
  </div>`;
  $('#t_go').onclick = async () => {
    const number = $('#t_num').value.trim(), email = $('#t_email').value.trim();
    const out = $('#t_out');
    if (!number || !email) { out.innerHTML = `<div class="note err">Please enter both fields.</div>`; return; }
    out.innerHTML = `<div class="hint">Checking…</div>`;
    try {
      const r = await api('/order/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, email }) });
      const steps = ['pending', 'paid', 'fulfilled'];
      const label = { pending: 'Placed', paid: 'Paid', fulfilled: 'Shipped', cancelled: 'Cancelled' };
      const idx = steps.indexOf(r.status);
      out.innerHTML = `<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px">
        <div class="sumrow total" style="border:none"><span>Order ${esc(r.number)}</span><span>${money(r.total_cents)}</span></div>
        <div class="sumrow"><span>Status</span><span class="free" style="text-transform:capitalize">${esc(label[r.status] || r.status)}</span></div>
        ${r.tracking_number ? `<div class="sumrow"><span>Tracking</span><span>${esc(r.tracking_number)}</span></div>` : ''}
        ${r.refunded_cents ? `<div class="sumrow"><span>Refunded</span><span>${money(r.refunded_cents)}</span></div>` : ''}
        <div style="margin:14px 0 4px;display:flex;gap:6px">${steps.map((s, i) => `<div style="flex:1;height:6px;border-radius:3px;background:${i <= idx && r.status !== 'cancelled' ? 'var(--teal)' : 'var(--seafoam)'}"></div>`).join('')}</div>
        <div class="hint">${esc(r.items.map(i => `${i.qty}× ${i.title}${i.size ? ' (' + i.size + ')' : ''}`).join(', '))}</div>
      </div>`;
    } catch (e) { out.innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
  };
}

function viewPrivacy() {
  const s = State.store;
  setSEO({ title: 'Privacy Policy — Zanobia Sewing', desc: 'How Zanobia Sewing collects and uses your data.', ld: null });
  const paras = String(s.privacy_policy || '').split(/\n+/).filter(Boolean);
  $('#app').innerHTML = `<div class="legal">
    <div class="kicker" style="color:var(--gold);font-weight:600;letter-spacing:.2em;text-transform:uppercase;font-size:11px">Zanobia Sewing</div>
    <h1>Privacy & Data</h1>
    ${paras.map(p => `<p>${esc(p)}</p>`).join('')}
    <div class="back"><a class="btn btn-ghost" href="/" data-nav>Back to shop</a></div>
  </div>`;
}

/* ── Footer ── */
function renderFooter() {
  const s = State.store, so = s.social || {};
  const ig = `<svg viewBox="0 0 24 24"><path d="M12 2c2.7 0 3 0 4.1.1 1 .1 1.7.2 2.3.5.6.2 1.1.5 1.6 1s.8 1 .9 1.6c.3.6.4 1.3.5 2.3.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 1-.2 1.7-.5 2.3-.2.6-.5 1.1-1 1.6s-1 .8-1.6.9c-.6.3-1.3.4-2.3.5-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-1-.1-1.7-.2-2.3-.5-.6-.2-1.1-.5-1.6-1s-.8-1-.9-1.6c-.3-.6-.4-1.3-.5-2.3C2 15 2 14.7 2 12s0-3 .1-4.1c.1-1 .2-1.7.5-2.3.2-.6.5-1.1 1-1.6s1-.8 1.6-.9c.6-.3 1.3-.4 2.3-.5C8.9 2 9.3 2 12 2zm0 5a5 5 0 100 10 5 5 0 000-10zm0 8.2a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4zM17.8 7a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z"/></svg>`;
  const fb = `<svg viewBox="0 0 24 24"><path d="M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0022 12z"/></svg>`;
  const tt = `<svg viewBox="0 0 24 24"><path d="M16 3c.3 2.1 1.6 3.6 3.7 3.8v2.4c-1.3.1-2.5-.3-3.7-1v6.3a5.6 5.6 0 11-5.6-5.6c.3 0 .6 0 .9.1v2.5a3.1 3.1 0 102.2 3V3H16z"/></svg>`;
  const pin = `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 00-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.5 2.2-.8 3.4-.2 1 .5 1.8 1.5 1.8 1.8 0 3.1-2.3 3.1-5 0-2.1-1.4-3.6-3.9-3.6-2.8 0-4.5 2.1-4.5 4.4 0 .8.2 1.4.6 1.9.2.2.2.3.1.5l-.2.9c-.1.3-.3.4-.6.2-1.1-.5-1.7-1.9-1.7-3.1 0-2.5 2.1-5.5 6.2-5.5 3.3 0 5.5 2.4 5.5 5 0 3.4-1.9 5.9-4.6 5.9-.9 0-1.8-.5-2.1-1.1l-.6 2.3c-.2.8-.6 1.6-1 2.2A10 10 0 1012 2z"/></svg>`;
  const link = (u, svg, name) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${name}">${svg}</a>` : '';
  $('#footer').innerHTML = `<div class="wrap">
    <div class="brand"><img class="em" src="/img/emblem.svg" alt="" width="32" height="25"><span class="tx">Zanobia<small>Sewing</small></span></div>
    <div class="foot-grid">
      <div>
        <p style="max-width:36ch;opacity:.9">Chic. Timeless. You. Hand-finished, block-print inspired pieces, shipped across the United States.</p>
        <div class="socials">${link(so.instagram, ig, 'Instagram')}${link(so.facebook, fb, 'Facebook')}${link(so.tiktok, tt, 'TikTok')}${link(so.pinterest, pin, 'Pinterest')}</div>
      </div>
      <div><h4>Shop</h4>
        <p><a href="/" data-nav>New Arrivals</a></p>
        <p><a href="/" data-nav>Summer Collection</a></p>
        <p><a href="/" data-nav>Sale</a></p>
        <p><a href="/wishlist" data-nav>Wishlist</a></p>
      </div>
      <div><h4>Boutique</h4>
        <p><a href="mailto:${esc(s.store_email)}">${esc(s.store_email)}</a></p>
        <p>${esc(s.phone)}</p>
        <p><a href="/track" data-nav>Track order</a></p>
        <p><a href="/privacy" data-nav>Privacy Policy</a></p>
        <p><a href="/admin">Store admin</a></p>
      </div>
    </div>
    <div class="foot-fine">© ${new Date().getFullYear()} Zanobia Sewing · Wear your craft with pride · New here? Use <b>${esc(s.promo_code)}</b> for ${s.promo_percent}% off your first order.</div>
  </div>`;
}

/* ── Search (inline bar) ── */
const searchbar = $('#searchbar'), searchInput = $('#searchInput');
function toggleSearch() { const on = searchbar.classList.toggle('on'); if (on) setTimeout(() => searchInput.focus(), 60); }
$('#searchBtn').onclick = toggleSearch;
$('#wishBtn').onclick = () => nav('/wishlist');
async function runSearch() {
  const q = searchInput.value.trim(); if (!q) return;
  searchbar.classList.remove('on');
  const items = await api('/products?q=' + encodeURIComponent(q)).catch(() => []);
  setSEO({ title: `“${q}” — Zanobia Sewing`, desc: `Search results for ${q}.`, ld: null });
  history.pushState({}, '', '/'); window.scrollTo(0, 0);
  $('#app').innerHTML = `<div class="wrap" style="padding-top:20px">
    <div class="sec-head"><div><div class="kicker">Search</div><h2>Results for “${esc(q)}”</h2></div><a class="link-gold" href="/" data-nav>Clear</a></div>
    <div class="grid">${items.length ? items.map(card).join('') : `<div class="empty" style="grid-column:1/-1">No matches for “${esc(q)}”. Try “linen”, “dress” or “bag”.</div>`}</div></div>`;
}
$('#searchGo').onclick = runSearch;
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); if (e.key === 'Escape') searchbar.classList.remove('on'); });

/* ── Boot ── */
(async function init() {
  try {
    State.store = await api('/store');
    $('#promo').innerHTML = `Wear your culture with pride — <b>${State.store.promo_percent}% off</b> your first order with code <b>${esc(State.store.promo_code)}</b>`;
    document.getElementById('ld-org').textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Store', name: State.store.store_name, telephone: State.store.phone, email: State.store.store_email, address: State.store.address });
    renderFooter(); renderCartCount(); route();
  } catch (e) {
    $('#app').innerHTML = `<div class="wrap"><div class="empty">Couldn't reach the store. Is the server running?<br><small>${esc(e.message)}</small></div></div>`;
  }
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
