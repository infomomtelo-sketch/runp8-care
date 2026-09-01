# runp8-care — working rules

Single-file vanilla JS/HTML SPA (index.html, ~487KB)
serving title22.app. Not React. Pages shown via
showPage()/switchTab(), global onclick handlers.
Marketing site is a separate repo (title-22-site).

## Verify before reporting
Re-read files from the committed branch state after
committing, not from your working copy, before claiming
an edit landed.

## AI is on every tier (settled Aug 1 2026)
TIER_LIMITS has ai:true on all tiers including trial.
Any copy saying AI is a paid-tier feature is stale and
wrong. The two strings that used to say so (the nav
tooltip and the showTierUpsell message) are gone — grep
before adding any new plan-gated wording around Tello.

## Tiers
Three purchasable: Starter $49 (1 facility), Pro $79 (up
to 5), Agency $249 (unlimited). Specialist/$149 is
archived — it survives only as a legacy label for
existing subscribers. Do not surface it as an offer.
The $79 tier is "Pro" everywhere: T22_LABEL, the billing
tab's upgrade card, customer email, legal.html, and
title-22.com. Stripe plan keys are unchanged.

## PHI line — do not cross
Resident documents (LIC 601, LIC 602A, ISP) are PHI and
are UPLOAD ONLY. No photo-scan of resident or medication
documents to the Anthropic API — no HIPAA BAA is
confirmed. Staff records (TB, Live Scan, certs) are
employment records, not PHI, and may use scan.
The AI never suggests, corrects, or comments on clinical
dosage information, on any plan.

## Claims wording
Audit log is "append-only" — never "immutable" or
"tamper-evident". No absolute compliance claims; we don't
guarantee compliance or inspection outcomes.

## Known open bugs
None tracked here right now. The three that were listed
are fixed in main: .modal sets
-webkit-overflow-scrolling:touch, auth and account fields
use togglePasswordField(), and trial grants facilities:2.

## legal.html is superseded
title22.app/legal.html is an older five-tab legal centre
that duplicates terms.html and privacy.html. It is
unlinked, noindexed, and carries a banner pointing at the
current documents. Do not update it as if it were live —
whether it should exist at all is still open.
