'use strict';
/**
 * Payment abstraction.
 *  • If STRIPE_SECRET_KEY is set → real payments via Stripe Checkout (a secure,
 *    Stripe-hosted page that handles card entry, 3-D Secure/SCA and PCI for you).
 *  • Otherwise → a MOCK gateway that "captures" instantly, so the whole
 *    checkout → paid → email flow works with zero external accounts (demo mode).
 */
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); }
  catch { console.warn('⚠ stripe package not installed; using mock gateway. Run: npm i stripe'); }
}
const mode = stripe ? 'stripe' : 'mock';

/**
 * Begin a payment for an order.
 * Stripe mode → returns { mode, ref:sessionId, url } (client redirects to url).
 * Mock mode   → returns { mode, ref, captured:true } (finalize immediately).
 */
async function startPayment({ order, successUrl, cancelUrl }) {
  if (stripe) {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: order.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: order.total_cents,
          product_data: { name: `Zanobia Sewing — order ${order.number}` }
        }
      }],
      // total already includes our calculated shipping + tax
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { order: order.number },
      payment_intent_data: { metadata: { order: order.number } }
    });
    return { mode, ref: session.id, url: session.url, captured: false };
  }
  return { mode, ref: 'mock_' + Math.random().toString(36).slice(2, 12), url: null, captured: true };
}

/**
 * Confirm a payment. In Stripe mode, pass the Checkout session id returned to
 * the browser. Returns { paid, paymentRef } where paymentRef is the PaymentIntent
 * id (used later for refunds).
 */
async function confirmPayment({ sessionId, existingRef }) {
  if (!stripe) return { paid: true, paymentRef: existingRef || 'mock' };
  if (existingRef && existingRef.startsWith('pi_')) {
    const pi = await stripe.paymentIntents.retrieve(existingRef);
    return { paid: pi.status === 'succeeded', paymentRef: existingRef };
  }
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  return { paid: s.payment_status === 'paid', paymentRef: s.payment_intent || sessionId };
}

/** Refund a payment (full or partial). Returns { ok, id } or throws. */
async function refundPayment({ paymentRef, amountCents }) {
  if (!stripe) return { ok: true, id: 'mock_refund', mock: true };
  if (!paymentRef || !paymentRef.startsWith('pi_')) throw new Error('No Stripe payment on this order to refund.');
  const r = await stripe.refunds.create({ payment_intent: paymentRef, ...(amountCents ? { amount: amountCents } : {}) });
  return { ok: r.status === 'succeeded' || r.status === 'pending', id: r.id };
}

module.exports = {
  startPayment, confirmPayment, refundPayment,
  paymentMode: mode, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
};
