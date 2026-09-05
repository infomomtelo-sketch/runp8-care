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
wrong. Known stale strings still present:
  ~line 2288  nav tooltip "Multi-Facility & Agency feature"
  ~line 2314  showTierUpsell "Tello ... available on
              Multi-Facility and Agency plans"

## Tiers
Three purchasable: Starter $49 (1 facility), Pro $79 (up
to 5), Agency $249 (unlimited). Specialist/$149 is
archived — it survives only as a legacy label for
existing subscribers. Do not surface it as an offer.
Marketing sells the $79 tier as "Pro"; the app's
T22_LABEL renders it "Facility" — these disagree and need
one name.

## PHI line — do not cross
Resident documents (LIC 601, LIC 602A, ISP) are PHI and
are UPLOAD ONLY. No photo-scan of resident or medication
documents to the Anthropic API — no HIPAA BAA is
confirmed. Staff records (TB, Live Scan, certs) are
employment records, not PHI, and may use scan.
The AI never suggests, corrects, or comments on clinical
dosage information, on any plan.

## Typeahead suggestions
Form autocomplete draws on two sources only: the
bundled TA_SEEDS lists and values this facility has
already saved (read under existing RLS). Never AI, OCR
or any scan. taSafe() drops any candidate containing a
digit, and dosage, directions, room, hours, capacity,
phone, licence, Rx and ZIP fields are not registered at
all — a number is always typed by hand. Address lookup
(title22-geo -> Geoapify) is the one exception to the
digit rule and is limited to the facility address
fields.

## Claims wording
Audit log is "append-only" — never "immutable" or
"tamper-evident". No absolute compliance claims; we don't
guarantee compliance or inspection outcomes.

## Known open bugs
- Mobile Safari: add/edit modals won't scroll. No
  -webkit-overflow-scrolling in the file.
- No password show/hide toggle on auth fields.
- trial tier grants facilities:5, same as the $79 tier.
