# Title22 System — No-PHI Lite — READ FIRST

Live Domains: title22.app (app) + title-22.com (marketing)
DB: Supabase project title22
- PHI PURGE COMPLETE: residents=0, medications=0, mar_entries=0, daily_logs=0
- incidents.resident_id = NULL (12 rows unlinked, keep for LIC 624)
- documents with resident_id = 0 already
- DO NOT repopulate those tables. DO NOT query them if showMAR=false.

App State:
- showMAR=false
- users table has paid boolean, stripe_customer_id, plan
- Stripe Payment Links Lite $29/mo, success_url = https://title22.app#welcome
- Stripe webhook DEPLOYED (see below) — but it writes profiles and
  subscriptions, not users, so users.paid still never flips
- Quick buttons still have resident queries — must delete for Lite

AI Tello:
- Lives in index.html / components/Tello* / lib/prompts* — search "I live inside Title22"
- CURRENTLY WRONG: says "I can see residents..." but residents=0
- Must be No-PHI: Only staff, training, certs, DSS readiness, LIC 624 without PHI

Goal: No-PHI Lite $29, infra $25 Pro, downgrade from $599 Enterprise

---

## Status of the four items above (as of 2026-09-08)

Kept here so the block above is not read as a to-do list twice. Three are
done; the fourth is half done, and the half that is missing is the half that
a customer notices:

- **Quick buttons — done.** "Which residents are missing documents?" is
  deleted from Tello's tab. The onboarding tour's residents and MAR stops
  are skipped in Lite (they opened tabs that no longer exist).
- **Tello — done.** `TELLO_CHARACTER` in `index.html` is the No-PHI prompt.
  `buildFacilityContext` no longer reads `residents` or `mar_entries` and
  omits both keys rather than sending them empty. `tello.html`'s knowledge
  base was rewritten too — it was still selling the MAR.
- **There is no `components/` or `lib/`.** Tello lives in `index.html`
  (`TELLO_CHARACTER`, `buildFacilityContext`, the briefing prompt),
  `tello.html` (`CHARACTER`, the public page), and
  `workers/title22-ai/index.js` (a generic fallback string only).
- **Webhook — deployed, and it is not the file you will find first.**
  What runs is the Cloudflare Worker `stripe-webhook`, deployed 2026-09-07
  against the `memorable-wonder` Stripe destination, with its source in
  `workers/stripe-webhook/`. It verifies the signature with Web Crypto, maps
  `price_1UCIAiAH9qPFLg89ln6eHAVa` → `lite` (the missing entry that charged a
  card on 2026-09-06 and left the customer on "Free Trial"), and writes both
  `profiles.title22_*` and `public.subscriptions`.

  It does **not** write `users`. Nothing does. `enforcePaidGate` and
  `welcomeIsPaid` still read `users.paid`, so the welcome page still polls
  for 30 seconds and times out for every buyer — the plan lands correctly in
  `profiles`, the welcome page just looks somewhere else. Fixing it is one
  function: point `welcomeIsPaid` at the same source `readSubscription`
  already trusts, or have the Worker upsert `users` as well.

  `api/stripe-webhook.js` is NOT what runs and never has — it is a Vercel
  handler on a Cloudflare Pages site. It is kept byte-identical because it
  was supplied that way with "do not modify it". Read `api/README.md` before
  assuming it does anything.

## Recordings and copy: all removed (2026-09-07/08)

Do not re-audit this; it was done frame by frame.

- Every walkthrough clip is deleted from both repos. `media/` is gone from
  this repo; `videos/` on the marketing site keeps only
  `title22-trainer-pitch.mp4` (classroom footage and title cards, no product
  screens). Each deleted clip showed a Residents tab, a MAR, or named
  residents with rooms and dates of birth.
- `VIDEO_MAP` is `{}` on purpose, so `setupVideoHelpButtons` adds no "How To"
  button. Refill it only with something current.
- `title22-walkthrough.html` and `title-22.com/walkthrough/` are written
  step pages now, not players. Nothing loads.
- `training/` lost its "Recording a medication (MAR)" and "Resident records"
  lessons; six remain. `tello.html`, `trainers.html` and `privacy.html` were
  corrected too.
- Team Access role cards ship the Lite wording in the markup, with the full
  wording in `data-full`, restored by `applyLiteMode` only if `showMAR`
  returns. `ROLE_BRIEF` has the same `liteCan`/`liteCannot` pattern, read
  through `roleBrief()`.

## Repo shape

Single-file vanilla JS/HTML SPA (index.html, ~490KB)
serving title22.app. Not React. Pages shown via
showPage()/switchTab(), global onclick handlers. Deploys
to Cloudflare Pages with no build step; the backend bits
are Cloudflare Workers under workers/.
Marketing site is a separate repo (title-22-site).

## Verify before reporting
Re-read files from the committed branch state after
committing, not from your working copy, before claiming
an edit landed.

## How Lite is enforced
`showMAR = false` is the switch, and it is not cosmetic:
- `allowedTabs()` subtracts mar/medications/residents/daily
  from every role, `switchTab` refuses them with a toast.
- `applyLiteMode()` (end of `applyRoleUI`) hides the
  sidebar and menu entries, the dashboard MAR card and the
  resident tiles.
- The Supabase client's fetch is wrapped (`t22Fetch`):
  requests to mar_entries, medications, residents and
  daily_logs never leave the browser — reads answer empty,
  writes are refused.
This is a product control, not a security one. The
database-level version (revoking the grants) is written
out in migrations/2026-09-06_title22_lite_drop_phi.sql.

## AI is on every tier (settled Aug 1 2026)
TIER_LIMITS has ai:true on all tiers including trial and
the lite/multi keys. Any copy saying AI is a paid-tier
feature is stale and wrong. Known stale strings still
present:
  nav tooltip "Multi-Facility & Agency feature"
  showTierUpsell "Tello ... available on
              Multi-Facility and Agency plans"

## Tiers
Selling now: **Lite $29** (1 facility) and **Multi-Home
$79** (up to 5). Agency is "Contact Sales", no price.
starter/pro/specialist/agency remain in TIER_LIMITS and
T22_LABEL as legacy labels for existing subscribers — do
not surface them as offers. `STRIPE_MULTI` is the old $79
Pro payment link under a new name.

## PHI line — do not cross
Lite holds no resident health information at all: no
resident records, no medications, no MAR, no LIC 601 or
LIC 602A. Do not add one back without a decision about
the BAA that removing them avoided.
Staff records (TB, Live Scan, certs) are employment
records, not PHI, and may use scan.
The AI never suggests, corrects, or comments on clinical
dosage information, on any plan.
Incidents (LIC 624) are kept, unlinked from residents —
do not re-link them or add resident names to the export.

## Admission forms are print-only
Dormant in Lite — ADMISSION_FORMS renders in the resident
modal, which Lite does not show. The rule stands for
whenever it returns: print list only, the app captures
nothing off these pages, requires none of them back, and
scores no resident on them. Links always point at the
live CDSS copy, never a hosted one. Never derive a form
URL — the paths vary in case and in shape (LIC601.PDF,
lic602a.pdf, LIC613C-2.pdf, and a LIC625 outside
/cdssweb/ entirely). Add one only after someone opened it
and saw the right form.

## "How to complete this" guidance
DOC_SLOT_HOWTO is the one source: the doc slots render
it on an empty slot, and buildFacilityContext sends the
same text to Tello as document_guidance so she answers
from it instead of inventing. Entries say what the
document IS and who issues it — never how often it is
due, how long it stays valid, or what an inspector
accepts. Same reason checklist citations are null and
Tello may not state a requirement as fact. Anything
regulatory goes to the licensing analyst. This is why
Tello's prompt keeps a hard rule against quoting a
requirement: "unless I'm certain" is the model's own
confidence, which is not a gate.

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
guarantee compliance or inspection outcomes. "No PHI" is
a claim about what the product holds — it stays true only
while nothing re-adds resident data.

## Known open bugs
- users.paid never flips. The webhook IS live now, but it
  writes profiles.title22_* and public.subscriptions —
  nothing writes users. So everyone who pays still lands
  on the welcome page, polls users.paid for 30s and times
  out, while their plan sits correct in profiles. One
  function to fix: welcomeIsPaid (index.html).
- The users table's "allow all for webhook" RLS policy
  lets the published anon key read every customer email
  and set paid=true. Narrower policy is in the migration.
- Mobile Safari: add/edit modals won't scroll. No
  -webkit-overflow-scrolling in the file.
- No password show/hide toggle on auth fields.
- trial tier grants facilities:5, same as the $79 tier.
