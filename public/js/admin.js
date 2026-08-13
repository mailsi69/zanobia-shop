'use strict';
/* ═══ Zanobia Sewing — admin console ═══ */
const $ = (s, r = document) => r.querySelector(s);
const money = c => '$' + (Number(c || 0) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
let TOKEN = localStorage.getItem('zs_admin_token') || '';
let ME = null;

function api(path, { method = 'GET', body } = {}) {
  return fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Request failed'); return d; });
}
const isSuper = () => ME && ME.role === 'super_admin';

/* ── Auth ── */
async function boot() {
  if (TOKEN) {
    try { ME = (await api('/auth/me')).user; return dashboard(); }
    catch { TOKEN = ''; localStorage.removeItem('zs_admin_token'); }
  }
  loginView();
}
function loginView() {
  $('#rolePill').classList.add('hidden'); $('#logoutBtn').classList.add('hidden');
  $('#app').innerHTML = `<div class="login-box">
    <h1>Store admin</h1>
    <p class="hint" style="margin-bottom:18px">Sign in to manage inventory and orders.</p>
    <div class="field"><label>Email</label><input id="le" type="email" placeholder="admin@zanobiasewing.com"></div>
    <div class="field"><label>Password</label><input id="lp" type="password" placeholder="••••••••"></div>
    <div id="lerr"></div>
    <button class="btn btn-primary" id="loginBtn" style="margin-top:8px">Sign in</button>
    <p class="hint" style="margin-top:16px">Demo: <b>super@zanobiasewing.com</b> / changeme-super · <b>admin@zanobiasewing.com</b> / changeme-admin</p>
  </div>`;
  const go = async () => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } });
      TOKEN = r.token; localStorage.setItem('zs_admin_token', TOKEN); ME = r.user; dashboard();
    } catch (e) { $('#lerr').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
  };
  $('#loginBtn').onclick = go;
  $('#lp').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
$('#logoutBtn').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); TOKEN = ''; localStorage.removeItem('zs_admin_token'); ME = null; boot(); };

/* ── Dashboard shell ── */
let TAB = 'products';
function dashboard() {
  $('#rolePill').textContent = ME.role.replace('_', ' '); $('#rolePill').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  const tabs = [['products', 'Products'], ['orders', 'Orders']];
  if (isSuper()) tabs.push(['settings', 'Store settings'], ['customers', 'Customers'], ['staff', 'Staff']);
  $('#app').innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${TAB === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="tabBody"></div>`;
  $('#app').querySelectorAll('.tab').forEach(t => t.onclick = () => { TAB = t.dataset.tab; dashboard(); });
  ({ products: tabProducts, orders: tabOrders, settings: tabSettings, customers: tabCustomers, staff: tabStaff }[TAB])();
}

/* ── Products ── */
async function tabProducts() {
  const body = $('#tabBody');
  body.innerHTML = `<div class="toolbar"><h2>Inventory</h2><button class="btn btn-primary" style="width:auto" id="newP">+ Upload product</button></div><div class="panel"><table><thead><tr><th></th><th>Product</th><th class="hide-sm">Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody id="prows"><tr><td colspan="7" style="padding:24px;color:var(--stone)">Loading…</td></tr></tbody></table></div>`;
  $('#newP').onclick = () => productModal(null);
  const items = await api('/admin/products').catch(e => { alert(e.message); return []; });
  $('#prows').innerHTML = items.map(p => `<tr>
    <td><img class="thumb" src="${esc((p.images || [])[0] || '')}" alt=""></td>
    <td><b>${esc(p.title)}</b>${p.featured ? ' <span class="pill" style="background:#f6edd6;color:var(--gold-2)">★ featured</span>' : ''}<br><span class="hint">/${esc(p.slug)}</span></td>
    <td class="hide-sm">${esc(p.category)}</td>
    <td>${money(p.price_cents)}${p.on_sale ? `<br><span class="hint" style="text-decoration:line-through">${money(p.compare_at_cents)}</span>` : ''}</td>
    <td>${p.stock}</td>
    <td><span class="pill ${p.status}">${p.status}</span></td>
    <td style="white-space:nowrap;text-align:right">
      ${p.status !== 'active' ? `<button class="mini" data-act="publish" data-id="${p.id}">Publish</button>` : `<button class="mini" data-act="draft" data-id="${p.id}">Draft</button>`}
      <button class="mini dark" data-act="edit" data-id="${p.id}">Edit</button>
      <button class="mini danger" data-act="del" data-id="${p.id}">✕</button>
    </td></tr>`).join('') || `<tr><td colspan="7" style="padding:24px;color:var(--stone)">No products yet. Click “Upload product”.</td></tr>`;
  body.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const id = b.dataset.id, act = b.dataset.act;
    const p = items.find(x => x.id == id);
    if (act === 'edit') return productModal(p);
    if (act === 'del') { if (confirm(`Delete "${p.title}"? This can’t be undone.`)) { await api('/admin/products/' + id, { method: 'DELETE' }); tabProducts(); } return; }
    if (act === 'publish') { await api('/admin/products/' + id + '/status', { method: 'PATCH', body: { status: 'active' } }); tabProducts(); }
    if (act === 'draft') { await api('/admin/products/' + id + '/status', { method: 'PATCH', body: { status: 'draft' } }); tabProducts(); }
  });
}

let modalImages = [];
function productModal(p) {
  modalImages = p ? [...(p.images || [])] : [];
  const arr = a => (a || []).join(', ');
  openModal(`${p ? 'Edit' : 'Upload'} product`, `
    <div class="field"><label>Title</label><input id="m_title" value="${esc(p?.title || '')}"></div>
    <div class="field"><label>Description</label><textarea id="m_desc" rows="3" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px">${esc(p?.description || '')}</textarea></div>
    <div class="grid2">
      <div class="field"><label>Price (USD)</label><input id="m_price" inputmode="decimal" value="${p ? (p.price_cents / 100).toFixed(2) : ''}"></div>
      <div class="field"><label>Compare-at / was (optional)</label><input id="m_compare" inputmode="decimal" value="${p && p.compare_at_cents ? (p.compare_at_cents / 100).toFixed(2) : ''}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Category</label><input id="m_cat" value="${esc(p?.category || 'General')}"></div>
      <div class="field"><label>Stock</label><input id="m_stock" inputmode="numeric" value="${p?.stock ?? 0}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Sizes (comma-separated)</label><input id="m_sizes" value="${esc(arr(p?.sizes))}"></div>
      <div class="field"><label>Colours (comma-separated)</label><input id="m_colors" value="${esc(arr(p?.colors))}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Weight (oz, for shipping)</label><input id="m_weight" inputmode="decimal" value="${p?.weight_oz ?? 12}"></div>
      <div class="field"><label>Status</label><select id="m_status">
        ${['draft', 'active', 'archived'].map(s => `<option value="${s}" ${(p?.status || 'draft') === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    </div>
    <label class="switch" style="margin:6px 0 14px"><input type="checkbox" id="m_featured" ${p?.featured ? 'checked' : ''}> Feature in Highlights rail</label>

    <div class="field"><label>Images</label>
      <div class="imgrow" id="imgrow"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="m_imgurl" placeholder="Paste image URL" style="flex:1;padding:10px;border:1px solid var(--line);border-radius:8px">
        <button class="mini" id="addUrl">Add URL</button>
        <label class="mini" style="cursor:pointer">Upload<input type="file" id="m_file" accept="image/*" multiple hidden></label>
      </div>
    </div>

    <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">SEO (title & description)</summary>
      <div class="field" style="margin-top:10px"><label>SEO title</label><input id="m_seotitle" value="${esc(p?.seo_title || '')}"></div>
      <div class="field"><label>SEO description</label><input id="m_seodesc" value="${esc(p?.seo_description || '')}"></div>
    </details>

    <div id="m_err"></div>
    <button class="btn btn-primary" id="m_save" style="margin-top:12px">${p ? 'Save changes' : 'Upload to store'}</button>
  `);
  renderImgRow();
  $('#addUrl').onclick = () => { const u = $('#m_imgurl').value.trim(); if (u) { modalImages.push(u); $('#m_imgurl').value = ''; renderImgRow(); } };
  $('#m_file').onchange = async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('images', f));
    const r = await fetch('/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd }).then(x => x.json()).catch(() => ({ urls: [] }));
    modalImages.push(...(r.urls || [])); renderImgRow();
  };
  $('#m_save').onclick = () => saveProduct(p);
}
function renderImgRow() {
  $('#imgrow').innerHTML = modalImages.map((u, i) => `<div class="ic"><img src="${esc(u)}" alt=""><button class="x" data-i="${i}">✕</button></div>`).join('') || '<span class="hint">No images yet.</span>';
  $('#imgrow').querySelectorAll('.x').forEach(b => b.onclick = () => { modalImages.splice(+b.dataset.i, 1); renderImgRow(); });
}
const dollarsToCents = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : Math.round(n * 100); };
const csv = v => v.split(',').map(s => s.trim()).filter(Boolean);

async function saveProduct(p) {
  const body = {
    title: $('#m_title').value.trim(),
    description: $('#m_desc').value.trim(),
    price_cents: dollarsToCents($('#m_price').value),
    compare_at_cents: $('#m_compare').value.trim() ? dollarsToCents($('#m_compare').value) : null,
    category: $('#m_cat').value.trim() || 'General',
    stock: parseInt($('#m_stock').value) || 0,
    sizes: csv($('#m_sizes').value), colors: csv($('#m_colors').value),
    weight_oz: parseFloat($('#m_weight').value) || 12,
    status: $('#m_status').value,
    featured: $('#m_featured').checked,
    images: modalImages,
    seo_title: $('#m_seotitle').value.trim(), seo_description: $('#m_seodesc').value.trim()
  };
  if (!body.title) return $('#m_err').innerHTML = `<div class="note err">Title is required.</div>`;
  try {
    if (p) await api('/admin/products/' + p.id, { method: 'PUT', body });
    else await api('/admin/products', { method: 'POST', body });
    closeModal(); tabProducts();
  } catch (e) { $('#m_err').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
}

/* ── Orders ── */
async function tabOrders() {
  const body = $('#tabBody');
  body.innerHTML = `<div class="toolbar"><h2>Orders</h2></div><div id="ostat" class="stat"></div><div class="panel"><table><thead><tr><th>Order</th><th class="hide-sm">Customer</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody id="orows"><tr><td colspan="5" style="padding:24px;color:var(--stone)">Loading…</td></tr></tbody></table></div>`;
  const orders = await api('/admin/orders').catch(e => { alert(e.message); return []; });
  const stats = await api('/admin/stats').catch(() => null);
  if (stats) {
    $('#ostat').innerHTML = `
      <div class="box"><b>${money(stats.net_cents)}</b><span>Net revenue</span></div>
      <div class="box"><b>${stats.paid_orders}</b><span>Paid orders</span></div>
      <div class="box"><b>${stats.pending_orders}</b><span>Pending</span></div>
      ${stats.refunded_cents ? `<div class="box"><b>${money(stats.refunded_cents)}</b><span>Refunded</span></div>` : ''}`;
    const extra = [];
    if (stats.top_products && stats.top_products.length) extra.push('Top sellers: ' + stats.top_products.map(t => `${esc(t.title)} (${t.qty})`).join(', '));
    if (stats.low_stock && stats.low_stock.length) extra.push('Low stock: ' + stats.low_stock.map(l => `${esc(l.title)} (${l.stock})`).join(', '));
    if (extra.length) $('#ostat').insertAdjacentHTML('afterend', `<p class="hint" style="margin:2px 0 12px">${extra.join(' · ')}</p>`);
  } else {
    const paid = orders.filter(o => o.payment_status === 'paid'); const rev = paid.reduce((s, o) => s + o.total_cents, 0);
    $('#ostat').innerHTML = `<div class="box"><b>${orders.length}</b><span>Orders</span></div><div class="box"><b>${money(rev)}</b><span>Paid revenue</span></div>`;
  }
  $('#orows').innerHTML = orders.map(o => `<tr>
    <td><b>${esc(o.number)}</b><br><span class="hint">${new Date(o.created_at + 'Z').toLocaleString()}</span></td>
    <td class="hide-sm">${esc(o.customer_name || '—')}<br><span class="hint">${esc(o.email)}</span></td>
    <td>${money(o.total_cents)}${o.discount_code ? `<br><span class="hint">${esc(o.discount_code)}</span>` : ''}</td>
    <td><span class="pill ${o.status}">${o.status}</span></td>
    <td style="text-align:right"><button class="mini dark" data-id="${o.id}">View</button></td></tr>`).join('') || `<tr><td colspan="5" style="padding:24px;color:var(--stone)">No orders yet.</td></tr>`;
  body.querySelectorAll('[data-id]').forEach(b => b.onclick = () => orderModal(orders.find(o => o.id == b.dataset.id)));
}
function orderModal(o) {
  const a = o.ship_address || {};
  openModal('Order ' + o.number, `
    <div class="stat" style="margin-bottom:10px">
      <div class="box"><b>${money(o.total_cents)}</b><span>Total</span></div>
      <div class="box"><b>${esc(o.payment_status)}</b><span>Payment</span></div>
    </div>
    <table style="margin-bottom:14px"><tbody>
      ${o.items.map(i => `<tr><td>${esc(i.title)}${i.size ? ` · ${esc(i.size)}` : ''} ×${i.qty}</td><td style="text-align:right">${money(i.price_cents * i.qty)}</td></tr>`).join('')}
      <tr><td>Subtotal</td><td style="text-align:right">${money(o.subtotal_cents)}</td></tr>
      ${o.discount_cents ? `<tr><td>Discount ${esc(o.discount_code || '')}</td><td style="text-align:right">−${money(o.discount_cents)}</td></tr>` : ''}
      <tr><td>Shipping</td><td style="text-align:right">${money(o.shipping_cents)}</td></tr>
      <tr><td>Tax</td><td style="text-align:right">${money(o.tax_cents)}</td></tr>
    </tbody></table>
    <p><b>Ship to</b><br>${esc(o.customer_name || '')}<br>${esc(a.line1 || '')}${a.line2 ? ', ' + esc(a.line2) : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}<br>${esc(o.email)} · ${esc(o.phone || '—')}</p>
    <div class="field" style="margin-top:14px"><label>Update status</label>
      <select id="o_status">${['pending', 'paid', 'fulfilled', 'cancelled'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Tracking number (emails the customer when saved)</label>
      <input id="o_track" value="${esc(o.tracking_number || '')}" placeholder="e.g. 9400 1000 0000 0000"></div>
    ${o.refunded_cents ? `<p class="hint">Refunded so far: ${money(o.refunded_cents)}</p>` : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" id="o_save" style="flex:1">Save &amp; notify</button>
      ${(ME && ME.role === 'super_admin' && o.payment_status === 'paid' && (o.refunded_cents || 0) < o.total_cents)
        ? `<button class="btn btn-ghost" id="o_refund" style="flex:1">Refund</button>` : ''}
    </div>`);
  $('#o_save').onclick = async () => {
    try { await api('/admin/orders/' + o.id, { method: 'PATCH', body: { status: $('#o_status').value, tracking_number: $('#o_track').value } }); closeModal(); tabOrders(); }
    catch (e) { alert(e.message); }
  };
  const rb = $('#o_refund');
  if (rb) rb.onclick = async () => {
    if (!confirm(`Refund ${money(o.total_cents - (o.refunded_cents || 0))} to the customer? This cannot be undone.`)) return;
    try { await api('/super/orders/' + o.id + '/refund', { method: 'POST', body: {} }); closeModal(); tabOrders(); }
    catch (e) { alert(e.message); }
  };
}

/* ── Settings (super admin) ── */
async function tabSettings() {
  const body = $('#tabBody');
  const s = await api('/super/settings').catch(e => { alert(e.message); return {}; });
  const so = s.social || {};
  const d = c => ((c || 0) / 100).toFixed(2);
  body.innerHTML = `<div class="toolbar"><h2>Store settings</h2></div>
  <div class="panel" style="padding:20px">
    <h3 style="margin-bottom:12px">Identity</h3>
    <div class="grid2">
      <div class="field"><label>Store name</label><input id="s_name" value="${esc(s.store_name)}"></div>
      <div class="field"><label>Tagline</label><input id="s_tag" value="${esc(s.tagline)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Owner / order email</label><input id="s_email" value="${esc(s.store_email)}"></div>
      <div class="field"><label>Phone</label><input id="s_phone" value="${esc(s.phone)}"></div>
    </div>
    <div class="field"><label>Address</label><input id="s_addr" value="${esc(s.address)}"></div>

    <div class="seam" style="margin:20px 0"></div><h3 style="margin-bottom:12px">Shipping (USA) & tax</h3>
    <div class="grid2">
      <div class="field"><label>Free shipping over ($)</label><input id="s_free" value="${d(s.free_ship_threshold_cents)}"></div>
      <div class="field"><label>Base shipping ($)</label><input id="s_base" value="${d(s.ship_base_cents)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Per extra lb ($)</label><input id="s_perlb" value="${d(s.ship_per_lb_cents)}"></div>
      <div class="field"><label>AK/HI surcharge ($)</label><input id="s_akhi" value="${d(s.ship_akhi_surcharge_cents)}"></div>
    </div>
    <label class="switch"><input type="checkbox" id="s_taxship" ${s.ship_tax_shipping ? 'checked' : ''}> Apply sales tax to shipping</label>
    <p class="hint" style="margin-top:8px">State sales-tax rates are built in per state. Override any state below as <code>{"CA":0.075}</code>. For full local-rate compliance, connect a tax API (see README).</p>
    <div class="field"><label>Tax rate overrides (JSON)</label><input id="s_taxov" value='${esc(JSON.stringify(s.tax_overrides || {}))}'></div>

    <div class="seam" style="margin:20px 0"></div><h3 style="margin-bottom:12px">Promo & SEO</h3>
    <div class="grid2">
      <div class="field"><label>First-order promo code</label><input id="s_code" value="${esc(s.promo_code)}"></div>
      <div class="field"><label>Promo percent</label><input id="s_pct" value="${esc(s.promo_percent)}"></div>
    </div>
    <div class="field"><label>SEO title</label><input id="s_seotitle" value="${esc(s.seo_title)}"></div>
    <div class="field"><label>SEO description</label><input id="s_seodesc" value="${esc(s.seo_description)}"></div>

    <div class="seam" style="margin:20px 0"></div><h3 style="margin-bottom:12px">Customer data & privacy</h3>
    <label class="switch"><input type="checkbox" id="s_collect" ${s.collect_customer_data ? 'checked' : ''}> Collect opted-in customers for future deals</label>
    <div class="field" style="margin-top:12px"><label>Marketing consent label (shown at checkout)</label><input id="s_consentlabel" value="${esc(s.marketing_consent_label)}"></div>
    <div class="field"><label>Privacy policy</label><textarea id="s_privacy" rows="6" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px">${esc(s.privacy_policy)}</textarea></div>

    <div class="seam" style="margin:20px 0"></div><h3 style="margin-bottom:12px">Social media</h3>
    <div class="grid2">
      <div class="field"><label>Instagram</label><input id="s_ig" value="${esc(so.instagram || '')}"></div>
      <div class="field"><label>Facebook</label><input id="s_fb" value="${esc(so.facebook || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>TikTok</label><input id="s_tt" value="${esc(so.tiktok || '')}"></div>
      <div class="field"><label>Pinterest</label><input id="s_pin" value="${esc(so.pinterest || '')}"></div>
    </div>
    <div id="s_err"></div>
    <button class="btn btn-primary" id="s_save" style="margin-top:8px">Save all settings</button>
  </div>`;
  $('#s_save').onclick = async () => {
    let taxov = {}; try { taxov = JSON.parse($('#s_taxov').value || '{}'); } catch { return $('#s_err').innerHTML = `<div class="note err">Tax overrides must be valid JSON.</div>`; }
    const c = v => Math.round((parseFloat(v) || 0) * 100);
    const body = {
      store_name: $('#s_name').value, tagline: $('#s_tag').value, store_email: $('#s_email').value,
      phone: $('#s_phone').value, address: $('#s_addr').value,
      free_ship_threshold_cents: c($('#s_free').value), ship_base_cents: c($('#s_base').value),
      ship_per_lb_cents: c($('#s_perlb').value), ship_akhi_surcharge_cents: c($('#s_akhi').value),
      ship_tax_shipping: $('#s_taxship').checked, tax_overrides: taxov,
      promo_code: $('#s_code').value.toUpperCase(), promo_percent: parseFloat($('#s_pct').value) || 0,
      seo_title: $('#s_seotitle').value, seo_description: $('#s_seodesc').value,
      collect_customer_data: $('#s_collect').checked,
      marketing_consent_label: $('#s_consentlabel').value,
      privacy_policy: $('#s_privacy').value,
      social: { instagram: $('#s_ig').value, facebook: $('#s_fb').value, tiktok: $('#s_tt').value, pinterest: $('#s_pin').value }
    };
    try { await api('/super/settings', { method: 'PUT', body }); $('#s_err').innerHTML = `<div class="note ok">Saved.</div>`; }
    catch (e) { $('#s_err').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
  };
}

/* ── Customers (super admin) ── */
async function tabCustomers() {
  const body = $('#tabBody');
  const list = await api('/super/customers').catch(e => { alert(e.message); return []; });
  const spent = list.reduce((s, c) => s + c.total_spent_cents, 0);
  body.innerHTML = `<div class="toolbar"><h2>Customers</h2>
      <a class="btn btn-primary" style="width:auto;text-decoration:none" href="/api/super/customers.csv?token=${encodeURIComponent(TOKEN)}" id="expBtn">Export CSV</a></div>
    <div class="stat">
      <div class="box"><b>${list.length}</b><span>Opted-in customers</span></div>
      <div class="box"><b>${money(spent)}</b><span>Lifetime revenue</span></div>
    </div>
    <p class="hint" style="margin-bottom:14px">These customers ticked the marketing consent box at checkout. Use the list for future deals; honour unsubscribe requests.</p>
    <div class="panel"><table><thead><tr><th>Name</th><th>Email</th><th class="hide-sm">State</th><th>Orders</th><th>Spent</th></tr></thead><tbody>
    ${list.map(c => `<tr><td>${esc(c.name || '—')}</td><td>${esc(c.email)}</td><td class="hide-sm">${esc(c.state || '—')}</td><td>${c.orders_count}</td><td>${money(c.total_spent_cents)}</td></tr>`).join('') || `<tr><td colspan="5" style="padding:24px;color:var(--stone)">No opted-in customers yet. They'll appear here after a paid order with consent.</td></tr>`}
    </tbody></table></div>`;
  // CSV needs auth header; fetch as blob then download.
  $('#expBtn').onclick = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/super/customers.csv', { headers: { Authorization: 'Bearer ' + TOKEN } });
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'zanobia-customers.csv'; a.click(); URL.revokeObjectURL(url);
  };
}

/* ── Staff (super admin) ── */
async function tabStaff() {
  const body = $('#tabBody');
  const users = await api('/super/users').catch(e => { alert(e.message); return []; });
  body.innerHTML = `<div class="toolbar"><h2>Staff accounts</h2><button class="btn btn-primary" style="width:auto" id="newU">+ Add staff</button></div>
    <div class="panel"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td>${esc(u.name || '—')}</td><td>${esc(u.email)}</td><td><span class="pill ${u.role === 'super_admin' ? 'active' : 'draft'}">${u.role.replace('_', ' ')}</span></td>
      <td style="text-align:right;white-space:nowrap"><button class="mini" data-pw="${u.id}">Reset code</button> ${u.id === ME.id ? '<span class="hint">you</span>' : `<button class="mini danger" data-del="${u.id}">Remove</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="toolbar" style="margin-top:22px"><h2>Security &amp; backup</h2></div>
    <div class="panel" style="padding:18px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" style="width:auto" id="myPw">Change my password</button>
      <button class="btn btn-ghost" style="width:auto" id="dlBackup">Download database backup</button>
      <p class="hint" style="width:100%;margin-top:4px">Backups also run automatically (kept on the server disk). Download one before big changes.</p>
    </div>`;
  $('#newU').onclick = () => openModal('Add staff', `
    <div class="field"><label>Name</label><input id="u_name"></div>
    <div class="field"><label>Email</label><input id="u_email" type="email"></div>
    <div class="field"><label>Password</label><input id="u_pass" type="password"></div>
    <div class="field"><label>Role</label><select id="u_role"><option value="admin">admin — upload, draft, delete inventory</option><option value="super_admin">super admin — full control</option></select></div>
    <div id="u_err"></div><button class="btn btn-primary" id="u_save">Create account</button>`);
  const saveU = async () => {
    try { await api('/super/users', { method: 'POST', body: { name: $('#u_name').value, email: $('#u_email').value, password: $('#u_pass').value, role: $('#u_role').value } }); closeModal(); tabStaff(); }
    catch (e) { $('#u_err').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
  };
  $('#myPw').onclick = () => openModal('Change my password', `
    <div class="field"><label>Current password</label><input id="p_cur" type="password"></div>
    <div class="field"><label>New password (min 8 characters)</label><input id="p_new" type="password"></div>
    <div id="p_err"></div><button class="btn btn-primary" id="p_save">Update password</button>`);
  $('#dlBackup').onclick = async () => {
    try {
      const r = await fetch('/api/super/backup', { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!r.ok) throw new Error('Backup failed'); const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'zanobia-backup.db'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  };
  body.addEventListener('click', async e => {
    if (e.target.id === 'u_save') saveU();
    if (e.target.id === 'p_save') {
      try { await api('/auth/password', { method: 'POST', body: { current: $('#p_cur').value, next: $('#p_new').value } }); closeModal(); alert('Password updated.'); }
      catch (er) { $('#p_err').innerHTML = `<div class="note err">${esc(er.message)}</div>`; }
    }
    const pw = e.target.dataset?.pw;
    if (pw) {
      const np = prompt('Enter a new password for this staff member (min 8 characters):');
      if (np && np.length >= 8) { try { await api('/super/users/' + pw + '/password', { method: 'POST', body: { password: np } }); alert('Password reset.'); } catch (er) { alert(er.message); } }
      else if (np !== null) alert('Password must be at least 8 characters.');
    }
    const del = e.target.dataset?.del;
    if (del && confirm('Remove this staff member?')) { try { await api('/super/users/' + del, { method: 'DELETE' }); tabStaff(); } catch (er) { alert(er.message); } }
  });
}

/* ── Modal helpers ── */
function openModal(title, html) {
  $('#modal').innerHTML = `<header><h2 style="font-size:20px">${esc(title)}</h2><button class="icon-btn" id="mx"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="mbody">${html}</div>`;
  $('#modalScrim').classList.add('on'); $('#mx').onclick = closeModal;
}
function closeModal() { $('#modalScrim').classList.remove('on'); }
$('#modalScrim').addEventListener('click', e => { if (e.target.id === 'modalScrim') closeModal(); });

boot();
