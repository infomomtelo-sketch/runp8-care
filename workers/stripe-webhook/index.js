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
  'price_1TkIKtAH9qPFLg89SEmENr5J': { plan: 'starter',    facilities: 1,        name: 'Title22 Starter' },     // legacy subs only
  'price_1TkILaAH9qPFLg8923rgvHHb': { plan: 'pro',        facilities: 5,        name: 'Title22 Pro' },         // $79, the old link Multi-Home was sold on
  'price_1TkIMaAH9qPFLg89SPFZH0aG': { plan: 'specialist', facilities: 5,        name: 'Title22 Specialist' },  // archived, legacy subs only
  'price_1TkINiAH9qPFLg89upIhpYTy': { plan: 'agency',     facilities: Infinity, name: 'Title22 Agency' },

  // The two Map bundles, created in Stripe on 2026-09-11 and unknown to this
  // file until 2026-09-14. Both were live and sellable for three days while the
  // Worker had never heard of either price — a purchase of one would have been
  // charged, refused with 422, and left the customer reading "Free Trial".
  // That is the 2026-09-06 failure exactly, and it was found by reading a
  // screenshot of the Stripe product list, not by anything in this repo
  // noticing.
  //
  // THEY MAP TO THEIR BASE TIER ON PURPOSE, and this is a decision worth
  // understanding before anyone "corrects" it. There is no Map feature in the
  // app: nothing in index.html reads a map entitlement, TIER_LIMITS has no row
  // for one, and T22_PAID does not know the word. A dedicated 'lite-map' key
  // would therefore behave identically to 'lite' while adding two more plan
  // strings to keep in sync across TIER_LIMITS, T22_PAID, T22_LABEL and
  // KNOWN_PLANS — which is precisely the shape of the 'multi' vs 'multi-home'
  // bug that PLAN_ALIASES exists to clean up after.
  //
  // So the bundle buyer gets every entitlement the app can actually grant:
  // Lite+Map gets one facility and Tello, Multi+Map gets five and Tello. What
  // they do NOT get is a Map feature, which is equally true of every other
  // outcome available today, the 422 included. The difference is that this way
  // their account works.
  //
  // When the Map feature ships, give these their own keys and add the rows.
  // Until then a working account beats an accurate label.
  'price_1UEHzFAH9qPFLg89BoNbAPm9': { plan: 'lite',       facilities: 1,        name: 'Title22 Lite + Map Bundle' },        // $99,  created 2026-09-11
  'price_1UEIVpAH9qPFLg89qOs5pvRg': { plan: 'multi-home', facilities: 5,        name: 'Title22 Multi-Home + Map Bundle' },  // $149, created 2026-09-11
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
  const metaPlan = normalisePlan(sub.metadata && sub.metadata.plan);
  return { plan: metaPlan, priceId: items[0] && items[0].price && items[0].price.id };
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
          const userId = await resolveUserId(env, {
            subscriptionId,
            clientReferenceId: obj.client_reference_id,
            email,
          });
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
          let { plan, priceId } = planFromSubscription(obj);
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
                `Known products: ${Object.keys(PRODUCT_PLANS).join(', ')}`;
              console.error('Unmapped Stripe price', priceId, 'on subscription', obj.id, '-', describePrice(price));
              return new Response(body, { status: 422 });
            }
          }
          const periodEnd = periodEndOf(obj);
          const active = obj.status === 'active' || obj.status === 'trialing';
          await patchProfile(env, userId, {
            title22_plan: active ? plan : undefined,
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
          break;
        }

        // The downgrade path. Access runs to the end of the paid period.
        case 'customer.subscription.deleted': {
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
