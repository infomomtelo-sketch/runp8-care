# Title22 System — No-PHI Lite — READ FIRST

Live Domains: title22.app (app) + title-22.com (marketing)
DB: Supabase project title22
- PHI PURGE COMPLETE: residents=0, medications=0, mar_entries=0, daily_logs=0
- incidents.resident_id = NULL (12 rows unlinked, keep for LIC 624)
- documents with resident_id = 0 already
- DO NOT repopulate those tables. DO NOT query them if showMAR=false.

App State:
- showMAR is a GETTER now, not a constant — false for every paying tier,
  true only for a Classroom account in the sample facility. See the
  "showMAR is not a constant any more" section.
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
`showMAR` is the switch, and it is not cosmetic. It reads false for every
paying tier — see the getter section above for the one exception:
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

Stripe wiring, as of 2026-09-08:

- Lite $29 — `prod_VDBXSXDdmtFrmh`, `price_1UCIAiAH9qPFLg89ln6eHAVa`. Payment
  Link live, webhook maps the price. Done.
- Multi-Home $79 — `prod_VDypF9WL2wmjGO`, `price_1UDWroAH9qPFLg89kAs9h49C`,
  Payment Link `https://buy.stripe.com/9B6fZg5U64gS17lfwag360m`. Wired
  2026-09-08. `STRIPE_MULTI` was `STRIPE_PRO` until then, so every Multi-Home
  sale went through the old $79 price and was recorded as `pro` — right money,
  legacy label, nothing on the new product.

  VERIFIED from the live link 2026-09-09, by screenshot: "Subscribe to
  Title22-Multi-Home", $79.00 per month, merchant title-22.com. Amount,
  interval, product name and merchant all correct. Still unverified: the
  link's metadata and its redirect, neither of which is visible on the
  checkout page. This environment's egress proxy blocks `buy.stripe.com`, so
  read them in the Stripe dashboard.

  The metadata matters MORE than usual right now, because the deployed Worker
  is the 2026-09-07 build and that build has never heard of this price — it
  was created the following day. A $79 checkout therefore falls through to the
  metadata, and if the link carries none, `planFromSubscription` returns null
  and the event is refused: charged, nothing written, "Free Trial". Exactly
  what happened to Lite on 2026-09-06.
- **Two $79 products exist in Stripe.** The old Pro product — no name, no
  description — alongside `Title22-Multi-Home`. That duplicate does NOT cause
  the webhook problem: what decides the outcome is the price ID on the
  subscription, and the live link charges the named Multi-Home product (seen
  on the checkout page 2026-09-09). The webhook problem is only that the
  deployed Worker predates that price.

  It is still worth clearing. The blank product name is what a customer reads
  on their receipt and their card statement, which is how a legitimate charge
  gets disputed. Archive the old $79 product in Stripe once no live
  subscription is still billing against it — check before archiving; existing
  Pro subscribers renew on that price.

  `pro` and `starter` have been REMOVED from `T22_PLAN_LINKS` for the same
  reason `agency` was: a checkout link is not a label, it is an offer one
  function call away, and `pro` pointed at that nameless product. Only `lite`
  and `multi` are sellable from the app now. Both stay in `STRIPE_PLANS`, so
  historic checkout events still resolve to a name.
- Agency — no price anywhere, and that now includes the code. The billing card
  is a `mailto:`, `planPrices` says "Contact Sales", the site shows no figure,
  and `agency` has been REMOVED from `T22_PLAN_LINKS`. It was still mapped to
  the $249 Payment Link: nothing called `openStripe('agency')`, so nobody was
  charged, but the one tier promised to have no price was a single function
  call from taking $249. `STRIPE_AGENCY` and its `STRIPE_PLANS` entry stay, so
  historic checkout events still resolve to a name.

Because `STRIPE_MULTI` was literally `STRIPE_PRO`, the two were the same key in
`STRIPE_PLANS` and one overwrote the other — a Multi-Home checkout recorded
itself as `pro` in analytics — or would have, had there been any: `public.events`
did not exist until 2026-09-10 (see the audit section), so nothing from that
period was ever recorded, and no query of it will show that mistake.
Both links are distinct now and `STRIPE_PLANS`
names `lite` and `multi` explicitly.

The plan key is `multi`, never `multi-home`. `TIER_LIMITS`, `T22_PAID` and
`T22_PLAN_LINKS` are all keyed on `multi`, so writing `multi-home` fails
`T22_PAID` (reads as unpaid) AND misses `TIER_LIMITS` (drops to
`{facilities:1, ai:false}` — one facility, no Tello, on an $79 plan). The
webhook now folds `multi-home`/`multi_home`/`multihome` to `multi` and refuses
any plan string outside `KNOWN_PLANS` rather than writing it, because
`planFromSubscription` used to pass Payment Link metadata through verbatim.

Both places must say the same thing, and for two days
they did not: title-22.com/pricing/ headlined "One plan.
$29 a month." while the app's billing tab offered Lite,
Multi-Home AND an Agency card priced at $249. The site
carries both tiers now, with Agency as a Contact Sales
row and no figure; the app's Agency card and planPrices
lost the $249. "No price" means no price in either
place.

## The app folds plan spellings on the way in

`t22NormalisePlan` (index.html), mirroring the Worker's `PLAN_ALIASES`.
Applied at all three reads: `readSubscription`'s dated and undated paths, and
`readEntitlement`'s `profiles.title22_plan`.

One tier has several spellings and the app is keyed on exactly one. Written
verbatim, "Multi-Home" misses `T22_PAID` (the subscriber reads as UNPAID) and
misses `TIER_LIMITS` (dropping them to `{facilities:1, ai:false}` — one
facility and no Tello, on the plan they just paid $79 for).

Belt and braces once the Worker is deployed, since it folds these too. Until
then it is the only thing between a Multi-Home customer and the same failure
Lite hit on 2026-09-06 — and it ships with a push, where the Worker needs a
token nobody has added yet.

KNOWN aliases only. An unrecognised plan passes through unchanged, so nothing
invalid is quietly made valid: `nonsense-plan` still reads as unpaid. Checked
across 17 inputs including case, underscores, spaces, padding, null, undefined
and empty.

## showMAR is not a constant any more

It is a getter (`t22MarAllowed`). False for every paying tier; true only for a
Classroom (`edu`) account standing in the sample facility, or while that
facility is being seeded. Three conditions, fails closed if any is unknown —
the entitlement read SUCCEEDED, the plan is `edu`, and the open facility IS
the sample. The facility check is the one that matters: `edu` also grants a
real facility of its own, and the MAR stays off there.

It is one getter rather than fifty edited call sites because every path that
asks "is there a MAR here" — the tab list, the fetch guard, the dashboard
card, the DSS export, Tello's context, the tour — has to answer the same way
at the same moment. `seedDemoData` is the exception and keys on the plan
directly, because it runs before the sample facility exists.

The classroom roster is FIXED: eight seeded residents, `t22RosterFixed()`
refuses add, edit and delete at the function, and the buttons are hidden.
That is what makes it safe — there is no field to type a real name into.
Written up in `docs/classroom-practice-mar.md`.

DO NOT run `migrations/2026-09-06_title22_lite_drop_phi.sql`. It revokes the
grants at the database level and breaks every classroom.

## PHI line — do not cross
Lite holds no resident health information at all: no
resident records, no medications, no MAR, no LIC 601 or
LIC 602A. The one exception is a Classroom account in the
sample facility — eight invented residents and a practice
MAR, roster fixed, see the section above. No real
person's data is in it and none can be added. Do not add one back without a decision about
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
not name a resident in the description.

`t22PhiScan` / `t22PhiBlock` refuse a save containing an
SSN, email, phone number, MRN, or an explicit date-of-
birth or insurance-number marker. Wired into incidents,
checklist notes, and the Tello query box — that last one
matters most, because it is the only free text that
leaves the database at all.

IDENTIFIERS ONLY. It does not detect names, on purpose.
The first version did: two capitalised words in a row
caught "Betty Alvarez" and also "Fire Drill", a Title 22
term, on a Title 22 compliance app. The shapes are
identical and no word list fixes it — the list only moves
which legitimate phrase gets refused next, and a guard
that cries wolf on the customer's own vocabulary teaches
people to route around it. Dates are not matched either:
"Fell on 09/08 at 06:40" is how an incident is written.

Do not add name detection back without a corpus showing
zero false positives on real narratives. Say plainly what
this is: No PHI is ENFORCED in the schema — there is
nowhere to put a resident record — and ASKED FOR in free
text.

Reads must not embed residents either. t22Fetch matches
on the request PATH, so `.select('*, residents(...)')`
on incidents or documents sails past it — the embed
rides in the query string. Those two are gated on
showMAR now. The remaining embeds are on mar_entries and
daily_logs, whose paths t22Fetch already blocks.

## Tello has a chat dock now, inside the app only

`mountTelloDock()` builds a floating button and panel as children of
`#page-app`, called from `initFacility` after `showPage('app')` and after the
`applyRoleUI()` that runs `applyLiteMode`. Being a child of `#page-app` is the
whole hiding mechanism: `.page{display:none}` takes it off the landing page,
onboarding, pricing and the signed-out state for free, and no screen added
later has to remember to hide it. `clearSession` removes it from the DOM
outright rather than leaving a conversation in the page for the next person at
that browser.

Who gets it is read from `allowedTabs().includes('ai')`, not from a second
rule that could drift — so an expired trial loses the dock exactly as it loses
the Tello tab, and demo mode never gets it (the sandbox answers from a canned
path).

**The dock is No-PHI unconditionally, including in a classroom.** It sends
`buildFacilityContext({noPhi:true})` — a new option that forces the Lite shape
even where `showMAR` is true — and `TELLO_DOCK_RULES` forbids outputting a
resident name, a LIC 601, a LIC 602A, a MAR, an ISP, a diagnosis or a dosage.
Without the option an `edu` account's practice roster would be sent to a model
that had just been told never to say a name. The Tello TAB is unchanged and
keeps the full context: that is the surface a classroom uses.

It is passed `{facilityId, plan, showMAR, isSample}`, and `showMAR` is sent as
`false` always, because this surface does not get the MAR whatever the account
is entitled to. History is per facility (`title22_tello_dock_<facilityId>`,
capped at 20 messages): switching facility is a different conversation, since a
compliance answer about one home is wrong for another. The input goes through
`t22PhiBlock` like the Tello tab's — those two boxes are the only free text
that leaves the database.

## Launch Hub — the "Start Your Home" tab

`#tab-launch`, `nav-launch`/`menu-launch`, rendered from `LAUNCH_CARDS` by
`renderLaunchHub()`. Twelve steps in three cards — Get Certified / Prep House /
Get License — for the customer who has not opened yet. Until this existed the
app had nothing for them until the day they held a licence, which is a large
share of who signs up.

Three rules it is built on, and none is decoration:

- **No PHI, and no path to any.** Every step is about the applicant, the
  building or the licence. No resident field, no medical document, no free text
  at all. That is why `launch` is NOT in `T22_PHI_TABS` and why `applyLiteMode`
  does not touch it — verified in the browser: in Lite, `nav-launch` and
  `menu-launch` are visible while `nav-mar` is not. If a step is ever added
  that names a resident or a medical document, delete the step; do not start
  hiding the tab.
- **It states no requirement as fact.** Same rule as `DOC_SLOT_HOWTO` and
  Tello's prompt: each step says what the thing IS and who issues it, never how
  long it takes, how long it lasts, what it costs, or what an inspector
  accepts. The page opens by saying so, in both languages.
- **Nobody types.** Every step is answered with a 56px button or a photograph
  (`capture="environment"`, so a phone opens the camera). English title with a
  Tagalog line under it on all three cards and all twelve steps. One card open
  at a time.

Photos go to the existing `facility-documents` bucket under the same
`<facility_id>/<uuid>.<ext>` path as every other upload, and are NOT written to
`documents` — a house photo has no business in the compliance file list or the
DSS export.

Storage is `public.launch_checklist`
(`migrations/2026-09-09_title22_launch_checklist.sql`), one row per facility
per step. **Until that migration is run the tab still works**: `loadLaunchHub`
recognises PGRST205/42P01, falls back to this browser's localStorage, and says
on the page that progress is device-only and which file to run. That is the
direct lesson of `public.users` — code that assumed a migration had run, for
two days, in silence. The two stores are sequenced, never both.

**And `2026-08-13b_title22_facility_capabilities.sql` has never been run
either.** The first version of the launch migration called
`public.title22_current_facility_role()` in its policies and was refused with
`ERROR 42883: function ... does not exist` — the same fault as `public.users`,
found twice in one week. That migration file now installs the function itself,
copied verbatim from 2026-08-13b under `create or replace`, so applying
2026-08-13b later is a no-op for it and still installs its second function.
Assume nothing in `migrations/` has been applied unless you have watched it
run or checked the database.

Checking it is one paste now: `migrations/2026-09-10_title22_migration_audit.sql`
is read-only and reports applied/not for all 25 migrations that create
something, from a sentinel object each one leaves behind. Six files are
excluded and named there because "applied" is not a question they answer —
four check scripts whose statements are commented on purpose, the guarded
test-facility reset, and `lite_drop_phi`, which must never be run.

Its sentinels are picked so one migration cannot vouch for another: 2026-08-13b
is checked by `title22_has_capability`, NOT `title22_current_facility_role`,
because 2026-09-09 installs that second function itself and would otherwise
report 08-13b as applied when it is not.

Verified by running it against a local Postgres 16 with a stub `auth.uid()`,
not by reading it: it applies clean, and re-running it, then applying
2026-08-13b on top, leaves 4 policies and the existing rows untouched. The
owner — who is `facilities.user_id` and is NOT necessarily a row in
`facility_members`, which is exactly the solo operator this tab is for — can
upsert; a supervisor can; a caregiver reads and is refused a write; a stranger
and a signed-out session read nothing.

Roles: administrator and supervisor (they can edit), plus `DEMO_TABS` so the
sandbox shows it. An expired trial keeps the tab and loses the buttons, like
everywhere else — `canEdit()` disables them and `t22Fetch` refuses the write
underneath.

## What the migration audit found (2026-09-10)

Run of `migrations/2026-09-10_title22_migration_audit.sql` against the live
database. 21 of 25 applied. The four that were not, and what each actually
costs:

- **`2026-08-07_title22_events.sql` — was NOT applied. APPLIED 2026-09-10.**
  This was the one that mattered. `track()` writes to it from 19 call sites and
  swallows the rejection by design (`.then(()=>{},()=>{})`, "analytics must
  never surface to the user"), so from 2026-08-07 until 2026-09-10 every event
  was discarded silently — no analytics data at all, not a partial record.
  Nothing in the app reads the table, so nothing was visibly broken, which is
  exactly why it went a month unnoticed.

  Two things follow and neither goes away. **The record starts 2026-09-10** —
  nothing was buffered, those events are gone, so any question about usage
  before that date has no data behind it. And `profiles.title22_utm_source`
  from `2026-07-23_funnel_columns` has been populated all along but had no
  `events` row to join against, so the funnel only becomes answerable from now.

  The general lesson is the one that cost the month: an error handler written
  to never surface is also an error handler that can never tell you the table
  is missing. `track()` keeps its silence deliberately — analytics must not
  break a save — so the check on it is this audit, not the console.
- **`2026-08-13_title22_profile_photo_url.sql` — NOT applied, and dead.**
  `photo_url` appears nowhere in the repo outside that file. Nothing to fix;
  do not run it to tidy the audit.
- **`2026-08-13b_title22_facility_capabilities.sql` — NOT applied, and
  half-moot.** `title22_has_capability` is called nowhere. Its other function,
  `title22_current_facility_role`, IS in the database because the Launch Hub
  migration installs it. Nothing to fix.
- **`2026-09-06_title22_lite_users.sql` — NOT applied, and must stay that
  way.** Expected. Do not create `public.users`.

Every RPC the app calls resolves: `title22_member_entitlement`,
`title22_accept_my_invite`, `title22_redeem_invite`,
`title22_grant_classroom_account`, `title22_check_trainer_code`,
`title22_create_trainer`, `title22_trainer_signups` — all present, and the
last one's body carries the edu exclusion. The entitlement path, which is
where both earlier silent failures lived, is intact.

**A sentinel bug worth remembering.** The first run reported
`2026-09-07_lic_checklist_items` as NOT applied. It ran. Its sentinel was one
of the 16 titles that `2026-09-08`'s dedupe deliberately DELETED as
restatements — so on a correctly maintained database that check can only ever
read false, and acting on it would mean re-running 09-07, re-adding 16
restatements and dropping the starting readiness score of every facility made
afterwards. The sentinel is now the LIC 508 row, one of the four of 09-07's 20
that survived the dedupe and one of the three unique to it. Re-run with that
sentinel: **true** — 09-07 is applied, as is 09-08. Both checklist migrations
are settled and neither should be re-run.

A migration whose effect a later migration intentionally reverses cannot be
audited by its own output; pick something durable, or exclude it.

That was the whole audit. Its one action — running
`migrations/2026-08-07_title22_events.sql` — was done on 2026-09-10, so nothing
is outstanding from it.

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

## applyLiteMode runs at LOAD, and both ways

Called from applyRoleUI as before, and once more at the bottom of the script.
applyRoleUI only runs after a facility is initialised, so the zero-facility
path — a brand-new account going straight to onboarding — never reached it,
and the first screen of the first session offered MAR, Medications, Daily log
and Residents in the menu.

Because it now runs before the entitlement is resolved, and because showMAR is
a getter rather than a const, every element it touches is set from the flag in
BOTH directions. Hiding on the way in and returning early on the way out would
strand a Classroom account's MAR hidden for good: at load showMAR is false, so
the entries get hidden, and the early return means turning showMAR on later
never puts them back.

Verified in all four states: load with nothing resolved (hidden, fails
closed), a brand-new Lite account on onboarding (hidden — the screenshot
path), edu standing in the sample facility (restored), and the same trainer
switching to their own real facility (hidden again).

No flash, and the reason is worth keeping: `#page-app` is `.page{display:none}`
until showPage('app'), and `#user-menu` carries inline `display:none`, so
nothing PHI is painted before the load-time call runs. Sampled every animation
frame from document-start for 3.5s — zero frames with a PHI nav entry, menu
entry, dashboard MAR card or add-resident button visible. Do not make either
container visible by default without re-checking this.

### And none of it depends on the script running at all

`<body class="t22-no-phi">` ships in the markup, and CSS hides the four nav
entries, the four menu entries, the dashboard MAR card and the Add-resident
action while it is there. `applyLiteMode` only toggles the class.

Because the load-time call was not enough. `applyLiteMode` is defined ~1500
lines BELOW `supabase.createClient`, and if `/vendor/supabase-js-2.110.5.min.js`
does not load — a bad deploy, a cache miss, a phone that dropped the request —
the script throws there and every line after it never runs. What the customer
is left looking at is the menu as it ships in the HTML: MAR, Medications,
Daily log, Residents. Reproduced by aborting that one request: before this,
all ten elements visible; after, none.

`!important` because those elements carry `display` in their own style
attribute. The class is also why the restore path stopped setting
`style.display=''` — a menu button ships `display:flex` inline, and clearing
the property took the flex with it, so a Classroom account got its MAR back
with the icon and label unaligned. Dropping the class restores each element's
own display instead of a value guessed in JavaScript.

Verified in four states: vendor bundle aborted (hidden), normal Lite load
(hidden), edu in the sample facility (restored), edu on their own real
facility (hidden again).

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

Settled since: **$29 or $79** was open because title-22.com headlined "One
plan. $29 a month." while the app sold both. Both surfaces now sell both, with
Agency as Contact Sales and no figure anywhere — title-22-site 8838ba9,
index.html c089c60. The classroom MAR was approved by Eli on 2026-09-09; it is
a decision that was taken, not an open question.

What is genuinely open:

- **The $29 path has never run end to end.** The webhook price map and
  welcomeIsPaid were fixed two days apart and never tested together against a
  real Stripe event. Two failures found by reading it on 2026-09-08 and fixed
  below, but neither has met a real Stripe event either — this stays open
  until one does.
- **49 test facilities across 32 accounts.** Guarded reset is written and
  dry-run ready: migrations/2026-09-08_title22_reset_test_facilities.sql.

## Why a paid account said "Free Trial" through every refresh (2026-09-08)

Two independent faults, either of which alone is survivable and which together
charged a card and showed the customer a trial:

1. **`ensureProfile` stamped `title22_plan='trial'` on a paying account.** It
   only ever asked whether the column was null, and null is exactly what a
   customer who paid *before* they signed up has: the webhook PATCHes
   `profiles?id=eq.<uid>`, and a PATCH matching no row returns 200 having
   written nothing. So the plan never landed, the app stamped 'trial' over it
   on first login, and stamped it permanently. `planToStamp()` now asks
   `subscriptions` first and stamps the paid plan (and no trial end date)
   instead.
2. **Every row the webhook wrote was undated.** Stripe's 2025-03-31 API
   version moved `current_period_end` off the subscription object onto its
   items; the worker read only the root, so `periodEnd` was null on every
   event from a current API version — and `readSubscription` discarded undated
   rows by design. `periodEndOf()` in the worker reads the items as a
   fallback, and `readSubscription` now reports an undated paid row rather
   than dropping it.

The app-side half heals accounts that are already broken with no redeploy.

The worker half IS DEPLOYED. Run #8 of the GitHub workflow succeeded at
2026-09-09T01:46Z against commit 539ed01, and run #9 at 18:50Z against
3125a0b; `workers/stripe-webhook/` has not changed between them, so both
carry the same code. Live in production: the Multi-Home price
`price_1UDWroAH9qPFLg89kAs9h49C`, `periodEndOf()`'s current_period_end
fallback, and the plan folding.

CHECK THE ACTIONS HISTORY BEFORE SAYING OTHERWISE. This file claimed for a
day that the Worker "has not been deployed" and that the CLOUDFLARE_API_TOKEN
secret "does not exist yet". Both were false the moment run #8 went green, and
the claim was repeated to Eli three times — who then spent an evening creating
a Cloudflare token he already had. One API call answers it:
`actions_list / list_workflow_runs` on `deploy-stripe-webhook.yml`.

Confirmed against Cloudflare 2026-09-08: the Worker `stripe-webhook` exists on
account `701117dde6af00d42bac3c4058b660be`, workers.dev route enabled, all four
bindings present (`SUPABASE_URL` is a plain-text var, the other three are
secrets), and `wrangler deploy` does not touch them. Its last deploy was
2026-09-07, version `9af47f8e-2b66-4c74-aa17-f890aca4e9ef`, source
`quick_editor` — the DASHBOARD. Every deploy of this Worker has been a paste;
none has come from this repo. Do not repeat the claim that it was deployed
from `stripe-webhook/index.js`.

Deploying no longer needs a machine with wrangler on it: GitHub -> Actions ->
"Deploy stripe-webhook Worker" -> Run workflow
(`.github/workflows/deploy-stripe-webhook.yml`). It is manual-only on purpose
— this Worker is what turns a payment into a paid account, so a deploy should
not ride along with an unrelated merge. The repository secret `CLOUDFLARE_API_TOKEN` is ALREADY SET — runs #8 and #9
both authenticated with it. The Worker's own secrets are untouched by a
deploy; never put them in the workflow.

The workflow can be triggered from a Claude session: the GitHub MCP's
`actions_run_trigger` / `run_workflow` on `deploy-stripe-webhook.yml`, ref
`main`, then `actions_get / get_workflow_run` for the conclusion. Creating the
Cloudflare token and adding the secret cannot be — those authenticate as a
person — but the deploy itself does not need a human.

### The secret names, in full (verified 2026-09-09)

Read out of the workflow file and written into its header comment, because a
secret added under a name nothing reads is invisible: the job does not warn
about it, it behaves exactly as though no secret exists.

- `CLOUDFLARE_API_TOKEN` — the ONLY repository secret the workflow reads. Three
  reads: the emptiness check, the `deploy --dry-run` step, the `deploy` step.
- There is NO `CLOUDFLARE_ACCOUNT_ID` secret, and nothing would read one. The
  account is the plain-text `CF_ACCOUNT_ID` env var
  (`701117dde6af00d42bac3c4058b660be`), deliberately not a secret. A repository
  secret of that name is harmless and unused; it can be deleted.
- A near-miss name (`CF_API_TOKEN`, `CLOUDFLARE_TOKEN`, `CLOUDFLARE_API_KEY`)
  surfaces as "CLOUDFLARE_API_TOKEN is not set", never as anything naming the
  spelling that was actually used.

And the secret is not in doubt: run #9 (2026-09-09T18:50Z, `3125a0b`) passed
its "Check the token is set" step and every step after it, Deploy included. So
did run #8. `workers/stripe-webhook/` has not changed since `3125a0b`, so the
Worker running in production IS this repo's build, and the Multi-Home price
`price_1UDWroAH9qPFLg89kAs9h49C`, `PLAN_ALIASES` and `periodEndOf()` are all
live. A Multi-Home sale today records as `multi`, NOT as `pro`.

`readEntitlement` still reads `profiles` and must keep reading it — it is the
only store that carries the trial, the edu tier, and subscribers who predate
`public.subscriptions`. What changed is that an undated paid subscription now
wins over the word "trial", and only over that word: it does not override edu,
a paid plan, or a cancelled plan past its period end. 15 branch cases were run
against the rewritten function, including every one of those.

And two entries that were never real in the first place: "users.paid never
flips" and "the users table's allow-all RLS policy exposes every customer
email". Both assumed `public.users` exists. It does not; the migration was never run. There is no
table, no policy and no exposure. The app no longer reads it either — see the
webhook section above. Do NOT create that table to "fix" this: it would be a
third store of who has paid, alongside profiles.title22_* and
public.subscriptions, and those two already disagree with each other often
enough.
