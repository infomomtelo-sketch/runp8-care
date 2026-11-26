// node tests/checkout-cart.test.mjs
// The one-checkout cart's arithmetic (Billing's "Your checkout" panel,
// Nov 25 2026): the locked price table, computed — binder $20/home
// with a package and $30 on its own, staff $5/home with the binder
// and $10 on its own, training by pooled beds and never sold beside a
// package or to a free account on its own. The pure logic is extracted
// from index.html between its markers, so what is tested is the code
// the page actually runs — the same discipline as the agreement
// door's logic tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const START = '// === CART LOGIC (pure — extracted by tests/checkout-cart.test.mjs) ===';
const END = '// === END CART LOGIC ===';
const a = html.indexOf(START), b = html.indexOf(END);
ok(a >= 0 && b > a, 'cart logic markers present in index.html');
const src = html.slice(a, b);
const { T22_CART_TABLE, T22_CART_PRICE_READY, t22TrainingTierForBeds, t22CartCompute } =
  new Function(src + '\nreturn { T22_CART_TABLE, T22_CART_PRICE_READY, t22TrainingTierForBeds, t22CartCompute };')();

const base = {
  ownedHomes: 1, pooledBeds: 6, hasPaidPlan: false, activePackage: null,
  trainingIncluded: false, binderActive: false, staffActive: false,
  agreementKnown: true, agreementFiled: true,
  pkgAgreementKnown: true, pkgAgreementFiled: true,
  sel: { pkg: null, training: false, binder: false, binderHomes: 1, staff: false, staffHomes: 1 },
};
const cart = (over = {}, selOver = {}) => t22CartCompute({ ...base, ...over, sel: { ...base.sel, ...selOver } });
const line = (r, kind) => r.lines.find(l => l.kind === kind);

// ---------- the locked table ----------
ok(T22_CART_TABLE.packages.pkg1.price === 29 && T22_CART_TABLE.packages.pkg2.price === 79 && T22_CART_TABLE.packages.pkg3.price === 139,
  'table: packages $29 / $79 / $139');
ok(T22_CART_TABLE.binderWithPackage === 20 && T22_CART_TABLE.binderStandalone === 30
  && T22_CART_TABLE.staffRegular === 10 && T22_CART_TABLE.staffBundle === 5,
  'table: binder $20 with a package / $30 standalone; staff $5 with the binder / $10 regular');
ok(T22_CART_PRICE_READY.staffRegular === true && T22_CART_PRICE_READY.binderWithPackage === false
  && T22_CART_PRICE_READY.binderStandalone === false && T22_CART_PRICE_READY.staffBundle === false,
  'staged state: only the staff $10 price exists in Stripe — binder and $5 bundle lines read as unpriced');

// ---------- training tiers by pooled beds ----------
ok(t22TrainingTierForBeds(6).price === 20 && t22TrainingTierForBeds(7).price === 35
  && t22TrainingTierForBeds(15).price === 35 && t22TrainingTierForBeds(16).price === 60
  && t22TrainingTierForBeds(49).price === 60 && t22TrainingTierForBeds(50).price === 100,
  'tiers: 1-6 beds $20, 7-15 $35, 16-49 $60, 50+ $100 (pooled across homes)');

// ---------- the mock's $54 cart: package + binder + staff ----------
{
  const r = cart({}, { pkg: 'pkg1', binder: true, staff: true });
  ok(line(r, 'package').amount === 29 && line(r, 'binder').amount === 20 && line(r, 'staff').amount === 5
    && r.total === 54, 'mock cart: pkg1 $29 + binder $20 (package price) + staff $5 (binder price) = $54/mo');
  ok(line(r, 'binder').detail.includes('$20 per home — the package price'),
    're-price words: the binder line says why it is $20');
  ok(r.unpricedNames.length === 2, 'mock cart today: binder and $5 staff lines are both unpriced (Stripe prices not created yet)');
}

// ---------- the mirror: binder first, then a package joins ----------
{
  const before = cart({}, { binder: true });
  ok(line(before, 'binder').amount === 30 && line(before, 'binder').detail.includes('$30 per home — on its own'),
    'binder first: $30 on its own, and the line says so');
  const after = cart({}, { binder: true, pkg: 'pkg1' });
  ok(line(after, 'binder').amount === 20, 'package joins: the binder re-prices to $20 before payment, not after');
}

// ---------- staff pricing ----------
{
  const alone = cart({}, { staff: true });
  ok(line(alone, 'staff').amount === 10 && line(alone, 'staff').unpriced === false,
    'staff alone: $10/home, and that price exists — the line can really be charged');
  const withBinder = cart({}, { binder: true, staff: true });
  ok(line(withBinder, 'staff').amount === 5 && line(withBinder, 'staff').detail.includes('$5 per home — with the Resident Binder'),
    'staff with the binder in the cart: $5/home, and the line says why');
  const binderAlreadyOn = cart({ binderActive: true }, { staff: true });
  ok(line(binderAlreadyOn, 'staff').amount === 5, 'staff beside an already-active binder: still the $5 bundle price');
}

// ---------- per-home quantities ----------
{
  const r = cart({ ownedHomes: 3 }, { binder: true, binderHomes: 3, staff: true, staffHomes: 2 });
  ok(line(r, 'binder').amount === 90 && line(r, 'staff').amount === 10,
    'per-home: binder 3 homes x $30 = $90; staff 2 homes x $5 = $10');
}

// ---------- training: never double-sold, never a free-account door ----------
{
  const r = cart({}, { pkg: 'pkg1', training: true });
  ok(r.modes.training === 'included' && !line(r, 'training') && r.total === 29,
    'training beside a package: included, not a line — the package price is the whole charge');
}
{
  const r = cart({}, { training: true });
  ok(r.modes.training === 'stepup' && !line(r, 'training'),
    'free account, nothing else in the cart: no standalone training door is offered (the Nov 23 gate)');
}
{
  // The addendum's example, Nov 25: binder-first, 1 home, up to 6
  // beds — binder $30 + training $20 = $50/mo.
  const r = cart({}, { binder: true, training: true });
  ok(r.modes.training === 'offer' && line(r, 'training').amount === 20 && r.total === 50,
    'binder-first addendum: binder $30 + training $20 (1-6 beds) = $50/mo');
}
{
  const r = cart({ trainingIncluded: true }, { training: true });
  ok(r.modes.training === 'on' && !line(r, 'training'), 'training already on: shown as on, never re-sold');
}
{
  const r = cart({ hasPaidPlan: true }, { training: true });
  ok(r.modes.training === 'offer' && line(r, 'training').amount === 20,
    'a paying (legacy plan) account may add training on its own — the gate is for free accounts');
}

// ---------- the binder's agreement states ----------
{
  const r = cart({ agreementKnown: false, agreementFiled: false }, { binder: true });
  ok(r.modes.binder === 'unknown' && !line(r, 'binder'),
    'agreement unreadable: the binder is not offered — fail closed, like the door itself');
}
{
  const r = cart({ binderActive: true }, { binder: true });
  ok(r.modes.binder === 'on' && !line(r, 'binder'), 'binder already on: shown as on, never re-sold');
}
{
  const r = cart({ activePackage: 'pkg2' }, { binder: true });
  ok(line(r, 'binder').amount === 20 && r.haveLines.length === 1,
    'a package already on the account prices the binder at $20 too — and shows as Already on, not a new line');
}

// ---------- the package agreement gate (Nov 25, 2026) ----------
{
  const r = cart({ pkgAgreementFiled: false }, { pkg: 'pkg1' });
  ok(r.pkgAgreementBlocked === true && r.pkgAgreementUnknown === false,
    'package picked, agreement not filed: checkout is blocked by the package door');
  ok(line(r, 'package').amount === 29, 'blocked package: the line still shows its price — the buyer sees what they are signing for');
}
{
  const r = cart({}, { pkg: 'pkg1' });
  ok(r.pkgAgreementBlocked === false && r.pkgAgreementUnknown === false,
    'package picked, agreement filed: no block — checkout may proceed');
}
{
  const r = cart({ pkgAgreementKnown: false, pkgAgreementFiled: false }, { pkg: 'pkg2' });
  ok(r.pkgAgreementUnknown === true && r.pkgAgreementBlocked === false,
    'package picked, agreement unreadable: checkout waits — fail closed, never waved through');
}
{
  const r = cart({ pkgAgreementFiled: false }, { binder: true, staff: true });
  ok(r.pkgAgreementBlocked === false && r.pkgAgreementUnknown === false,
    'add-on-only cart (binder + staff, no package): the package door does not apply');
}
{
  const r = cart({ pkgAgreementFiled: false }, {});
  ok(r.pkgAgreementBlocked === false, 'no package picked: no block, whatever the agreement state');
}

// ---------- the panel's wiring, on the served file ----------
ok(html.includes('id="checkout-panel"'), 'panel: the Your checkout card is in Billing');
ok(html.includes("stripe-webhook.infomomtelo.workers.dev/checkout"), 'panel: the checkout route URL is the stripe-webhook Worker');
ok(html.includes("openStripe('pkg1')") && html.includes('buy.stripe.com/5kQ00ieqC6p0g2fbfUg360v')
  && html.includes('title22-addon-pay.pages.dev'), 'not yet retired: the separate buy buttons all still stand (removal is the post-walk flip)');
ok(html.includes("t22CartBinderWanted=false;t22CartSel.binder=true"),
  'door in-flow: signing from the cart toggle completes the toggle — the same door, no second one');
ok(html.includes('id="package-agreement-modal"') && html.includes('id="package-sig-pad"') && html.includes('id="package-sign-btn"'),
  'package door: its own modal, signature pad and sign button stand in the page, alongside the binder door');
ok(html.includes("sb.from('title22_package_agreements')"),
  'package door: signatures file into title22_package_agreements — its own table, mirroring binder_agreements');
ok(html.includes('t22CartSel.pkg=t22CartPkgWanted'),
  'package door in-flow: signing from the cart pick completes the pick');
ok(html.includes('id="binder-agreement-modal"') && html.includes('function signBinderAgreement()'),
  'boundary: the binder door still stands untouched beside the new package door');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
