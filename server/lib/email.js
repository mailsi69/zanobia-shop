'use strict';
/**
 * Email delivery. Uses SMTP if configured, otherwise writes .eml files to
 * server/outbox/ and logs to the console so the flow is fully testable offline.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const OUTBOX = path.join(__dirname, '..', 'outbox');
let transporter = null;

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || 'Zanobia Sewing <no-reply@zanobiasewing.com>';
  if (transporter) {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    return { delivered: true, id: info.messageId };
  }
  // Fallback: persist to outbox so nothing is lost in demo mode.
  if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${Date.now()}-${String(to).replace(/[^\w.@-]/g, '_')}.eml`);
  fs.writeFileSync(file, `To: ${to}\nFrom: ${from}\nSubject: ${subject}\n\n${text || html}`);
  console.log(`✉  [outbox] ${subject} -> ${to}  (${path.basename(file)})`);
  return { delivered: false, id: path.basename(file) };
}

const money = (c) => `$${(c / 100).toFixed(2)}`;

function orderEmails(order, store) {
  const lines = order.items
    .map((i) => `  • ${i.title}${i.size ? ` (${i.size})` : ''} ×${i.qty} — ${money(i.price_cents * i.qty)}`)
    .join('\n');
  const a = order.ship_address;
  const addr = `${a.line1}${a.line2 ? ', ' + a.line2 : ''}\n${a.city}, ${a.state} ${a.zip}\n${a.country}`;

  const ownerText =
`New order ${order.number}

${lines}

Subtotal:  ${money(order.subtotal_cents)}
Discount:  -${money(order.discount_cents)}${order.discount_code ? ` (${order.discount_code})` : ''}
Shipping:  ${money(order.shipping_cents)}
Tax:       ${money(order.tax_cents)}
TOTAL:     ${money(order.total_cents)}

Ship to: ${order.customer_name}
${addr}
Email: ${order.email}   Phone: ${order.phone || '—'}
Payment: ${order.payment_status} (${order.payment_ref || 'n/a'})`;

  const customerText =
`Thank you for your order, ${order.customer_name || 'friend'}!

Order ${order.number}

${lines}

Subtotal:  ${money(order.subtotal_cents)}
Discount:  -${money(order.discount_cents)}
Shipping:  ${money(order.shipping_cents)}
Tax:       ${money(order.tax_cents)}
TOTAL:     ${money(order.total_cents)}

We're preparing your pieces with care. You'll receive tracking when it ships.

— ${store.store_name}
${store.phone}  |  ${store.store_email}`;

  return {
    owner: { to: store.store_email, subject: `🧵 New order ${order.number} — ${money(order.total_cents)}`, text: ownerText },
    customer: { to: order.email, subject: `Your ${store.store_name} order ${order.number}`, text: customerText }
  };
}

module.exports = { sendMail, orderEmails };
