// node workers/stripe-webhook/test.mjs
// Runs the real Worker against a stubbed Supabase + Stripe API: no network,
// no secrets. All people, homes and invoices below are invented.
//
// NOTE: the Pkg2 price ID used here (price_1UdhZgAH9qPFLg89txlNvXye) was
// verified char-for-char on 2026-11-19 from a zoomed Stripe Events
// screenshot. These tests prove the map and the ledger math are consistent
// for the key as written.
//
// Cap-fix (2026-11-19): the suite also covers profiles.title22_package —
// written for package prices, null for directly matched legacy prices,
// cleared on a package -> legacy switch, and untouched by cancellation
// (mirroring the deployed deletion handler). 29 original checks + 6
// cap-fix checks = 35.
import { createHmac } from 'node:crypto';
import worker, { PRICE_PLANS, portionForBeds, cappedPortion, splitAmounts, AGREEMENT_ADDON_PRICES, agreementAddonFromSubscription, hasFiledBinderAgreement } from './index.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const SECRET = 'whsec_test';
const env = {
  SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_KEY: 'svc-test',
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: 'sk_test',
};

const PKG1 = 'price_1UdhR6AH9qPFLg896m0ZBAaL';
const PKG2 = 'price_1UdhZgAH9qPFLg89txlNvXye'; // verified 2026-11-19 — see header note
const PKG3 = 'price_1UdhdFAH9qPFLg89Td1Fs556';
const LITE = 'price_1UClAiAH9qPFLg89ln6eHAVa';
const MULTI = 'price_1UDWroAH9qPFLg89kAs9h49C';

const U = {
  A: 'aaaaaaaa-0000-0000-0000-000000000001',
  B: 'bbbbbbbb-0000-0000-0000-000000000002',
  C: 'cccccccc-0000-0000-0000-000000000003',
  D: 'dddddddd-0000-0000-0000-000000000004',
  E: 'eeeeeeee-0000-0000-0000-000000000005',
  F: 'ffffffff-0000-0000-0000-000000000006',
  G: '99999999-0000-0000-0000-000000000007',
};
const EMAIL = { A: 'a@example.com', B: 'b@example.com', C: 'c@example.com', D: 'd@example.com', E: 'e@example.com', F: 'f@example.com', G: 'g@example.com' };
const CUS = { A: 'cus_a', B: 'cus_b', C: 'cus_c', D: 'cus_d', E: 'cus_e', F: 'cus_f', G: 'cus_g' };

const db = {
  subs: {},            // stripe_subscription_id -> row
  facilities: {
    [U.A]: [{ id: 'fa1', capacity: 6, is_demo: false }, { id: 'fa-demo', capacity: 10, is_demo: true }],
    [U.B]: [6, 6, 6, 6, 6].map((c, i) => ({ id: 'fb' + i, capacity: c, is_demo: false })),
    [U.C]: [{ id: 'fc1', capacity: 55, is_demo: false }],
    [U.E]: [12, 12, 12, 12, 12].map((c, i) => ({ id: 'fe' + i, capacity: c, is_demo: false })),
    [U.F]: [{ id: 'ff1', capacity: 30, is_demo: false }],
    [U.G]: [{ id: 'fg1', capacity: 6, is_demo: false }],
  },
  ledger: [],
  agreements: new Set(),  // facility ids with a filed binder_agreements row
  ledgerFail: false,
  profilePatches: [],  // { userId, body }
};

const eq = (q, name) => { const v = q.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const method = init.method || 'GET';

  if (url.startsWith('https://api.stripe.com/v1/customers/')) {
    const id = decodeURIComponent(url.split('/').pop());
    const key = Object.keys(CUS).find(k => CUS[k] === id);
    return new Response(JSON.stringify(key ? { email: EMAIL[key] } : {}), { status: 200 });
  }
  if (url.startsWith('https://api.stripe.com/v1/prices/')) {
    return new Response(JSON.stringify({ id: 'price_unknown', unit_amount: 2900, recurring: { interval: 'month' }, product: 'prod_unknown' }), { status: 200 });
  }
  if (url.startsWith('https://db.example/auth/v1/admin/users')) {
    const users = Object.keys(U).map(k => ({ id: U[k], email: EMAIL[k] }));
    return new Response(JSON.stringify({ users }), { status: 200 });
  }

  const q = new URL(url).searchParams;

  if (url.startsWith('https://db.example/rest/v1/profiles')) {
    const userId = eq(q, 'id');
    db.profilePatches.push({ userId, body: JSON.parse(init.body) });
    return new Response(JSON.stringify([{ id: userId }]), { status: 200 });
  }

  if (url.startsWith('https://db.example/rest/v1/subscriptions')) {
    const subId = eq(q, 'stripe_subscription_id');
    if (method === 'GET') {
      const row = subId && db.subs[subId];
      return new Response(JSON.stringify(row ? [{ user_id: row.user_id }] : []), { status: 200 });
    }
    if (method === 'PATCH') {
      if (subId && db.subs[subId]) {
        Object.assign(db.subs[subId], JSON.parse(init.body));
        return new Response(JSON.stringify([db.subs[subId]]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'POST') {
      const row = JSON.parse(init.body);
      db.subs[row.stripe_subscription_id] = row;
      return new Response('', { status: 201 });
    }
  }

  if (url.startsWith('https://db.example/rest/v1/binder_agreements')) {
    const raw = q.get('facility_id') || '';
    const ids = raw.startsWith('in.(') && raw.endsWith(')') ? raw.slice(4, -1).split(',').filter(Boolean) : [];
    const rows = ids.filter(id => db.agreements.has(id)).map(id => ({ id: 'agr-' + id }));
    return new Response(JSON.stringify(rows), { status: 200 });
  }

  if (url.startsWith('https://db.example/rest/v1/facilities')) {
    const userId = eq(q, 'user_id');
    return new Response(JSON.stringify(db.facilities[userId] || []), { status: 200 });
  }

  if (url.startsWith('https://db.example/rest/v1/ctc_split_ledger')) {
    if (method === 'GET') {
      let rows = db.ledger.slice();
      const inv = eq(q, 'invoice_id'); if (inv) rows = rows.filter(r => r.invoice_id === inv);
      const prof = eq(q, 'profile_id'); if (prof) rows = rows.filter(r => r.profile_id === prof);
      const pkg = eq(q, 'package'); if (pkg) rows = rows.filter(r => r.package === pkg);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (method === 'POST') {
      if (db.ledgerFail) return new Response('boom', { status: 500 });
      const row = JSON.parse(init.body);
      // Simulate the UNIQUE constraint + ignore-duplicates: a second insert
      // of the same invoice_id succeeds but stores nothing.
      if (!db.ledger.some(r => r.invoice_id === row.invoice_id)) db.ledger.push(row);
      return new Response('', { status: 201 });
    }
  }

  return new Response('not stubbed: ' + url, { status: 404 });
};

async function send(event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const req = new Request('https://worker.example/', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${t},v1=${sig}` },
    body,
  });
  return worker.fetch(req, env);
}

const subEvent = (id, priceId, cusKey) => ({
  type: 'customer.subscription.created',
  data: {
    object: {
      id, customer: CUS[cusKey], status: 'active', metadata: {},
      items: { data: [{ price: { id: priceId }, current_period_end: 1799999999 }] },
    },
  },
});

const invoiceEvent = (type, id, subId, priceId, amountPaid, email) => ({
  type,
  data: {
    object: {
      id, subscription: subId, customer: 'cus_x', customer_email: email,
      amount_paid: amountPaid,
      lines: { data: [{ price: { id: priceId }, amount: amountPaid }] },
    },
  },
});

const lastPatchFor = userId => db.profilePatches.filter(p => p.userId === userId).slice(-1)[0];
const rowsFor = userId => db.ledger.filter(r => r.profile_id === userId);

// ---------- pure helpers ----------
ok(portionForBeds(6) === 20 && portionForBeds(7) === 35 && portionForBeds(15) === 35
  && portionForBeds(16) === 60 && portionForBeds(49) === 60 && portionForBeds(50) === 100,
  'portion tiers: 1-6->$20, 7-15->$35, 16-49->$60, 50+->$100');
ok(cappedPortion(PRICE_PLANS[PKG1], 30) === 20, 'pkg1 ceiling: 30 beds still a $20 portion');
ok(cappedPortion(PRICE_PLANS[PKG2], 60) === 60, 'pkg2 ceiling: 60 beds capped at $60, not the $100 tier');
ok(cappedPortion(PRICE_PLANS[PKG3], 60) === 100, 'pkg3: 60 beds reaches the $100 portion');
{
  const s = splitAmounts({ portion: 20, firstPaidMonth: true, invoiceAmount: 29 });
  ok(s.ctcDue === 20 && s.title22Keeps === 9, 'split math: pkg1 first month — CTC 20, Title22 keeps 9 of $29 (gross, before Stripe fees)');
}
{
  const s = splitAmounts({ portion: 20, firstPaidMonth: false, invoiceAmount: 29 });
  ok(s.ctcDue === 10 && s.title22Keeps === 19, 'split math: pkg1 month 2 — CTC 10, Title22 keeps 19');
}
{
  const s = splitAmounts({ portion: 100, firstPaidMonth: false, invoiceAmount: 139 });
  ok(s.ctcDue === 50 && s.title22Keeps === 89, 'split math: pkg3 steady state — CTC 50, Title22 keeps 89');
}
ok(PRICE_PLANS[PKG1].plan === 'lite' && PRICE_PLANS[PKG2].plan === 'multi-home' && PRICE_PLANS[PKG3].plan === 'multi-home',
  'price map: pkg1 -> lite, pkg2/pkg3 -> multi-home (app key: multi)');
ok(PRICE_PLANS[PKG1].training && PRICE_PLANS[PKG2].training && PRICE_PLANS[PKG3].training
  && !PRICE_PLANS[LITE].training, 'price map: training flag on packages only, not on Lite');

// ---------- subscription events: plan + training flag ----------
{
  const res = await send(subEvent('sub_a1', PKG1, 'A'));
  const p = lastPatchFor(U.A);
  ok(res.status === 200 && p && p.body.title22_plan === 'lite' && p.body.title22_training_included === true,
    'pkg1 subscription: plan lite written WITH title22_training_included');
}
{
  const res = await send(subEvent('sub_b1', PKG2, 'B'));
  const p = lastPatchFor(U.B);
  ok(res.status === 200 && p && p.body.title22_plan === 'multi' && p.body.title22_training_included === true,
    'pkg2 subscription: plan normalised to multi WITH training flag');
}
{
  const res = await send(subEvent('sub_c1', PKG3, 'C'));
  const p = lastPatchFor(U.C);
  ok(res.status === 200 && p && p.body.title22_plan === 'multi' && p.body.title22_training_included === true,
    'pkg3 subscription: plan multi WITH training flag');
}
{
  const res = await send(subEvent('sub_d1', LITE, 'D'));
  const p = lastPatchFor(U.D);
  ok(res.status === 200 && p && p.body.title22_plan === 'lite' && !('title22_training_included' in p.body),
    'legacy Lite subscription: plan lite, NO training flag key written');
}

// ---------- cap-fix: title22_package (statement 5) ----------
{
  const res = await send(subEvent('sub_a2', PKG1, 'A'));
  const p = lastPatchFor(U.A);
  ok(res.status === 200 && p && p.body.title22_package === 'pkg1',
    'cap-fix: pkg1 subscription writes title22_package = pkg1');
}
{
  const res = await send(subEvent('sub_b2', PKG2, 'B'));
  const p = lastPatchFor(U.B);
  ok(res.status === 200 && p && p.body.title22_package === 'pkg2',
    'cap-fix: pkg2 subscription writes title22_package = pkg2');
}
{
  const res = await send(subEvent('sub_c2', PKG3, 'C'));
  const p = lastPatchFor(U.C);
  ok(res.status === 200 && p && p.body.title22_package === 'pkg3',
    'cap-fix: pkg3 subscription writes title22_package = pkg3');
}
{
  const res = await send(subEvent('sub_d2', LITE, 'D'));
  const p = lastPatchFor(U.D);
  ok(res.status === 200 && p && 'title22_package' in p.body && p.body.title22_package === null,
    'cap-fix: legacy Lite subscription writes title22_package = null (key present, no package)');
}
{
  // The downgrade the null exists for: pkg3 first, then a move back to a
  // legacy price. The second event must clear the package, or the app
  // would keep a downgraded account uncapped on the stale 'pkg3'.
  await send(subEvent('sub_g2', PKG3, 'G'));
  const before = lastPatchFor(U.G);
  const res = await send({ ...subEvent('sub_g3', MULTI, 'G'), type: 'customer.subscription.updated' });
  const p = lastPatchFor(U.G);
  ok(before && before.body.title22_package === 'pkg3' && res.status === 200
    && p && p.body.title22_plan === 'multi' && p.body.title22_package === null,
    'cap-fix: package -> legacy switch clears title22_package to null');
}
{
  // Cancellation mirrors the deployed handler exactly: it stamps only the
  // period end. title22_plan, the training flag and the package are all
  // left in place — access is locked by title22_plan_expires_at, and the
  // app lifts the pkg3 cap only for an entitled account, so the stale
  // package column cannot uncap a cancelled account. See cap-fix notes.
  const res = await send({ type: 'customer.subscription.deleted', data: { object: {
    id: 'sub_a1', customer: CUS.A, status: 'canceled',
    items: { data: [{ price: { id: PKG1 }, current_period_end: 1799999999 }] },
  } } });
  const p = lastPatchFor(U.A);
  ok(res.status === 200 && p && !!p.body.title22_plan_expires_at
    && !('title22_package' in p.body) && !('title22_training_included' in p.body) && !('title22_plan' in p.body),
    'cap-fix: cancellation stamps only the period end — package and flag left in place, as deployed');
}

// ---------- invoice events: the ledger ----------
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_a1', 'sub_a1', PKG1, 2900, EMAIL.A));
  const rows = rowsFor(U.A);
  ok(res.status === 200 && rows.length === 1, 'pkg1 invoice 1: one ledger row written');
  const r = rows[0] || {};
  ok(r.homes_count === 1 && r.pooled_beds === 6, 'pkg1 invoice 1: demo home excluded — 1 home, 6 pooled beds');
  ok(r.portion === 20 && r.first_paid_month === true && r.ctc_due === 20 && r.title22_keeps === 9 && r.invoice_amount === 29,
    'pkg1 invoice 1 (first month): portion 20, CTC due 20, Title22 keeps 9');
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_a2', 'sub_a1', PKG1, 2900, EMAIL.A));
  const rows = rowsFor(U.A);
  const r = rows[1] || {};
  ok(res.status === 200 && rows.length === 2 && r.first_paid_month === false && r.ctc_due === 10 && r.title22_keeps === 19,
    'pkg1 invoice 2 (month 2): 50/50 — CTC due 10, Title22 keeps 19');
}
{
  // Idempotency: the same invoice redelivered, then again under the twin
  // event name. Still exactly two rows for A.
  await send(invoiceEvent('invoice.payment_succeeded', 'in_a2', 'sub_a1', PKG1, 2900, EMAIL.A));
  await send(invoiceEvent('invoice.paid', 'in_a2', 'sub_a1', PKG1, 2900, EMAIL.A));
  ok(rowsFor(U.A).length === 2, 'idempotency: same invoice twice (+ twin event name) — still one row per invoice');
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_b1', 'sub_b1', PKG2, 7900, EMAIL.B));
  const r = rowsFor(U.B)[0] || {};
  ok(res.status === 200 && r.homes_count === 5 && r.pooled_beds === 30 && r.portion === 60
    && r.first_paid_month === true && r.ctc_due === 60 && r.title22_keeps === 19,
    'pkg2 invoice: 5 homes pooled to 30 beds — portion 60, first month CTC 60, keeps 19');
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_e1', 'sub_e1', PKG2, 7900, EMAIL.E));
  const r = rowsFor(U.E)[0] || {};
  ok(res.status === 200 && r.pooled_beds === 60 && r.portion === 60 && r.ctc_due === 60,
    'ceiling: pkg2 with 60 pooled beds — portion capped at $60 (tier alone would be $100)');
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_c1', 'sub_c1', PKG3, 13900, EMAIL.C));
  const r = rowsFor(U.C)[0] || {};
  ok(res.status === 200 && r.portion === 100 && r.first_paid_month === true && r.ctc_due === 100 && r.title22_keeps === 39,
    'pkg3 invoice 1 (XL, first month): portion 100, CTC 100, keeps 39');
  const res2 = await send(invoiceEvent('invoice.payment_succeeded', 'in_c2', 'sub_c1', PKG3, 13900, EMAIL.C));
  const r2 = rowsFor(U.C)[1] || {};
  ok(res2.status === 200 && r2.first_paid_month === false && r2.ctc_due === 50 && r2.title22_keeps === 89,
    'pkg3 invoice 2: 50/50 — CTC 50, keeps 89');
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_f1', 'sub_f1', PKG1, 2900, EMAIL.F));
  const r = rowsFor(U.F)[0] || {};
  ok(res.status === 200 && r.pooled_beds === 30 && r.portion === 20 && r.ctc_due === 20,
    'ceiling: pkg1 single 30-bed home — portion capped at $20 inside the $29 package');
}
{
  const before = db.ledger.length;
  await send(invoiceEvent('invoice.payment_succeeded', 'in_d1', 'sub_d1', LITE, 2900, EMAIL.D));
  ok(db.ledger.length === before, 'non-package invoice (Lite): no ledger row');
  await send(invoiceEvent('invoice.payment_succeeded', 'in_a0', 'sub_a1', PKG1, 0, EMAIL.A));
  ok(db.ledger.length === before, '$0 package invoice (trial start): no ledger row');
}

// ---------- failure isolation ----------
{
  db.ledgerFail = true;
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_g1', 'sub_g1', PKG1, 2900, EMAIL.G));
  const body = await res.json().catch(() => ({}));
  ok(res.status === 200 && typeof body.warning === 'string' && body.warning.includes('CTC LEDGER FAILED'),
    'ledger insert fails: invoice delivery still 200, warning rides in the body');
  ok(rowsFor(U.G).length === 0, 'ledger insert fails: no partial row stored');
  const res2 = await send(subEvent('sub_g1', PKG1, 'G'));
  const p = lastPatchFor(U.G);
  ok(res2.status === 200 && p && p.body.title22_plan === 'lite' && p.body.title22_training_included === true,
    'ledger down: plan activation on the subscription event is unaffected');
  db.ledgerFail = false;
}
{
  const res = await send(invoiceEvent('invoice.payment_succeeded', 'in_x1', 'sub_nope', PKG1, 2900, 'nobody@example.com'));
  const body = await res.json().catch(() => ({}));
  ok(res.status === 200 && typeof body.warning === 'string' && body.warning.includes('CTC LEDGER SKIPPED'),
    'unattributed package invoice: 200 with a SKIPPED warning, no crash, no row');
}

// ---------- Resident Binder add-on: the agreement guard ----------
// No binder price exists yet, so every binder subscription below is
// recognised ONLY by its metadata (product_kind=binder_addon) on an
// unmapped price — exactly the shape the future Payment Link will send.
// The test env carries no EMAIL_WORKER_URL / EMAIL_SERVICE_SECRET, so
// notifyBlockedAlert returns its SKIPPED note and the handler surfaces
// it in the response warning — that is what "the blocked alert was
// attempted" is asserted on.
const BINDER_PRICE = 'price_binder_unmapped_test';
const binderSubEvent = (id, cusKey) => ({
  type: 'customer.subscription.created',
  data: {
    object: {
      id, customer: CUS[cusKey], status: 'active', metadata: { product_kind: 'binder_addon' },
      items: { data: [{ price: { id: BINDER_PRICE }, current_period_end: 1799999999 }] },
    },
  },
});
const patchesSince = n => db.profilePatches.slice(n);

ok(AGREEMENT_ADDON_PRICES && Object.keys(AGREEMENT_ADDON_PRICES).length === 0,
  'binder guard: AGREEMENT_ADDON_PRICES is empty — no binder price exists yet');
{
  const r = agreementAddonFromSubscription(binderSubEvent('sub_probe', 'A').data.object);
  ok(r && r.viaFallback === 'metadata' && r.priceId === BINDER_PRICE,
    'binder guard: recognizer names the metadata fallback and the price');
  ok(agreementAddonFromSubscription(subEvent('sub_probe2', PKG1, 'A').data.object) === null,
    'binder guard: recognizer returns null for a package subscription');
  ok(await hasFiledBinderAgreement(env, U.B) === false,
    'binder guard: hasFiledBinderAgreement is false when no agreement row exists');
}
{
  // (a) Binder subscription, NO agreement on file: handled (200, NOT
  // the 422 an unmapped price would otherwise get), nothing stamped,
  // and the blocked alert was attempted.
  const before = db.profilePatches.length;
  const res = await send(binderSubEvent('sub_binder_b', 'B'));
  const body = await res.json().catch(() => ({}));
  ok(res.status === 200, 'binder guard (a): no agreement on file — 200, not 422');
  ok(!patchesSince(before).some(p => 'title22_binder_addon' in p.body),
    'binder guard (a): no agreement on file — title22_binder_addon NOT stamped');
  ok(typeof body.warning === 'string' && body.warning.includes('ADDON BLOCKED ALERT SKIPPED'),
    'binder guard (a): blocked alert attempted — SKIPPED note rides in the warning');
}
{
  // (b) Same subscription, WITH an agreement row on one of the
  // account's facilities (A has fa1 + fa-demo): the flag is stamped.
  db.agreements.add('fa1');
  ok(await hasFiledBinderAgreement(env, U.A) === true,
    'binder guard (b): hasFiledBinderAgreement is true with a row on fa1');
  const before = db.profilePatches.length;
  const res = await send(binderSubEvent('sub_binder_a', 'A'));
  ok(res.status === 200 && patchesSince(before).some(p => p.userId === U.A && p.body.title22_binder_addon === true),
    'binder guard (b): agreement on file — title22_binder_addon: true stamped');
}
{
  // (c) Binder subscription for an account with NO facilities at all
  // (D has none in db.facilities): there is nowhere an agreement could
  // be filed, so it is blocked and nothing is stamped.
  const before = db.profilePatches.length;
  const res = await send(binderSubEvent('sub_binder_d', 'D'));
  const body = await res.json().catch(() => ({}));
  ok(res.status === 200 && !patchesSince(before).some(p => 'title22_binder_addon' in p.body)
    && typeof body.warning === 'string' && body.warning.includes('ADDON BLOCKED ALERT SKIPPED'),
    'binder guard (c): account with no facilities — blocked, no stamp, alert attempted');
}
{
  // Cancellation of a binder subscription clears ONLY the binder flag —
  // it never reaches the generic path's plan-expiry stamp.
  const res = await send({ type: 'customer.subscription.deleted', data: { object: {
    id: 'sub_binder_a', customer: CUS.A, status: 'canceled', metadata: { product_kind: 'binder_addon' },
    items: { data: [{ price: { id: BINDER_PRICE }, current_period_end: 1799999999 }] },
  } } });
  const p = lastPatchFor(U.A);
  ok(res.status === 200 && p && p.body.title22_binder_addon === false && !('title22_plan_expires_at' in p.body),
    'binder guard: cancellation clears title22_binder_addon only — no plan-expiry stamp');
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
