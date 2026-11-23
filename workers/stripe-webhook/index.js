// Title22 Stripe webhook.
//
// THIS IS WHAT IS DEPLOYED. Pushed 2026-09-07 with `wrangler deploy`, serving
// https://stripe-webhook.infomomtelo.workers.dev against the Stripe
// `memorable-wonder` destination. Before that the Worker was dashboard-only
// with no committed source; edit this file and redeploy, rather than pasting
// into the dashboard, or the two diverge again.
//
// What went wrong, and what this fixed:
//
// The old webhook mapped four live price IDs to a plan (starter, pro,
// specialist, agency) and wrote profiles.title22_*. The $29 Lite price was not
// in that map. So a Lite payment arrived, the webhook could not name a plan,
// and nothing was written — the customer stayed on "Free Trial" while their
// card was charged. PRICE_PLANS below is the fix.
//
// CLOSED since: this writes profiles and subscriptions, never `users`, and it
// turned out `public.users` does not exist at all — its migration was never
// run. welcomeIsPaid() no longer reads it; it resolves the entitlement from
// the two stores that are actually written. Do not add a users upsert here to
// "finish" this — a third store is what the note above was warning about.
//
// No npm dependencies, matching the other Workers here: the Stripe signature
// is verified with Web Crypto directly rather than pulling in the SDK, because
// this repo has no build step.

// Live price ID -> plan key. The four legacy IDs are from workers/README.md.
// Add the Lite and Multi-Home prices; a price that is not in this map is
// reported and ignored rather than silently dropped, which is the bug this
// file exists to fix.
// `facilities` and `name` are documentation, not authority: the entitlement a
// subscriber actually gets comes from TIER_LIMITS in index.html, and these
// mirror it so the two can be compared without opening both files. `plan` is
// the only field read at runtime, and it goes through normalisePlan() before
// it is written anywhere — which is why 'multi-home' is safe to write here
// even though the app is keyed on 'multi'. See PLAN_ALIASES below.
const PRICE_PLANS = {
  'price_1UClAiAH9qPFLg89ln6eHAVa': { plan: 'lite',       facilities: 1,        name: 'Title22 Lite' },        // $29, prod_VDBXSXDdmtFrmh
  'price_1UDWroAH9qPFLg89kAs9h49C': { plan: 'multi-home', facilities: 5,        name: 'Title22 Multi-Home' },  // $79, prod_VDypF9WL2wmjGO

  // The training+tracking PACKAGES, added 2026-11-19 (bundle build). Same
  // plans as Lite / Multi-Home — a package subscriber's entitlement is the
  // tier they would have had — plus two package-only fields:
  //   training: true  — the subscription handler also stamps
  //                     profiles.title22_training_included, which is what
  //                     opens the CTC courses in the app with no separate
  //                     add-on checkout (build sheet Step 3).
  //   pkg / portionCap — which package this is, and the ceiling on the CTC
  //                     training portion inside it ($29 pkg <= $20,
  //                     $79 pkg <= $60, $139 pkg <= $100). portionCap is
  //                     read only by the invoice handler that writes the
  //                     CTC split ledger; pkg is ALSO written to
  //                     profiles.title22_package by the subscription
  //                     handler below (cap-fix, 2026-11-19).
  // `facilities` stays documentation-only, as everywhere above: pkg3 reads
  // Infinity because the app gate treats 6+ homes as uncapped in v1.
  'price_1UdhR6AH9qPFLg896m0ZBAaL': { plan: 'lite',       facilities: 1,        name: 'Title22 Package — 1 Home (Tracking + Training)',     training: true, pkg: 'pkg1', portionCap: 20 },   // $29, prod_Vf1… (Pkg 1)
  // Pkg2 price ID VERIFIED char-for-char 2026-11-19 from a zoomed Stripe
  // Events screenshot: price_1UdhZgAH9qPFLg89txlNvXye (24 chars after
  // "price_"). An earlier photo read dropped the "l" in "txlNvXye".
  'price_1UdhZgAH9qPFLg89txlNvXye':  { plan: 'multi-home', facilities: 5,        name: 'Title22 Package — 2–5 Homes (Tracking + Training)', training: true, pkg: 'pkg2', portionCap: 60 },   // $79, prod_Vf1cvvKRK5hdZ7
  'price_1UdhdFAH9qPFLg89Td1Fs556': { plan: 'multi-home', facilities: Infinity, name: 'Title22 Package — 6+ Homes (Tracking + Training)',  training: true, pkg: 'pkg3', portionCap: 100 },  // $139, prod_Vf1gRkzjojGwSm
  'price_1TkIKtAH9qPFLg89SEmENr5J': { plan: 'starter',    facilities: 1,        name: 'Title22 Starter' },     // legacy subs only
  'price_1TkILaAH9qPFLg8923rgvHHb': { plan: 'pro',        facilities: 5,        name: 'Title22 Pro' },         // $79, the old link Multi-Home was sold on
  'price_1TkIMaAH9qPFLg89SPFZH0aG': { plan: 'specialist', facilities: 5,        name: 'Title22 Specialist' },  // archived, legacy subs only
  'price_1TkINiAH9qPFLg89upIhpYTy': { plan: 'agency',     facilities: Infinity, name: 'Title22 Agency' },

  // NOT MAPPED, ON PURPOSE. The two Map bundles — Lite + Map $99
  // (price_1UEHzFAH9qPFLg89BoNbAPm9) and Multi-Home + Map $149
  // (price_1UEIVpAH9qPFLg89qOs5pvRg), both created 2026-09-11 — belong to a
  // DIFFERENT BUILD, not to Title22. Eli confirmed that on 2026-09-14.
  //
  // They are listed here so nobody has to rediscover them, and so nobody adds
  // them as a "missing price" the next time a 422 shows up in the delivery log.
  // Mapping them would be the opposite of the bug this file exists to fix: it
  // would hand a Title22 account to somebody who bought a different product.
  //
  // They still reach this Worker, because the Stripe account is shared across
  // several businesses and a webhook endpoint subscribes to event TYPES, not to
  // products. So do expect 422s from them, and from Postpilots, Rekey Locks and
  // the rest of the 85 products on that account. See the note on the 422 branch
  // below: a delivery log with permanent expected red in it is a log nobody
  // reads, which is exactly how the 2026-09-13 outage survived four days.
};

// Product ID -> plan. The SECOND way to name a tier, and it exists because the
// first way failed in the stupidest possible manner.
//
// On 2026-09-13 a live $29 Lite subscription was refused with
// "Unmapped price: price_1UCIA?AH9qPFLg89?n6eHAVa". The price on the
// subscription did not byte-match the key in PRICE_PLANS, and the two
// characters in question are the ones a human cannot tell apart: capital I,
// lowercase l, and lowercase i render nearly identically in the dashboard's
// font. Somebody transcribed that ID by eye, and one hand-copied string was
// the only thing standing between a payment and an account.
//
// A product ID is a second, independent hand-copied string. That is the whole
// point: both being wrong is far less likely than one being wrong, and if both
// ARE wrong the 422 below now prints what Stripe actually sent, so the next
// person fixes it from the delivery log in one look instead of four days.
//
// Only the two sellable tiers are here. The legacy products are not, and do
// not need to be — nothing new is sold on them, and an existing subscriber's
// renewal still resolves on its price ID as it always has.
const PRODUCT_PLANS = {
  'prod_VDBXSXDdmtFrmh': 'lite',        // $29 Title22 Lite
  'prod_VDypF9WL2wmjGO': 'multi-home',  // $79 Title22 Multi-Home
};

// The Staff Training Add-On tiers (CTC agreement, Exhibit A), added
// 2026-11-22. These are NOT plans, and that is why they live in their own
// maps instead of PRICE_PLANS: planFromSubscription() reads PRICE_PLANS,
// and anything in there is one careless edit away from being granted as
// a plan. An add-on purchase stamps profiles.title22_training_included
// and NOTHING else — never title22_plan, never title22_package.
//
// Four separate PRODUCTS, one per tier — Eli built them that way in the
// Stripe dashboard on 2026-10-26, rather than one product with four
// prices. All eight IDs below were verified by a Stripe API read that
// same day and recorded in title22-outreach/tello-staff-addon.md — they
// were NOT transcribed from a dashboard screenshot (see the note above
// PRICE_PLANS for what that cost in Sept 2026). The product IDs are kept
// beside the prices for the same reason PRODUCT_PLANS exists: a second,
// independent identifier, so a re-priced tier can still be recognised.
const ADDON_TIERS = {
  small:  { beds: '1-6',   price: '$20/month',  product: 'prod_VW2LAPNkGSyH8B' },  // Staff Training Add-On - Small
  medium: { beds: '7-15',  price: '$35/month',  product: 'prod_VW2PY0Em88j6mF' },  // Staff Training Add-On - Medium
  large:  { beds: '16-49', price: '$60/month',  product: 'prod_VW2Pgm2KXmyZUe' },  // Staff Training Add-On - Large
  xl:     { beds: '50+',   price: '$100/month', product: 'prod_VW2QvONT7rp39Y' },  // Staff Training Add-On - Extra Large
};
const ADDON_PRICES = {
  'price_1UV0GvAH9qPFLg89xaIcDW3j': 'small',   // $20/mo, prod_VW2LAPNkGSyH8B
  'price_1UV0KKAH9qPFLg89zmjAtjfa': 'medium',  // $35/mo, prod_VW2PY0Em88j6mF
  'price_1UV0KzAH9qPFLg89c8oG81U7': 'large',   // $60/mo, prod_VW2Pgm2KXmyZUe
  'price_1UV0LXAH9qPFLg89talQ2iGg': 'xl',      // $100/mo, prod_VW2QvONT7rp39Y
};
const ADDON_PRODUCTS = Object.fromEntries(
  Object.entries(ADDON_TIERS).map(([tier, info]) => [info.product, tier])
);

// The plan keys the app actually understands. index.html's TIER_LIMITS and
// T22_PAID are keyed on exactly these, so a plan written here that is not in
// this list is worse than writing nothing: T22_PAID would not match it, so the
// subscriber reads as unpaid, and TIER_LIMITS would miss too, dropping them to
// the {facilities:1, ai:false} default — no Tello, one facility, on a plan
// they are being billed $79 for.
const KNOWN_PLANS = ['lite', 'multi', 'starter', 'pro', 'specialist', 'agency', 'edu'];

// Multi-Home is 'multi' in the app and "Multi-Home" everywhere a human writes
// it, including a Payment Link's metadata. Fold the spellings before they are
// written rather than teaching the app a second key for one tier.
const PLAN_ALIASES = {
  'multi-home': 'multi',
  'multi_home': 'multi',
  'multihome': 'multi',
  'multi home': 'multi',
};

function normalisePlan(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  const plan = PLAN_ALIASES[k] || k;
  return KNOWN_PLANS.includes(plan) ? plan : null;
}

const enc = new TextEncoder();

// Stripe's signature scheme: the header is `t=<unix>,v1=<hex hmac>`, and the
// signed payload is `<t>.<raw body>`. The raw body matters — parse it only
// after this passes.
async function verifyStripe(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('=').map(x => x.trim()))
  );
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  // Reject anything older than five minutes: without this a captured request
  // can be replayed forever.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare.
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

function sbHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

// PATCH profiles by id. The webhook writes ONLY title22_* columns, as the
// README requires — nothing else on that row is ours to touch.
async function patchProfile(env, userId, patch) {
  // return=representation, not minimal, because a PATCH that matches no row is
  // a 200 with an empty body — it succeeds and writes nothing. That is the
  // case for anyone who paid before they had an account, and it is silent:
  // profiles never learns the plan, the app stamps them 'trial' on first
  // login, and they read as "Free Trial" having been charged. The app now
  // recovers from it on its own (planToStamp in index.html), but it should be
  // visible in the Worker tail rather than inferred from a support email.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', headers: { ...sbHeaders(env), 'Prefer': 'return=representation' }, body: JSON.stringify(patch) }
  );
  if (!res.ok) return false;
  const rows = await res.json().catch(() => null);
  if (Array.isArray(rows) && rows.length === 0) {
    console.error('patchProfile matched no profiles row for user', userId, '- plan not recorded on profiles');
  }
  return true;
}

// public.subscriptions is a second store, and the two disagreed for months
// because only profiles was ever written. Keep it current as well, so a row
// there can be trusted: the app treats a row with no current_period_end as
// unverifiable precisely because of that history.
async function upsertSubscription(env, row) {
  const q = `${env.SUPABASE_URL}/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(row.stripe_subscription_id)}`;
  const patch = await fetch(q, {
    method: 'PATCH',
    headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
    body: JSON.stringify(row),
  });
  if (patch.ok) {
    const updated = await patch.json().catch(() => []);
    if (updated && updated.length) return true;
  }
  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify(row),
  });
  return insert.ok;
}

// A subscription event carries a customer, not a Supabase user. Three ways to
// get back to one, in order of reliability:
//   1. an existing subscriptions row for this stripe_subscription_id
//   2. the checkout session's client_reference_id — index.html's openStripe
//      sets it to currentUser.id on every payment link
//   3. the customer's email, looked up through the GoTrue admin API
async function resolveUserId(env, { subscriptionId, clientReferenceId, email }) {
  if (clientReferenceId) return clientReferenceId;
  if (subscriptionId) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=user_id&limit=1`,
      { headers: sbHeaders(env) }
    );
    if (res.ok) {
      const rows = await res.json().catch(() => []);
      if (rows && rows.length && rows[0].user_id) return rows[0].user_id;
    }
  }
  if (email) {
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      { headers: sbHeaders(env) }
    );
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      const users = body.users || [];
      const hit = users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
      if (hit) return hit.id;
    }
  }
  return null;
}

// Retrieve a customer's email when the event does not carry one.
async function stripeCustomerEmail(env, customerId) {
  if (!customerId || !env.STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  if (!res.ok) return null;
  const c = await res.json().catch(() => ({}));
  return c.email || null;
}

// Ask Stripe what a price actually is. Called ONLY when the price ID missed
// PRICE_PLANS, so the normal path costs nothing: no extra API call on a
// subscription whose price we already recognise.
//
// Two jobs. It can rescue the event, by reading the price's product and
// matching that instead. And whether or not it rescues anything, what it
// returns goes into the 422 body, so the delivery log names the real price,
// the real product and the real amount rather than only the string we failed
// to match.
async function stripePrice(env, priceId) {
  if (!priceId || !env.STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

// Human-readable, for the 422 body: "$29.00/month".
function describePrice(price) {
  if (!price) return 'price could not be read from Stripe';
  const amount = typeof price.unit_amount === 'number'
    ? '$' + (price.unit_amount / 100).toFixed(2)
    : '(no unit_amount)';
  const interval = (price.recurring && price.recurring.interval) || 'one-time';
  const product = typeof price.product === 'string' ? price.product : (price.product && price.product.id) || '(none)';
  return `${amount}/${interval}, product ${product}`;
}

function planFromSubscription(sub) {
  const items = (sub.items && sub.items.data) || [];
  for (const it of items) {
    const priceId = it.price && it.price.id;
    const tier = priceId && PRICE_PLANS[priceId];
    // normalisePlan, not tier.plan raw: the map is written in the tier's
    // human name ('multi-home') and the app is keyed on 'multi'. It also means
    // a typo in the map is caught here — an unrecognised plan comes back null,
    // and the caller refuses the event with the price ID in the log rather
    // than writing a plan nothing matches.
    if (tier) return { plan: normalisePlan(tier.plan), priceId, tier };
  }
  // Metadata is the fallback for a Payment Link that carries plan=lite. It is
  // typed by hand in the Stripe dashboard, so it is normalised and checked
  // against KNOWN_PLANS rather than trusted: it used to be written through
  // verbatim, which means one Payment Link labelled plan=Multi-Home would have
  // put the string 'Multi-Home' in profiles.title22_plan and locked the
  // subscriber out of the tier they had just bought. An unrecognised value is
  // now null, which the caller already handles — it refuses the event loudly
  // with the price ID in the log, instead of writing a plan nothing matches.
  // Metadata is NOT returned as the plan, and that is the point of this
  // function's shape. It used to be, and doing so quietly disarmed the one
  // alarm that catches a mistyped price: a hand-typed plan=multi on the
  // Payment Link resolves the event, so the PRODUCT_PLANS rescue never runs,
  // never warns, and the map stays wrong forever. Which is exactly the bug
  // this whole file was rewritten for, re-entering by the back door of its
  // own fix.
  //
  // So the caller tries price -> product -> metadata, in falling order of how
  // far we trust the source, and says so out loud on both fallbacks.
  return {
    plan: null,
    priceId: items[0] && items[0].price && items[0].price.id,
    metaPlan: normalisePlan(sub.metadata && sub.metadata.plan),
  };
}

// Is this subscription a Staff Training Add-On purchase (2026-11-22)?
// Three signals, in falling order of how far we trust the source — the
// same discipline as planFromSubscription():
//   1. an item price in ADDON_PRICES. The map is the authority.
//   2. an item price whose PRODUCT is one of the four add-on products —
//      a tier that was re-priced in the dashboard. The purchase still
//      counts; the price map needs the new price added.
//   3. subscription metadata product_kind=ctc_addon (+ a known tier),
//      which the Payment Links stamp through subscription_data. It is
//      set by Stripe from the link's configuration, not typed per buyer
//      — the links were built from tools/setup-stripe-test.mjs's
//      paymentLinkParams, which sets exactly this metadata.
// Signals 2 and 3 come back with viaFallback set, and the caller is loud
// about them, exactly like the plan rescues: the purchase is granted, so
// nothing visibly breaks, and a silent success is how a wrong price map
// survives to the next customer. Returns null when this is not an
// add-on subscription at all.
function addonFromSubscription(sub) {
  const items = (sub.items && sub.items.data) || [];
  for (const it of items) {
    const priceId = it.price && it.price.id;
    const tier = priceId && ADDON_PRICES[priceId];
    if (tier) return { tier, priceId, viaFallback: null };
  }
  for (const it of items) {
    const p = it.price || {};
    const productId = typeof p.product === 'string' ? p.product : (p.product && p.product.id);
    const tier = productId && ADDON_PRODUCTS[productId];
    if (tier) return { tier, priceId: p.id || null, viaFallback: 'product' };
  }
  const md = sub.metadata || {};
  if (md.product_kind === 'ctc_addon' && ADDON_TIERS[md.tier]) {
    const first = items[0] && items[0].price;
    return { tier: md.tier, priceId: (first && first.id) || null, viaFallback: 'metadata' };
  }
  return null;
}

// The "Title22 account email" a buyer typed at checkout. Payment Link
// custom fields live on the checkout SESSION only — subscription and
// invoice events never see them — shaped by Stripe as
// { key: 'title22_account_email', type: 'text', text: { value } }.
// The key is the one the add-on repo's tools/setup-stripe-test.mjs
// defines in CUSTOM_FIELDS, and the live links carry it as a required
// field. It exists because the address a buyer pays with is not
// necessarily the address their Title22 account is under.
function checkoutAccountEmail(session) {
  const fields = (session && session.custom_fields) || [];
  for (const f of fields) {
    if (f && f.key === 'title22_account_email') {
      const v = f.text && f.text.value;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
  return null;
}

function isoOrNull(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

// Stripe's 2025-03-31 API version removed current_period_end from the
// subscription object and moved it onto the subscription's items. Reading only
// the root left every row this worker wrote carrying a null period end, which
// the app treats as unverifiable — so a real Lite subscriber fell through to
// profiles, and if the webhook's PATCH of profiles had matched no row (a
// customer who paid before they signed up), they read as "Free Trial" and kept
// reading that way through every refresh.
//
// Root first so an older API version keeps working unchanged, then the latest
// end across the items.
function periodEndOf(sub) {
  if (sub && sub.current_period_end) return isoOrNull(sub.current_period_end);
  const items = (sub && sub.items && sub.items.data) || [];
  let latest = null;
  for (const it of items) {
    if (it && it.current_period_end && (latest === null || it.current_period_end > latest)) {
      latest = it.current_period_end;
    }
  }
  return isoOrNull(latest);
}

// --- CTC auto-split ledger (packages only, added 2026-11-19) ---
//
// When a package invoice is paid, CTC's share of the training portion inside
// it is owed: 100% of the portion in the account's first paid month on that
// package, 50% after (the signed agreement's split). Rather than computing
// that by hand at statement time, the invoice handler below writes one row
// to public.ctc_split_ledger per paid package invoice, and the monthly
// statement is generated from those rows. The payout itself is unchanged —
// quarterly by ACH, per the agreement.

// The training portion is priced by licensed beds, on the tiers the CTC
// add-on has always used: $20 = 1-6 beds, $35 = 7-15, $60 = 16-49,
// $100 = 50+. Inside a package, the beds of all the account's homes are
// POOLED before the tier is read.
function portionForBeds(pooledBeds) {
  if (pooledBeds <= 6) return 20;
  if (pooledBeds <= 15) return 35;
  if (pooledBeds <= 49) return 60;
  return 100;
}

// The tier, with the package's ceiling applied on top: a $79 package never
// carries more than a $60 portion no matter how many beds pool into it,
// because the $100 XL portion lives only in the $139 package.
function cappedPortion(tier, pooledBeds) {
  return Math.min(portionForBeds(pooledBeds), tier.portionCap);
}

// Money in the ledger is DOLLARS, not Stripe cents: the rows feed a
// statement humans read, and the spec's math is in dollars ($20 portion,
// $9 kept). The split is computed on the GROSS amounts, the way the
// agreement's examples compute it — Stripe's processing fee is Title22's
// cost of taking the payment, not CTC's, so it is never deducted here.
// title22_keeps is what remains of the invoice after CTC's due.
function splitAmounts({ portion, firstPaidMonth, invoiceAmount }) {
  const round2 = n => Math.round(n * 100) / 100;
  const ctcDue = firstPaidMonth ? portion : round2(portion / 2);
  return { ctcDue, title22Keeps: round2(invoiceAmount - ctcDue) };
}

// The account's homes at invoice time. facilities.capacity is the licensed
// bed count the app's facility form collects; a home with no capacity
// recorded still counts as a home but contributes 0 beds. Demo/practice
// rows (is_demo) are not real homes and never count — counting the practice
// home's invented beds would inflate the portion CTC is owed on.
async function accountFacilities(env, userId) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/facilities?user_id=eq.${encodeURIComponent(userId)}&select=id,capacity,is_demo`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) throw new Error('facilities read failed: HTTP ' + res.status);
  const rows = await res.json().catch(() => []);
  return (rows || []).filter(f => !f.is_demo);
}

async function ledgerSelect(env, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ctc_split_ledger?${query}`, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error('ctc_split_ledger read failed: HTTP ' + res.status);
  const rows = await res.json().catch(() => []);
  return rows || [];
}

// Idempotent by construction: invoice_id is UNIQUE in the table and the
// insert ignores a conflict, so a redelivered (or double-named) invoice
// event can never create a second row or double-count a split.
async function insertLedgerRow(env, row) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ctc_split_ledger?on_conflict=invoice_id`,
    {
      method: 'POST',
      headers: { ...sbHeaders(env), 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) throw new Error('ctc_split_ledger insert failed: HTTP ' + res.status);
}

// Write the ledger row for one invoice, if it is a paid package invoice.
// Returns a warning string when something a human must see went wrong, and
// null when the row was written or there was legitimately nothing to write.
// NEVER throws: this is reporting, not entitlement. The plan itself is
// written by the subscription events, so a ledger failure must not fail the
// delivery and must not touch activation — the caller surfaces the warning
// in the 200 body instead, where the delivery log will show it.
async function writeLedgerForInvoice(env, invoice) {
  try {
    const lines = (invoice.lines && invoice.lines.data) || [];
    let tier = null, priceId = null;
    for (const line of lines) {
      const pid = line.price && line.price.id;
      if (pid && PRICE_PLANS[pid] && PRICE_PLANS[pid].pkg) { tier = PRICE_PLANS[pid]; priceId = pid; break; }
    }
    if (!tier) return null;                    // not a package invoice — nothing to split
    const amountPaid = typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;
    if (amountPaid <= 0) return null;          // a $0 invoice (e.g. trial start) pays nobody

    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : (invoice.subscription && invoice.subscription.id) || null;
    const email = invoice.customer_email || await stripeCustomerEmail(env, invoice.customer);
    const userId = await resolveUserId(env, { subscriptionId, email });
    if (!userId) {
      const note =
        `CTC LEDGER SKIPPED — paid package invoice ${invoice.id} could not be attributed ` +
        `to an account (subscription ${subscriptionId || '(none)'}, email ${email || '(none)'}). ` +
        `Write the row by hand from the Stripe invoice.`;
      console.error(note);
      return note;
    }

    // Idempotency, first layer: a redelivery of an invoice already in the
    // ledger is a no-op before any math happens.
    const dupe = await ledgerSelect(env, `invoice_id=eq.${encodeURIComponent(invoice.id)}&select=invoice_id&limit=1`);
    if (dupe.length) return null;

    const facilities = await accountFacilities(env, userId);
    const homesCount = facilities.length;
    const pooledBeds = facilities.reduce((sum, f) => sum + (typeof f.capacity === 'number' ? f.capacity : 0), 0);
    const portion = cappedPortion(tier, pooledBeds);

    // First paid month is per account AND package (build sheet Step 2): the
    // first ledger row this account has on this package is the month CTC
    // takes 100% of the portion.
    const prior = await ledgerSelect(env, `profile_id=eq.${encodeURIComponent(userId)}&package=eq.${encodeURIComponent(tier.pkg)}&select=invoice_id&limit=1`);
    const firstPaidMonth = prior.length === 0;

    const invoiceAmount = amountPaid / 100;
    const { ctcDue, title22Keeps } = splitAmounts({ portion, firstPaidMonth, invoiceAmount });

    await insertLedgerRow(env, {
      invoice_id: invoice.id,
      profile_id: userId,
      package: tier.pkg,
      package_price_id: priceId,
      homes_count: homesCount,
      pooled_beds: pooledBeds,
      portion,
      first_paid_month: firstPaidMonth,
      ctc_due: ctcDue,
      title22_keeps: title22Keeps,
      invoice_amount: invoiceAmount,
    });
    return null;
  } catch (e) {
    const note =
      `CTC LEDGER FAILED for invoice ${invoice && invoice.id}: ${(e && e.message) || String(e)} ` +
      `— plan activation is unaffected; write the row by hand or replay the event.`;
    console.error(note);
    return note;
  }
}

// --- Customer email notifications (phase 2, added 2026-11-20) ---
//
// subscription_confirmed and payment_failed are DECIDED here, where the
// payment context lives, but SENT by workers/title22-email: it owns the
// templates, the Resend key and the dedupe log (public.title22_email_log).
// This Worker POSTs to its /notify-payment route, authenticated by a shared
// secret — EMAIL_SERVICE_SECRET, a dashboard secret on BOTH Workers —
// because this Worker has no user session and the email Worker's templated
// route requires one (the JWT wall the Nov 7 bring-up flagged).
//
// The call travels over the EMAIL_WORKER service binding ([[services]] in
// wrangler.toml), NOT a fetch to the email Worker's workers.dev URL:
// Cloudflare answers a Worker-to-Worker fetch to a workers.dev address
// with a bare platform 404 — no body, and the callee's code never runs —
// so the URL fetch failed every payment email while looking like an
// application error (diagnosed live 2026-11-22 from the warning in a
// Stripe delivery body; the same route answered 401 to an outside caller
// with a wrong secret, proving the route and the Worker were healthy all
// along). External callers are unaffected, which is why /health and the
// outside probes never showed it. EMAIL_WORKER_URL stays in [vars] as
// the fallback for an environment with no binding declared, and as
// documentation of the callee's public address.
//
// The dedupe key is named HERE, by the caller, because only the caller
// knows what makes a notification unique: the subscription id for a
// confirmation (once per subscription, ever), the invoice id + attempt
// count for a failure (once per failed attempt — a redelivery of the same
// event cannot re-send, a genuinely new failed retry can).
//
// The add-on owner alert (2026-11-22) rides the same rail through its
// own route on the email Worker, /notify-addon-owner — see
// notifyOwnerAlert below.
//
// Same contract as writeLedgerForInvoice: NEVER throws, returns a warning
// string for the 200 body or null. An email problem must never fail a
// delivery or touch plan activation — the money path outranks the mail
// path. EMAIL_SERVICE_SECRET is deliberately NOT in REQUIRED_BINDINGS
// below: a missing email secret degrades to these warnings, never to a
// 500 that would stall subscription events.
// How the two helpers below reach title22-email. The service binding
// (env.EMAIL_WORKER) is the live path; the EMAIL_WORKER_URL fetch is the
// fallback for an environment with no binding declared. The host in the
// binding URL is a placeholder — the binding routes the request to the
// title22-email Worker, whose router matches on the pathname, so the
// path must stay exactly the route's path.
function emailWorkerBinding(env) {
  return env.EMAIL_WORKER && typeof env.EMAIL_WORKER.fetch === 'function' ? env.EMAIL_WORKER : null;
}

async function postToEmailWorker(env, path, payload) {
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Title22-Service-Secret': env.EMAIL_SERVICE_SECRET,
    },
    body: JSON.stringify(payload),
  };
  const binding = emailWorkerBinding(env);
  if (binding) return binding.fetch('https://title22-email' + path, init);
  return fetch(env.EMAIL_WORKER_URL.replace(/\/$/, '') + path, init);
}

async function notifyCustomerEmail(env, payload) {
  try {
    if ((!emailWorkerBinding(env) && !env.EMAIL_WORKER_URL) || !env.EMAIL_SERVICE_SECRET) {
      return 'CUSTOMER EMAIL SKIPPED — EMAIL_WORKER / EMAIL_WORKER_URL / EMAIL_SERVICE_SECRET not configured ' +
        'on stripe-webhook, so no ' + payload.template + ' email was requested for ' +
        (payload.email || payload.user_id || '(unknown customer)') + '. The payment itself is unaffected.';
    }
    const res = await postToEmailWorker(env, '/notify-payment', payload);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return 'CUSTOMER EMAIL FAILED — title22-email answered HTTP ' + res.status + ' for ' +
        payload.template + ' (' + (data.error || 'no detail') + '). The payment itself is unaffected.';
    }
    // data.skipped means the dedupe log already holds this key — the email
    // went out on an earlier delivery. That is the design working, not a
    // warning.
    return null;
  } catch (e) {
    return 'CUSTOMER EMAIL FAILED — could not reach title22-email for ' + payload.template + ': ' +
      ((e && e.message) || String(e)) + '. The payment itself is unaffected.';
  }
}

// The OWNER alert for a training add-on activation (2026-11-22), decided
// here and sent by title22-email through its /notify-addon-owner route —
// same secret, same never-throws contract as notifyCustomerEmail above.
// The buyer's confirmation promises a by-hand order check before their
// staff are enrolled on CTC's platform; this call is what tells the
// owner the check is due. Its dedupe key is its own
// (addon_owner_alert:<subscription id>), so it can neither block nor be
// blocked by the buyer's confirmation. Failures are console.error'd here
// as well as returned: this alert has no customer watching for it, so it
// gets both of the file's loud surfaces, not one.
async function notifyOwnerAlert(env, payload) {
  try {
    if ((!emailWorkerBinding(env) && !env.EMAIL_WORKER_URL) || !env.EMAIL_SERVICE_SECRET) {
      const note = 'ADDON OWNER ALERT SKIPPED — EMAIL_WORKER / EMAIL_WORKER_URL / EMAIL_SERVICE_SECRET not configured ' +
        'on stripe-webhook, so no enrollment-check alert was requested for subscription ' +
        (payload.subscription_id || '(unknown)') + '. Activation and the buyer confirmation are unaffected.';
      console.error(note);
      return note;
    }
    const res = await postToEmailWorker(env, '/notify-addon-owner', payload);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const note = 'ADDON OWNER ALERT FAILED — title22-email answered HTTP ' + res.status + ' for subscription ' +
        (payload.subscription_id || '(unknown)') + ' (' + (data.error || 'no detail') + '). ' +
        'Activation and the buyer confirmation are unaffected; the enrollment check is still due by hand.';
      console.error(note);
      return note;
    }
    // data.skipped means the dedupe log already holds this key — the
    // alert went out on an earlier delivery. The design working, not a
    // warning.
    return null;
  } catch (e) {
    const note = 'ADDON OWNER ALERT FAILED — could not reach title22-email for subscription ' +
      (payload.subscription_id || '(unknown)') + ': ' + ((e && e.message) || String(e)) +
      '. Activation and the buyer confirmation are unaffected; the enrollment check is still due by hand.';
    console.error(note);
    return note;
  }
}

// Everything this Worker needs from its environment, checked before any of it
// is used. This exists because of the 2026-09-13 outage, and the shape of that
// outage is the argument for it:
//
// SUPABASE_URL went missing from the Worker (see wrangler.toml for how), and
// nothing said so. The deploy was green. The endpoint stayed Active. The
// signature check passed, because its secret was still there. Every event this
// Worker does not handle answered 200, because those paths touch no binding at
// all. The only symptom was that the two events that matter returned 500 with
// the body "Handler error" — `fetch(undefined + '/rest/v1/...')` throwing a
// TypeError into the catch at the bottom of this file, four frames from
// anything that names the cause.
//
// A missing binding is not a runtime error to be caught downstream. It is a
// deployment that should never have been allowed to serve, and it should say
// which one, by name, in the first thing anybody reads.
//
// STRIPE_SECRET_KEY is in this list even though the Worker technically limps
// without it — it is only read to look up a customer's email when an event
// does not carry one, which is the fallback that attributes a purchase made
// outside the app. Running without it is a decision; take it deliberately by
// removing it here, not by discovering it in a delivery log six days later.
const REQUIRED_BINDINGS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
];

function missingBindings(env) {
  return REQUIRED_BINDINGS.filter(name => !env || !env[name]);
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Before the signature check, deliberately. A missing STRIPE_WEBHOOK_SECRET
    // makes verifyStripe() return false, which answers 400 "Signature
    // verification failed" — blaming Stripe for our own empty environment, and
    // sending whoever reads it to rotate a signing secret that was never the
    // problem.
    //
    // All of them at once, not the first one found, so one redeploy fixes
    // everything rather than uncovering the next name each time.
    //
    // The names go in the BODY, not only the console: the body is what Stripe
    // shows in the delivery log, and the console needs `wrangler tail` to have
    // been running at the moment it happened. They are binding names, never
    // values, and they are already written out in this repo's wrangler.toml —
    // an unauthenticated POST learns nothing here it could not read on GitHub.
    //
    // 500 rather than 4xx so Stripe keeps retrying for its ~3 days: restore the
    // binding, redeploy, and the pending events deliver on their own. That is
    // the difference between a customer who activates without being asked and
    // one who needs a row written by hand.
    const missing = missingBindings(env);
    if (missing.length) {
      console.error('stripe-webhook is misconfigured — missing binding(s):', missing.join(', '));
      return new Response('Worker misconfigured — missing binding(s): ' + missing.join(', '), { status: 500 });
    }

    const raw = await request.text();
    const ok = await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
    // 400, not 500: an unverified request is Stripe's to retry only if it was
    // genuinely ours, and a 500 would have it retry forever.
    if (!ok) return new Response('Signature verification failed', { status: 400 });

    let event;
    try { event = JSON.parse(raw); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    const obj = (event.data && event.data.object) || {};
    // Present on *.updated events: the fields as they were BEFORE this
    // change. Phase 2 (2026-11-20) reads the previous status to catch the
    // trialing -> active conversion — the moment a trial becomes a paid
    // subscription — exactly once.
    const prevAttrs = (event.data && event.data.previous_attributes) || {};

    // Set when the event succeeded but something is wrong that a human must
    // fix. It rides out in the 200 body, because Stripe records the response
    // body against every delivery and that log is the only thing anybody reads
    // afterwards — console.error needs `wrangler tail` to have been running at
    // the moment it happened, which is to say it needs somebody to have already
    // suspected the problem. The whole lesson of this file is that they won't.
    let warning = null;

    try {
      switch (event.type) {

        // The buyer came back from a Payment Link. This is the only event that
        // carries client_reference_id, so it is where the user <-> subscription
        // mapping is established; the plan itself arrives on the subscription
        // event that follows.
        case 'checkout.session.completed': {
          const subscriptionId = obj.subscription;
          const email = (obj.customer_details && obj.customer_details.email) || obj.customer_email || null;
          // The add-on Payment Links (and the Tello Staff link, cloned
          // from the Small training link) collect a required "Title22
          // account email" custom field — the address the buyer says
          // their account is under, which is NOT necessarily the email
          // they pay with. On 2026-11-21 the account was
          // admin@runp8.com and the Stripe customer was
          // infomomtelo@gmail.com, so the payment email matched nothing
          // and the purchase attributed to nobody. Custom fields exist
          // only on this event, so the account email is tried FIRST
          // here; the payment email remains the fallback, unchanged for
          // every checkout that carries no custom field.
          const accountEmail = checkoutAccountEmail(obj);
          let userId = await resolveUserId(env, {
            subscriptionId,
            clientReferenceId: obj.client_reference_id,
            email: accountEmail || email,
          });
          if (!userId && accountEmail && email && accountEmail.toLowerCase() !== email.toLowerCase()) {
            userId = await resolveUserId(env, {
              subscriptionId,
              clientReferenceId: obj.client_reference_id,
              email,
            });
          }
          if (!userId) {
            // 409, not 202. A paid checkout we cannot attribute is not a
            // success to be acknowledged and forgotten — 2xx tells Stripe the
            // event is handled and it is never sent again, so the money lands
            // and nothing is ever written. Any non-2xx makes Stripe retry with
            // backoff for about three days AND shows the delivery red in the
            // dashboard. Both matter: the retry is what heals the case where
            // somebody pays first and creates their account minutes later, and
            // the red row is what tells a human it happened at all.
            console.error('Unattributed checkout session', obj.id, 'email', email || '(none)');
            return new Response('No matching user for checkout session — will retry', { status: 409 });
          }
          if (subscriptionId) {
            await patchProfile(env, userId, {
              title22_subscription_id: subscriptionId,
              title22_plan_expires_at: null,
            });
            await upsertSubscription(env, {
              user_id: userId,
              status: 'active',
              stripe_subscription_id: subscriptionId,
            });
          }
          break;
        }

        // Where the plan is actually decided, on create, upgrade, downgrade,
        // renewal and payment failure alike.
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          let { plan, priceId, metaPlan, tier } = planFromSubscription(obj);
          const email = await stripeCustomerEmail(env, obj.customer);
          const userId = await resolveUserId(env, { subscriptionId: obj.id, email });
          if (!userId) {
            // See the note on checkout.session.completed above. This is the
            // event that decides the plan, so an unattributed one is the
            // difference between a paying customer and someone looking at
            // "Free Trial" after being charged.
            console.error('Unattributed subscription', obj.id, 'email', email || '(none)');
            return new Response('No matching user for subscription — will retry', { status: 409 });
          }
          // Staff Training Add-On (2026-11-22). A training-only purchase:
          // it stamps the training flag and NOTHING else — never
          // title22_plan, never title22_package, and no plan row in the
          // subscriptions table (a row there with no plan name would read
          // as a plan nobody can identify). Before this branch existed,
          // the four add-on prices were unmapped and this case refused
          // them with the 422 below: the buyer paid, Stripe showed an
          // active subscription, and Title22 did nothing at all — the
          // activation was a by-hand step that nobody was alerted to
          // take, and on 2026-11-21 a real $20 purchase sat unconfirmed
          // for exactly that reason.
          const addon = addonFromSubscription(obj);
          if (addon) {
            if (addon.viaFallback) {
              // Loud even though it worked — same rule as the plan
              // rescues below. The map is incomplete and somebody has
              // to complete it.
              const note =
                `PRICE MAP IS WRONG — this add-on event was recognised via its ${addon.viaFallback}, ` +
                `not its price. Stripe sent price ${addon.priceId || '(none)'} for the ${addon.tier} tier. ` +
                `Add that price to ADDON_PRICES in workers/stripe-webhook/index.js.`;
              console.error(note);
              if (!warning) warning = note;
            }
            if (obj.status === 'active' || obj.status === 'trialing') {
              await patchProfile(env, userId, { title22_training_included: true });
            }
            // The confirmation email, on the same two moments as a
            // plan's: created already active (paid on the spot), and
            // trialing -> active. The add-on links carry no trial, so in
            // practice the created event is the one — the second moment
            // is here so the rule is the same rule everywhere. The
            // dedupe key is the subscription id, so a redelivery of
            // either moment cannot re-send.
            const firstActivation =
              obj.status === 'active' &&
              (event.type === 'customer.subscription.created' || prevAttrs.status === 'trialing');
            if (firstActivation) {
              const note = await notifyCustomerEmail(env, {
                template: 'subscription_confirmed',
                dedupe_key: 'subscription_confirmed:' + obj.id,
                user_id: userId,
                email,
                plan: null,
                package: null,
                training_included: true,
                addon: addon.tier,
              });
              if (note && !warning) warning = note;
              // And the owner's half of the same moment (2026-11-22):
              // the confirmation just promised the buyer a by-hand
              // order check before enrollment, so the owner is told the
              // check is due — his alert, his dedupe key, and a failure
              // here changes nothing above: not the flag, not the
              // confirmation, not the 200.
              const alertNote = await notifyOwnerAlert(env, {
                dedupe_key: 'addon_owner_alert:' + obj.id,
                user_id: userId,
                buyer_email: email,
                addon: addon.tier,
                subscription_id: obj.id,
              });
              if (alertNote && !warning) warning = alertNote;
            }
            break;
          }
          if (!plan) {
            // The price did not match. Before refusing a payment, ask Stripe
            // what this price IS and try to name the tier from its product —
            // see PRODUCT_PLANS for why a second identifier exists at all.
            const price = await stripePrice(env, priceId);
            const productId = price && (typeof price.product === 'string' ? price.product : price.product && price.product.id);
            const viaProduct = normalisePlan(PRODUCT_PLANS[productId]);
            if (viaProduct) {
              // Deliberately loud even though it worked. This is a rescue, not
              // a normal path: the map is WRONG and somebody has to correct it,
              // and a silent success is how it would stay wrong forever.
              const note =
                `PRICE MAP IS WRONG — this event was rescued via its product. ` +
                `Stripe sent price ${priceId}, product ${productId} -> ${viaProduct}. ` +
                `Add ${priceId} to PRICE_PLANS in workers/stripe-webhook/index.js.`;
              console.error(note);
              warning = note;
              plan = viaProduct;
            } else if (metaPlan) {
              // Third and last path, and the weakest: a plan typed by hand
              // into the Payment Link's subscription metadata in the Stripe
              // dashboard. It is checked against KNOWN_PLANS by normalisePlan
              // before it gets here, so it cannot write a tier the app is not
              // keyed on — but it is still somebody's typing, and reaching it
              // at all means neither identifier matched.
              //
              // Loud for the same reason the product rescue is loud: the
              // account is granted, so nothing visibly breaks, and a silent
              // success is how a wrong price map survives to the next customer.
              const note =
                `PRICE MAP IS WRONG — this event was rescued from hand-typed ` +
                `subscription metadata, after BOTH the price and the product ` +
                `failed to match. Stripe sent price ${priceId}, product ` +
                `${productId || '(unknown)'}; metadata says ${metaPlan}. ` +
                `Add ${priceId} to PRICE_PLANS in workers/stripe-webhook/index.js.`;
              console.error(note);
              warning = note;
              plan = metaPlan;
            } else {
              // Still no. Refuse — but say everything we know, in the BODY,
              // because the delivery log is what a human reads afterwards and
              // "Unmapped price: <id>" cost four days of reading it off a
              // photograph of a screen.
              const known = Object.keys(PRICE_PLANS).join(', ');
              const body =
                `Unmapped price: ${priceId}\n` +
                `Stripe says: ${describePrice(price)}\n` +
                `Known prices: ${known}\n` +
                `Known products: ${Object.keys(PRODUCT_PLANS).join(', ')}\n` +
                `Subscription metadata plan: ${(obj.metadata && obj.metadata.plan) || '(none)'}` +
                `${obj.metadata && obj.metadata.plan && !metaPlan ? ' (not a known plan)' : ''}`;
              console.error('Unmapped Stripe price', priceId, 'on subscription', obj.id, '-', describePrice(price));
              return new Response(body, { status: 422 });
            }
          }
          const periodEnd = periodEndOf(obj);
          const active = obj.status === 'active' || obj.status === 'trialing';
          await patchProfile(env, userId, {
            title22_plan: active ? plan : undefined,
            // Package prices only: training is inside the price, so stamp
            // the flag the app's training gate reads. `tier` is set only
            // when the price matched PRICE_PLANS directly — an event rescued
            // via product or metadata does not stamp it, which is one more
            // reason the loud rescue warnings above have to be acted on.
            // undefined on every non-package price, so JSON.stringify drops
            // the key and nothing changes for Lite/Multi-Home/legacy.
            title22_training_included: (active && tier && tier.training) ? true : undefined,
            // Which package, on the same terms as the flag above — plus one
            // difference. A directly matched package price writes its pkg
            // key ('pkg1'|'pkg2'|'pkg3'); a directly matched LEGACY price
            // writes null, clearing a stale package when a subscriber moves
            // from a package back to a legacy price. The clear matters: the
            // app lifts the facility cap on 'pkg3' alone, so a stale 'pkg3'
            // would leave a downgraded account uncapped. Rescued events
            // (tier unset) and non-active events drop the key, exactly like
            // the flag. (Cap-fix, 2026-11-19; the column is statement 5 in
            // capfix-build/statement-5.sql — it must exist before deploy.)
            title22_package: (active && tier) ? (tier.pkg || null) : undefined,
            // A paid plan is being written, so the trial is over: clear its
            // end stamp in the same patch. readEntitlement checks paid
            // plans first, but other readers of this column (the email
            // worker's owner notice prints a "Trial ends" row from it)
            // would otherwise keep calling a payer a trialist (F7).
            title22_trial_ends_at: active ? null : undefined,
            title22_subscription_id: obj.id,
            // Stamped only when Stripe says the sub is ending, so
            // resolveEntitlement locks access at period end rather than
            // immediately. An active sub carries no expiry.
            title22_plan_expires_at: obj.cancel_at_period_end ? periodEnd : null,
          });
          await upsertSubscription(env, {
            user_id: userId,
            plan,
            status: obj.status,
            stripe_subscription_id: obj.id,
            current_period_end: periodEnd,
          });
          // Phase 2 (2026-11-20): the subscription_confirmed email, once
          // per subscription. Two moments count as the start: created
          // already active (paid on the spot), and trialing -> active (the
          // trial converted — seen via previous_attributes). A plain
          // 'created' in trialing sends nothing: no money has moved, and
          // the confirmation belongs with the first charge. The email
          // Worker dedupes on the subscription id, so even if both
          // moments somehow fired, the customer gets exactly one email.
          const firstActivation =
            obj.status === 'active' &&
            (event.type === 'customer.subscription.created' || prevAttrs.status === 'trialing');
          if (firstActivation && plan) {
            const note = await notifyCustomerEmail(env, {
              template: 'subscription_confirmed',
              dedupe_key: 'subscription_confirmed:' + obj.id,
              user_id: userId,
              email,
              plan,
              package: (tier && tier.pkg) || null,
              training_included: !!(tier && tier.training),
            });
            if (note && !warning) warning = note;
          }
          break;
        }

        // The downgrade path. Access runs to the end of the paid period.
        case 'customer.subscription.deleted': {
          // A cancelled ADD-ON ends only the add-on (2026-11-22), so it
          // never reaches the generic path below: that path stamps
          // title22_plan_expires_at, which the app reads as the PLAN
          // ending — running it here would lock a package subscriber's
          // access at period end for cancelling a $20 extra. The
          // training flag is NOT cleared either, deliberately: the
          // package path never un-stamps title22_training_included
          // anywhere in this file, so the add-on mirrors it rather than
          // inventing a second semantics. Switching training off when an
          // add-on or package ends is a product decision that has not
          // been taken; until it is, both paths behave the same way.
          if (addonFromSubscription(obj)) break;
          const email = await stripeCustomerEmail(env, obj.customer);
          const userId = await resolveUserId(env, { subscriptionId: obj.id, email });
          // Deliberately still 202, and the only one. A cancellation we cannot
          // attribute has nothing to heal: there is no account to unlock and
          // no money at stake, so three days of retries would be noise that
          // trains everyone to ignore red rows in the delivery log. Logged,
          // acknowledged, dropped.
          if (!userId) {
            console.warn('Unattributed cancellation', obj.id, '— acknowledged, nothing to do');
            return new Response('No matching user for cancellation', { status: 202 });
          }
          const periodEnd = periodEndOf(obj) || new Date().toISOString();
          await patchProfile(env, userId, { title22_plan_expires_at: periodEnd });
          await upsertSubscription(env, {
            user_id: userId,
            status: 'canceled',
            stripe_subscription_id: obj.id,
            current_period_end: periodEnd,
          });
          break;
        }

        // A package invoice was paid. The plan itself is decided by the
        // subscription events above; this event ONLY writes the CTC split
        // ledger row (the auto-split, added 2026-11-19). Both spellings are
        // handled because Stripe has used both across API versions —
        // invoice.payment_succeeded is the name the build sheet uses, and
        // invoice.paid is its current twin; the ledger insert is idempotent
        // per invoice_id, so an invoice arriving under both names still
        // produces exactly one row. writeLedgerForInvoice never throws, so
        // a ledger problem can never fail this delivery or touch plan
        // activation — it comes back as a warning in the 200 body.
        //
        // NOTE: the `memorable-wonder` destination must be subscribed to
        // these event types in the Stripe dashboard, or this case never
        // runs. Today it subscribes only to checkout.session.completed and
        // the customer.subscription.* events (see wrangler.toml).
        case 'invoice.payment_succeeded':
        case 'invoice.paid': {
          const note = await writeLedgerForInvoice(env, obj);
          if (note && !warning) warning = note;
          break;
        }

        // A payment attempt failed (phase 2, 2026-11-20). The plan is NOT
        // touched here: Stripe retries on its own schedule, and if the
        // subscription is finally cancelled, the subscription events above
        // are what end access. This case only asks title22-email to tell
        // the customer — once per failed attempt, via the dedupe key's
        // attempt count.
        //
        // NOTE: the `memorable-wonder` destination must be subscribed to
        // invoice.payment_failed in the Stripe dashboard, or this case
        // never runs. It is NOT in the list the Nov 19 bundle build added
        // (invoice.payment_succeeded / invoice.paid) — see wrangler.toml.
        case 'invoice.payment_failed': {
          const subId = typeof obj.subscription === 'string'
            ? obj.subscription
            : (obj.subscription && obj.subscription.id) || null;
          const invEmail = obj.customer_email || await stripeCustomerEmail(env, obj.customer);
          const invUserId = await resolveUserId(env, { subscriptionId: subId, email: invEmail });
          if (!invUserId && !invEmail) {
            const note = 'PAYMENT-FAILED EMAIL SKIPPED — invoice ' + obj.id +
              ' could not be attributed to an account; no email was sent.';
            console.error(note);
            if (!warning) warning = note;
            break;
          }
          // Name the plan from the invoice's own lines when a line carries
          // a mapped price; otherwise the email template falls back to
          // generic wording. The ledger reads lines the same way.
          let invPlan = null, invPkg = null, invTraining = false;
          for (const line of (obj.lines && obj.lines.data) || []) {
            const t = line.price && PRICE_PLANS[line.price.id];
            if (t) {
              invPlan = normalisePlan(t.plan);
              invPkg = t.pkg || null;
              invTraining = !!t.training;
              break;
            }
          }
          // An add-on invoice names no plan. Name the add-on instead
          // (2026-11-22), so the failure email talks about the training
          // extra that failed — and never tells an add-on buyer their
          // package ended when they may not have one.
          let invAddon = null;
          if (!invPlan) {
            for (const line of (obj.lines && obj.lines.data) || []) {
              const at = line.price && ADDON_PRICES[line.price.id];
              if (at) { invAddon = at; invTraining = true; break; }
            }
          }
          const note = await notifyCustomerEmail(env, {
            template: 'payment_failed',
            dedupe_key: 'payment_failed:' + obj.id + ':' + (obj.attempt_count || 1),
            user_id: invUserId,
            email: invEmail,
            plan: invPlan,
            package: invPkg,
            training_included: invTraining,
            addon: invAddon,
            amount_due: typeof obj.amount_due === 'number' ? obj.amount_due / 100 : null,
          });
          if (note && !warning) warning = note;
          break;
        }

        default:
          // Everything else is acknowledged and ignored. Returning anything
          // other than 2xx makes Stripe retry an event we do not want.
          break;
      }
    } catch (e) {
      // 500 so Stripe retries: a Supabase blip should not cost someone the
      // plan they paid for.
      // The message in the body, not just the console. "Handler error" is what
      // this said on 2026-09-13 and it cost days: the delivery log is the only
      // record anyone can read after the fact, and it carried no cause. Nothing
      // reaches this line without a valid Stripe signature, so the only reader
      // is Stripe's own dashboard.
      const why = (e && e.message) || String(e);
      console.error('stripe-webhook failed on', event.type, why);
      return new Response('Handler error on ' + event.type + ': ' + why, { status: 500 });
    }

    // 200 either way — the event WAS handled and Stripe must not retry it. The
    // warning is cargo, not a status: it puts the problem on the delivery log
    // where a person will meet it, instead of in a console nobody is tailing.
    return new Response(JSON.stringify(warning ? { received: true, warning } : { received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  },
};

// Named exports for the test suite (test.mjs), following the convention of
// the other Workers in this repo: the default export above is the Worker
// itself; these are the pure pieces a test can check without a network.
export { PRICE_PLANS, ADDON_PRICES, ADDON_TIERS, addonFromSubscription, checkoutAccountEmail, portionForBeds, cappedPortion, splitAmounts };
