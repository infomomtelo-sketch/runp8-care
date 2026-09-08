# Title22 System — No-PHI Lite — READ FIRST

Live Domains: title22.app (app) + title-22.com (marketing)
DB: Supabase project title22
- PHI PURGE COMPLETE: residents=0, medications=0, mar_entries=0, daily_logs=0
- incidents.resident_id = NULL (12 rows unlinked, keep for LIC 624)
- documents with resident_id = 0 already
- DO NOT repopulate those tables. DO NOT query them if showMAR=false.

App State:
- showMAR=false
- there is NO users table — that migration was never run (see below)
- Stripe Payment Links Lite $29/mo, success_url = https://title22.app#welcome
- Stripe webhook DEPLOYED (see below), writing profiles and subscriptions
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

  It does not write `users`, and that turned out not to matter:
  **`public.users` does not exist.** Its migration
  (`2026-09-06_title22_lite_users.sql`) was never run — confirmed against the
  database on 2026-09-08, `ERROR 42P01`. So the paid gate was reading a table
  that was never created, and two long-standing entries in this file's bug
  list described a world that does not exist. Both are corrected below.

  `welcomeIsPaid` now resolves the entitlement instead, and requires a plan in
  `T22_PAID` — a trial is entitled and has paid nothing. `enforcePaidGate`'s
  `users` read is gone entirely; it always errored, so the gate never once
  fired, and `allowedTabs()` had been doing that job all along.

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
feature is stale and wrong.

The two stale strings this section used to list — the nav
tooltip "Multi-Facility & Agency feature" and
showTierUpsell's "Tello ... available on Multi-Facility
and Agency plans" — are GONE. Swept 2026-09-08: zero
matches in index.html or tello.html, and showTierUpsell
now talks only about facility counts. ("Multi-Facility"
survives once, as T22_LABEL.specialist, which is the
legacy label for that tier and is meant to.)

showTierUpsell still takes a `feature` argument it no
longer reads, and switchTab's showTierUpsell('ai') call
site is unreachable — it is guarded on t22Entitled, and
ai:true everywhere means !t22Limits.ai is only the
fail-closed default. Harmless; noted so nobody re-derives
it.

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
The incident form hides its Resident field in Lite and
saves resident_id null; it used to REQUIRE a selection
from a list that is always empty, so no incident could be
filed at all. In its place the form carries a note: do
not name a resident in the description. That free-text
box is the only place PHI can now get in, and a note is
the only control on it.

Reads must not embed residents either. t22Fetch matches
on the request PATH, so `.select('*, residents(...)')`
on incidents or documents sails past it — the embed
rides in the query string. Those two are gated on
showMAR now. The remaining embeds are on mar_entries and
daily_logs, whose paths t22Fetch already blocks.

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

## checklist_items: read it before you insert

~119 rows, and `seedComplianceTasks` copies EVERY one of them into
`compliance_tasks` for each new facility, so the readiness score is
met-over-all-of-them. Two consequences:

- Adding a row adds a task to every facility created afterwards and lowers
  everyone's starting score. It is not a free change.
- A `where not exists (... c.title = v.title)` guard only stops a
  byte-identical title. On 2026-09-07 that let 16 restatements of existing
  items through ("Fire clearance current" versus "Your fire clearance is
  current and the drill log is up to date"); 2026-09-08's migration undid
  them. Read the existing titles before writing new ones.

`seedComplianceTasks` THROWS now, and `initFacility` self-heals a facility
with zero tasks. Both are deliberate: it used to read neither of its two
errors, so a facility that lost the race kept an empty compliance checklist
forever and onboarding walked on to the dashboard as if nothing happened.
There is one such facility in this database. The self-heal fires ONLY on zero
— topping up a facility merely missing newer items would silently add tasks
and drop the score of every existing customer, which is a decision, not a
repair.

Existing facilities do NOT pick up new items — seeding runs at onboarding
only. The backfill query is written out, commented, at the end of
`migrations/2026-09-07_title22_lic_checklist_items.sql`.

## An expired trial is read-only, not locked out

`t22ReadOnly` (index.html). Set only when the entitlement read SUCCEEDED and
came back expired — "trial ended" and "we could not check" are different
facts, and the second one still fails closed to `['billing']`. Four layers:

- `allowedTabs()` returns the role's own tabs, minus Tello (every question is
  a paid model call), plus billing.
- `canEdit`/`canDelete`/`canTeam` all return false.
- `t22Fetch` refuses every non-GET to `/rest/v1/<table>`, which catches the
  write paths that never asked `canEdit()`. RPCs are never blocked — several
  are the way OUT of this state (accepting an invite, re-checking
  entitlement) — and `events` still writes, so you can see who came back.
- `enforcePaidGate` no longer redirects them to #pricing.

The reason, so nobody "simplifies" it back: an expired trial used to see a
billing page and nothing else — not the readiness score they earned, not the
checklist they filled in, though all of it was still in the database. The
rational move for that person is to sign up again with a different address
and start over free, which is most of the 32 accounts and 49 facilities this
project accumulated. Nothing stops a second signup; what changed is that
staying is now worth more than starting over.

## Known open bugs

None outstanding in the app itself. Everything this list carried has been
checked against the code and was already fixed:

- **Mobile Safari modal scroll.** `.modal` has
  `-webkit-overflow-scrolling:touch` with `max-height:90vh/90dvh` and
  `overflow-y:auto`, and `.modal-overlay` scrolls too.
- **trial tier grants facilities:5.** It grants 2. Below the $79 tier's 5,
  enough to see what multiple facilities look like.
- **Password show/hide toggle.** Exists on all five password fields —
  `pw-field` / `togglePasswordField`.

Check before adding to this list again: three separate entries here described
code that had already been changed, which is worse than an empty list.

What is genuinely open is not a bug, it is a decision:

- **$29 or $79.** title-22.com says "One plan. $29 a month." The app still
  sells Multi-Home $79 (index.html, the pricing cards). Pick one.
- **The $29 path has never run end to end.** The webhook price map and
  welcomeIsPaid were fixed two days apart and never tested together against a
  real Stripe event.
- **49 test facilities across 32 accounts.** Guarded reset is written and
  dry-run ready: migrations/2026-09-08_title22_reset_test_facilities.sql.

And two entries that were never real in the first place: "users.paid never
flips" and "the users table's allow-all RLS policy exposes every customer
email". Both assumed `public.users` exists. It does not; the migration was never run. There is no
table, no policy and no exposure. The app no longer reads it either — see the
webhook section above. Do NOT create that table to "fix" this: it would be a
third store of who has paid, alongside profiles.title22_* and
public.subscriptions, and those two already disagree with each other often
enough.
