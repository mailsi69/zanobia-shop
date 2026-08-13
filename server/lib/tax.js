'use strict';
/**
 * USA sales-tax calculator.
 *
 * These are STATE-LEVEL BASE rates (as decimals). Real US sales tax also has
 * county/city district rates and product-category rules (some states exempt
 * clothing entirely, e.g. no state clothing tax in a handful of states).
 * For production compliance, plug in a tax API (Stripe Tax, TaxJar, Avalara)
 * in calcTax() — the rest of the app already passes it the taxable base + state.
 *
 * Rates below are approximate state base rates and are meant to be a sane
 * default that Super Admin can override per deployment.
 */

// Approximate state base sales-tax rates. 0 = no statewide sales tax.
const STATE_TAX = {
  AL:0.04, AK:0.00, AZ:0.056, AR:0.065, CA:0.0725, CO:0.029, CT:0.0635, DE:0.00,
  DC:0.06, FL:0.06, GA:0.04, HI:0.04, ID:0.06, IL:0.0625, IN:0.07, IA:0.06,
  KS:0.065, KY:0.06, LA:0.0445, ME:0.055, MD:0.06, MA:0.0625, MI:0.06, MN:0.06875,
  MS:0.07, MO:0.04225, MT:0.00, NE:0.055, NV:0.0685, NH:0.00, NJ:0.06625,
  NM:0.04875, NY:0.04, NC:0.0475, ND:0.05, OH:0.0575, OK:0.045, OR:0.00,
  PA:0.06, RI:0.07, SC:0.06, SD:0.042, TN:0.07, TX:0.0625, UT:0.0485, VT:0.06,
  VA:0.053, WA:0.065, WV:0.06, WI:0.05, WY:0.04
};

// States with NO state-level tax on most clothing (apparel exemption).
const CLOTHING_EXEMPT = new Set(['MN', 'NJ', 'PA', 'VT']); // simplified; MA/NY/RI have thresholds

/**
 * @param {{state:string, taxableCents:number, shippingCents:number, isApparel?:boolean}} p
 * @returns {{cents:number, rate:number, exempt:boolean}}
 */
function calcTax({ state = '', taxableCents = 0, shippingCents = 0, isApparel = true }) {
  const st = String(state || '').toUpperCase();
  const { getSetting } = require('../db');

  // Super Admin can override the whole rate table via settings.tax_overrides
  const overrides = getSetting('tax_overrides', {}) || {};
  let rate = (st in overrides) ? Number(overrides[st]) : (STATE_TAX[st] ?? 0);

  const exempt = isApparel && CLOTHING_EXEMPT.has(st);
  if (exempt) rate = 0;

  const taxShipping = getSetting('ship_tax_shipping', false);
  const base = taxableCents + (taxShipping ? shippingCents : 0);

  const cents = Math.round(base * rate);
  return { cents, rate, exempt };
}

module.exports = { calcTax, STATE_TAX };
