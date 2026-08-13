'use strict';
/**
 * USA-only shipping calculator.
 * Rate = base + (per-lb * additional pounds), with an Alaska/Hawaii surcharge,
 * unless the order subtotal clears the free-shipping threshold.
 *
 * All money in integer cents. Weight from product.weight_oz (16 oz = 1 lb).
 */
const { getSetting } = require('../db');

// 50 states + DC + common territories we ship to.
const US_STATES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',
  LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
  WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
};

function isUsState(code) {
  return Object.prototype.hasOwnProperty.call(US_STATES, String(code || '').toUpperCase());
}

/**
 * @param {{items: Array<{weight_oz:number, qty:number}>, subtotalCents:number, state:string, country:string}} p
 * @returns {{cents:number, freeApplied:boolean, totalWeightLb:number}}
 */
function calcShipping({ items = [], subtotalCents = 0, state = '', country = 'US' }) {
  if (String(country).toUpperCase() !== 'US' && country !== 'USA') {
    const err = new Error('Zanobia currently ships within the United States only.');
    err.code = 'NON_US';
    throw err;
  }
  const st = String(state || '').toUpperCase();
  if (!isUsState(st)) {
    const err = new Error('Enter a valid US state to calculate shipping.');
    err.code = 'BAD_STATE';
    throw err;
  }

  const base = getSetting('ship_base_cents', 695);
  const perLb = getSetting('ship_per_lb_cents', 250);
  const akhi = getSetting('ship_akhi_surcharge_cents', 900);
  const freeThreshold = getSetting('free_ship_threshold_cents', 15000);

  const totalOz = items.reduce((s, it) => s + (Number(it.weight_oz) || 0) * (Number(it.qty) || 1), 0);
  const totalLb = Math.max(1, Math.ceil(totalOz / 16)); // bill at least 1 lb

  if (subtotalCents >= freeThreshold) {
    return { cents: 0, freeApplied: true, totalWeightLb: totalLb };
  }

  let cents = base + perLb * (totalLb - 1);
  if (st === 'AK' || st === 'HI') cents += akhi;

  return { cents, freeApplied: false, totalWeightLb: totalLb };
}

module.exports = { calcShipping, isUsState, US_STATES };
