// node workers/stripe-webhook/test.mjs
// Runs the real Worker against a stubbed Supabase + Stripe API: no network,
// no secrets. All people, homes and invoices below are invented.
//
// NOTE: the Pkg2 price ID used here (price_1UdhZgAH9qPFLg89txlNvXye) was
// verified char-for-char on 2026-11-19 from a zoomed Stripe Events
// screenshot. These tests prove the map and the ledger math are consistent
// for the key as written.
import { createHmac } from 'node:crypto';
import worker, { PRICE_PLANS, portionForBeds, cappedPortion, splitAmounts } from './index.js';

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

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
