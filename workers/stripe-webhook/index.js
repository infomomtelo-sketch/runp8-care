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
const PRICE_PLANS = {
  'price_1UCIAiAH9qPFLg89ln6eHAVa': 'lite',       // $29, prod_VDBXSXDdmtFrmh
  'price_1UDWroAH9qPFLg89kAs9h49C': 'multi',      // $79 Multi-Home, prod_VDypF9WL2wmjGO
  'price_1TkIKtAH9qPFLg89SEmENr5J': 'starter',
  'price_1TkILaAH9qPFLg8923rgvHHb': 'pro',        // $79, the old link Multi-Home was sold on
  'price_1TkIMaAH9qPFLg89SPFZH0aG': 'specialist', // archived, legacy subs only
  'price_1TkINiAH9qPFLg89upIhpYTy': 'agency',
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

function planFromSubscription(sub) {
  const items = (sub.items && sub.items.data) || [];
  for (const it of items) {
    const priceId = it.price && it.price.id;
    if (priceId && PRICE_PLANS[priceId]) return { plan: PRICE_PLANS[priceId], priceId };
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

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const raw = await request.text();
    const ok = await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
    // 400, not 500: an unverified request is Stripe's to retry only if it was
    // genuinely ours, and a 500 would have it retry forever.
    if (!ok) return new Response('Signature verification failed', { status: 400 });

    let event;
    try { event = JSON.parse(raw); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    const obj = (event.data && event.data.object) || {};

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
          if (!userId) return new Response('No matching user for checkout session', { status: 202 });
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
          const { plan, priceId } = planFromSubscription(obj);
          const email = await stripeCustomerEmail(env, obj.customer);
          const userId = await resolveUserId(env, { subscriptionId: obj.id, email });
          if (!userId) return new Response('No matching user for subscription', { status: 202 });
          if (!plan) {
            // The failure that started all of this: an unmapped price used to
            // write nothing at all, silently. Now it is refused loudly enough
            // to show up in Stripe's delivery log and the Worker's tail.
            console.error('Unmapped Stripe price', priceId, 'on subscription', obj.id);
            return new Response('Unmapped price: ' + priceId, { status: 422 });
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
          if (!userId) return new Response('No matching user for cancellation', { status: 202 });
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
      console.error('stripe-webhook failed on', event.type, e && e.message);
      return new Response('Handler error', { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  },
};
