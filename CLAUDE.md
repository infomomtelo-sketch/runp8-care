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
  `price_1UClAiAH9qPFLg89ln6eHAVa` → `lite` (the missing entry that charged a
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

## title22.app stopped publishing for two days (2026-09-25 → 27)

The Cloudflare Pages project `runp8-care` (and very likely `title-22-site`)
became **disconnected from GitHub** after the last good deploy, `3be5dd1` on
2026-09-25 19:55 UTC. Every merge after that — #137, #139, #140, including the
Lite copy fixes, the starter-lesson guard and the briefing voice — sat on
`main` and never reached title22.app, with nothing anywhere saying so. The
Workers were unaffected: they deploy through GitHub Actions, not Pages.

Found from GitHub, not Cloudflare: every merge to `main` up to 3be5dd1 carries
a **"Cloudflare Pages"** check run; the three after it have none. The dashboard
showed "This project is disconnected from your Git account". The owner
reconnected it on 2026-09-27. "Retry deployment" on the old entry only
republishes the old commit — a fresh push to `main` is what builds the new one.

**After any merge to `main`, confirm the merge commit gets a "Cloudflare Pages"
check** (`GET /repos/infomomtelo-sketch/runp8-care/commits/<sha>/check-runs`).
No check within a few minutes means nothing was published, whatever the PR
says. This environment's egress blocks title22.app itself, so that check is the
only way to verify a deploy from here.

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

- Lite $29 — `prod_VDBXSXDdmtFrmh`, `price_1UClAiAH9qPFLg89ln6eHAVa`. Payment
  Link live, webhook maps the price. Done.
- Multi-Home $79 — `prod_VDypF9WL2wmjGO`, `price_1UDWroAH9qPFLg89kAs9h49C`,
  Payment Link `https://buy.stripe.com/9B6fZg5U64gS17lfwag360m`. Wired
  2026-09-08. `STRIPE_MULTI` was `STRIPE_PRO` until then, so every Multi-Home
  sale went through the old $79 price and was recorded as `pro` — right money,
  legacy label, nothing on the new product.

  VERIFIED from the live link 2026-09-09, by screenshot: "Subscribe to
  Title22-Multi-Home", $79.00 per month, merchant title-22.com. Amount,
  interval, product name and merchant all correct. The link's redirect is
  set too: both Payment Links return to `https://title22.app#welcome`
  (reported by the owner 2026-09-30; see "the post-payment redirect" below).

  **The metadata does NOT matter, and the paragraph that used to stand here
  saying otherwise was wrong.** It said the deployed Worker was the 2026-09-07
  build, had never heard of this price, and that a $79 checkout would fall
  through to metadata and end as "charged, nothing written, Free Trial". That
  stopped being true the moment run #8 went green on 2026-09-09. Re-checked
  2026-09-10: `PRICE_PLANS` in `workers/stripe-webhook/index.js` maps
  `price_1UDWroAH9qPFLg89kAs9h49C` → `multi-home`, `normalisePlan` folds that
  to `multi`, and `planFromSubscription` resolves the price directly, never
  reaching the metadata fallback. (This paragraph said `workers/stripe-webhook/`
  was byte-identical to the deployed commit `3125a0b`. It was, for four days.
  Run #10 on 2026-09-13 deployed `320bba8`, version
  `519d0666-28bd-4cc8-9a34-531d971d2480` — which is the point this whole entry
  is making, arriving faster than expected.)

  **A Multi-Home sale today records as `multi`, correctly.** Every fault that
  did break $79 — `STRIPE_MULTI` still pointing at the old Pro link, the
  `multi-home` key missing `T22_PAID` and `TIER_LIMITS`, the price missing from
  the Worker — is fixed and deployed. What remains is the duplicate product
  below, which is a receipt problem, not a webhook one.

  This paragraph is the third time this file has frightened someone with a
  deploy claim that was already stale — see the Worker section's "CHECK THE
  ACTIONS HISTORY BEFORE SAYING OTHERWISE". A statement about what is deployed
  has a shelf life of one deploy. Date it, or check it before repeating it.
- **Two $79 products exist in Stripe.** The old Pro product — no name, no
  description — alongside `Title22-Multi-Home`. That duplicate does NOT cause
  the webhook problem: what decides the outcome is the price ID on the
  subscription, and the live link charges the named Multi-Home product (seen
  on the checkout page 2026-09-09). The deployed Worker has mapped that price
  since run #8, so there is no PRICE problem left — which is all this bullet
  ever claimed. It is not a claim that the webhook is healthy in general: on
  2026-09-13 it returned 500 to every event it handles, for a reason that had
  nothing to do with any price. See "How the $29 path actually failed".

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
- **Two Map bundles exist in Stripe and they are NOT Title22.** `Lite + Map
  Bundle` $99 (`price_1UEHzFAH9qPFLg89BoNbAPm9`) and `Multi-Home + Map Bundle`
  $149 (`price_1UEIVpAH9qPFLg89qOs5pvRg`), both created 2026-09-11. They belong
  to a different build; Eli confirmed it on 2026-09-14.

  Recorded here so nobody rediscovers them and "fixes" them. On 2026-09-14 they
  were briefly mapped to `lite` and `multi` on the assumption that they were
  Title22 tiers with an add-on — the names mirror the Title22 tiers exactly, and
  both carry the same $70 delta over the matching plan, which is a persuasive
  coincidence and nothing more. **Do not map them.** Doing so hands a Title22
  account to somebody who bought a different product, which is the mirror image
  of the bug this whole section is about.

  **The real problem they exposed is the Stripe account, not the bundles.** It
  is shared across several businesses — 85 products, including Postpilots,
  Rekey Locks, TV Mount, Smart Lock Install and the rest — and a Stripe webhook
  endpoint subscribes to event TYPES, not to products. So `memorable-wonder`
  receives `customer.subscription.created` for every one of them. Each arrives
  at a Worker that cannot name its price and answers 422, or cannot match a
  user and answers 409 with three days of retries.

  That is permanent expected red in the delivery log, and it is not cosmetic: a
  log that always has red in it is a log nobody reads, which is precisely how
  the 2026-09-13 outage survived four days in plain sight. The fix is to teach
  the Worker "this is not a Title22 product at all" (200, acknowledged, dropped)
  apart from "this IS a Title22 product whose price we failed to map" (422,
  loud). That needs the full list of Title22 `prod_` ids. Two are known —
  `prod_VDBXSXDdmtFrmh` and `prod_VDypF9WL2wmjGO`; the legacy tiers' products
  are not. Not built yet.

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

Belt and braces, not the last line of defence. The Worker has folded these
since run #8 on 2026-09-09, so both ends now agree. The sentence that stood
here — that this was "the only thing between a Multi-Home customer and the
same failure Lite hit", because "the Worker needs a token nobody has added
yet" — was stale on both counts: `CLOUDFLARE_API_TOKEN` was already set and
runs #8 and #9 authenticated with it.

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
records, not PHI. Scan is on for the certificates and OFF
for TB — see "Scan to fill" below.
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

## Scan to fill: staff certificates only, one field set each (2026-09-29)

The owner's decision: scan is back on for five staff slots — CPR, First Aid,
Live Scan, Mandated Reporter, training certificate — and stays off for TB. A
TB result is the employee's own medical information (California's CMIA), so
its two dates are typed and the signed paper stays in the staff file. Resident
and medication scans stay off with no switch to turn them on.

"Accurate to field": each scan reads and fills ONLY its own slot's fields.
`SCAN_DOC_FIELDS` (index.html) and `STAFF_DOCS` (workers/title22-extract) are
the same list and must stay in step. A CPR scan asks the model for the CPR
dates and nothing else; the prompt and the output schema name only those.

- Enforced in both places. The app: the Scan button only on those five slots,
  `startScan` refuses anything else, the review shows only the slot's rows,
  `applyScanToForm` fills only those keys, and "File as" offers only that
  slot. The Worker: 403 for resident, medication and `tb_test`, 400 for a
  staff scan with no slot, all before the credit check and before any call.
- The name printed on the card is read on every scan and shown beside the
  staff record's name ("Matches" / "Check it is this person's card"). It is
  never filled. A card filed on the wrong person is the one mistake a date
  check cannot catch.
- The staff modal's whole-page "Scan to fill" stays commented out: a whole
  staff file includes TB.
- The Worker also meters `lite` and `multi` properly now. They were missing
  from its LIMITS, so a Lite customer was counted as a trial (50) and told to
  "Upgrade to Pro".
- Deploys by `.github/workflows/deploy-title22-extract.yml` (manual). The live
  script is `mission-control`; every earlier deploy was a dashboard paste, so
  `wrangler.toml` sets `keep_vars = true` to keep whatever vars the dashboard
  holds (the stripe-webhook lesson). The workflow reads `/health` afterwards
  and fails unless it says ok and lists `scannable`.
- Tests: `node workers/title22-extract/test.mjs` (49 checks, fetch mocked).

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

### Tello's setup guide in the dock (2026-09-29)

The owner: "Tello should be visible when a user subscribes, helping them start
setting up the home". On a real (non-sample) home with setup left, the dock
opens BY ITSELF once per home per browser (`maybeOpenTelloGuide`, from
`initFacility`), after the first-visit menu has closed and with no form open.
It shows three steps, ticked from what is actually recorded
(`telloGuideSteps`):
1. **Staff:** `staffList` has a row.
2. **Staff certificates:** a document filed against a staff member. This
   step names Scan to fill and links to the 1-minute video.
3. **The home's own documents:** a document filed against no one.

While steps are left and the dock is closed, a "Let's set up your home. N
steps left" bubble (`#td-nudge`) sits beside Tello's button. "Hide these
steps" turns it off for that home.

- Written in the page: no AI call and nothing sent.
- Not shown on the practice home or in the sandbox.
- Like everything Tello says, it describes what the app does, never what DSS
  requires.
- `renderStaff` and `renderDocuments` call `telloGuideRefresh`, so the ticks
  follow the data as it loads.

## Tello's own page and partner mode (2026-09-27)

title22.app/tello (`tello.html`) talks to `/api/tello/*` on `title22-ai`
(`workers/title22-ai/tello.js`). Tello is the core; Title22 is the first
business plugged into her (`TELLO_CLIENTS`). Rules:

- **The server decides who she is.** The page sends only `{message}`. Partner
  mode = the signed-in user id is in `public.tello_founders` (service-role
  only). Never add a button, URL flag or request field that changes the mode.
- **Partner instructions are private and NOT in git** (this repo is public):
  `public.tello_private`, loaded by a SQL paste the owner keeps.
- **Partner mode sees, it does not act.** `business_snapshot` is read-only and
  counts only. Do not give it a write tool.
- Her memory works again. The owner's 2026-08-26 edit to `tello.html` dropped
  the line that saved messages; the Worker now writes memory itself.
- Customer-mode knowledge is `tello/title22-knowledge.js`, the owner's file —
  edit there, not in the page.
- **The screen is the conversation; everything else is in the Cabinet**
  (2026-09-27, the owner's ask: "too many words"). One `#cab-btn` in the bar
  opens a right-hand drawer holding the brief, live numbers, tools, New
  conversation, Memory, Sign out, the plan chip and the full disclaimer. A
  gold dot on the button means a brief arrived. Do not put cards, tool grids
  or links back on the main screen.
  Two exceptions. `#new-btn`, New conversation, in the bar beside the
  Cabinet (2026-09-29: the owner could not find it in the drawer); for a
  guest it clears the tab's chat. And `#voice-bar`, above the box: it shows only while she
  is reading the brief aloud, paused, or waiting for the tap an iPhone needs
  ("Tello has your brief ready · Listen"), with Pause/Resume and a stop.
  She reads the brief once per day per brief kind (`maybeAutoplay`).
- **The owner's Cabinet is sorted (partner only, 2026-10-05; the owner:
  "every item looks identical").** `buildOwnerCabinet` / `OSECS` in
  `tello.html` fold the tools and drawers into seven sections (Today, Write,
  Post, Decide, Partners, Share, Memory), one open at a time, each with its
  own icon and accent. Every item carries a tag (Ask / Write / Open / Watch /
  Link), shows its hint only when tapped, and has a star that pins it to My
  shortcuts (up to 4). The open section and the pins are in localStorage
  (`tello_cab_section`, `tello_cab_pins`), this phone only. A tool still
  goes through `runTool()` unchanged, and a drawer is the same `<details>`
  moved, so what each item sends did not change. A tool no section names
  shows under "More" rather than vanishing. Guests and customers keep
  `#drawer-tools`, unchanged.
- **Share kit and partner messages (2026-10-05).** Under "Give out a new
  code" in Codes and payouts: four links (from `MKT.links`) and the videos
  (from `MKT.videos`) as tiles that play in place. Every code card has Kit
  (`partner-kit/?code=`) and Copy message. `ptnMessage(p)` is the ONE
  partner message, built from the code's saved commission and trial, and
  used after Create code too, so an edited rate shows. Keep "When you share
  it, say that you earn a commission" in it. The app's Partners tab
  (index.html `createTrainerCode`) has its own, different message.
- **Talk mode (partner only, 2026-09-28).** The mic button (`#talk-btn`,
  `talkStart`/`talkListen`/`talkSpeak`) listens with the browser's speech
  recognition (Apple's dictation on an iPhone, Google's in Chrome), sends the
  words through the same PHI check as typing with `spoken:true`, and reads the
  reply aloud in her Kokoro voice, then listens again; two silent turns end
  it. `spoken:true` adds `SPOKEN` (2 to 4 sentences) and a `low` effort. It is
  a style, not a mode. Customers do not get the mic: their speech would go to
  Apple or Google before our PHI check sees it. The voice Worker's
  `DAILY_LIMIT` went 10 → 150 for this (about 15 cents a user a day at most).
- **The brief is voiced in pieces (2026-09-29, the owner: "takes a while
  before talking").** It used to be ONE voice request for the greeting and the
  whole brief, and nothing played until the whole MP3 was made (4 s of silence
  in the test, more on a long brief). Now:
  - Every line is its own request, all sent at once. She starts on the short
    greeting and each next piece is ready by the time she gets to it.
  - On the dashboard, the greeting is voiced while the AI is still writing the
    briefing (`telloVoicePrefetchGreeting`). There she starts 0.06 s after the
    text appears, and each line lights up exactly as she reads it.
  - `telloVoicePieces` in index.html, `vPieces` in tello.html.
  - Costs about 4-6 voice renders per new brief instead of 1, well inside
    `DAILY_LIMIT` = 150. A replay hits the Worker's cache and counts nothing.
- **Play on every answer that is short enough to hear** (`SPEAK_MAX` = 900
  characters, `playReply`), for customers and partner alike; tap again to
  stop. A longer answer is for reading: no Play button, and in Talk mode it
  stays on the screen, is not spoken, and the mic stops until tapped again.
- **Marketing drawer in the Cabinet (partner only, 2026-09-28)**, `MKT` and
  `renderMarketing` in `tello.html`: his four social accounts (same URLs as
  title-22-site `assets/follow.js`), ready messages (Share / Copy / Text /
  Email), links to send, the shareable videos, and "Write a new one with
  Tello". Every fact in it is one the site already states: change a price, a
  trial length or an account there and here together. Tello cannot sign in to
  or post on any account; Share hands the text to the phone's share sheet.
- **Partners and payouts drawer (partner only, 2026-09-28)**, `loadPartners`
  / `renderPartners` in `tello.html`, on
  `migrations/2026-09-28_title22_partner_payouts.sql` (NOT RUN until the owner
  says so; the drawer says which file to run if it is missing). The owner's
  own buttons, not a Tello tool: codes (create with type trainer / affiliate /
  graduate, pause, rate, trial never under 30), students per code as date and
  status only (no names, no emails), this month's commission at list price x
  rate on active subscriptions in our table (not Stripe), and a payout record
  (one per partner per month; delete only a mistake). Nothing here moves
  money. Every RPC checks `title22_is_partner_admin`. Classroom access sits
  there too, via the existing `title22_grant_classroom_account`.
- **No sign-up needed (2026-09-29, the owner: no pressure on visitors).** A
  visitor who is not signed in lands in the chat, not the gate
  (`guestStart`), and talks to Tello through the PUBLIC assistant endpoint
  (`/api/assistant/chat`, assistant `tello`, in `workers/title22-ai/assistant.js`): same
  rules and daily limits, nothing stored on the server, the chat in
  sessionStorage. The Cabinet offers "Send to Title22" (a lead) and "Sign in
  to keep your conversations" (the gate, with "Not now"). Guests get no Play
  (the Kokoro voice needs an account), no photos, no memory, no mic. This is
  NOT a mode switch on `/api/tello`: that endpoint still decides who she is
  from the signed-in account alone.
- The comment on line 2 of `tello.html` is the owner's and private. Never
  surface it in any UI or copy, and do not repeat it anywhere else.

## Partner Tello: title22.app/meet (2026-10-01)

A second Tello for partners and people interested in Title22 (trainers,
consultants, training companies). Replaced Charrise: `charrise.html` and
the `title22` (Charrise) entry in `assistant.js` were deleted on 2026-10-01.
Her table `assistant_leads` was empty when checked that day and is kept as
is, as is `migrations/2026-09-29_title22_assistant_charrise.sql`. The
"Charrise ·" label in `tello.html`'s Leads drawer is a separate follow-up.

Everything is named `partner_tello`: `partner_tello.html` (served at /meet
by `_redirects`), `partner_tello-icon.svg`, `workers/partner_tello/` (the
Worker is `partner-tello`, since Cloudflare names cannot hold `_`; routes
`/api/partner_tello/*`), `migrations/2026-10-01_partner_tello.sql`
(tables `partner_tello_links`, `_messages`, `_usage`, `_config`), and the
workflows `deploy-partner-tello.yml` and `partner-tello-live-test.yml`.

- **Kept apart from App Tello.** Nothing in index.html, tello.html or
  title22-ai changed for it, and nothing there reads its tables. It never sees
  a facility, staff member, document or user: the Worker has NO service key.
  It calls `partner_tello_*` security-definer functions with the public anon
  key plus `PARTNER_TELLO_DB_SECRET`, which each function checks against
  `partner_tello_config.secret` (generated in the database by the
  migration). The tables are closed to anon and authenticated.
- **Access is by link only**: `title22.app/meet?k=<key>`, one
  `partner_tello_links` row per person. No key, a wrong key or an inactive
  one shows "This link isn't active. Please contact hello@title-22.com." The
  page is noindex and linked from nowhere. The only row in git is the
  invented "Test Partner" / "Sample Training Co."; the owner adds real rows.
- **Disclosure (B&P Code §17941), word for word:** the fixed first message,
  the footer "Tello is an AI. All messages are sent to the Title22 team.",
  and the fixed answer to "are you a real person?". Who-runs-it and
  terms/money questions get fixed answers too (`fixedReply`), without the
  model. Never put a person's name in anything a partner sees or hears; the
  Worker also replaces the owner's first name in every reply.
- **Every message is stored before anything is said about it**, and every
  exchange is emailed to the team with the whole conversation so far
  (Resend, directly from this Worker; title22-email is not involved). A
  failed email is retried 3 times at once, then by a cron run every 10
  minutes (up to 8 runs), and logged on the row (`email_status`,
  `email_error`). "Message the team directly" emails a PRIORITY note.
  Where the emails go and who they come from are in `partner_tello_config`
  (`notify_to`, `email_from`), set by hand, because this repository is
  public. Until they are set, emails wait as `pending` and lose no try.
- **Health information:** the app's six identifier rules (copied from
  `T22_PHI_RULES`; `test.mjs` fails if they drift) plus a Partner-only check
  for a person word and a health detail together. A flagged message never
  reaches the model and is stored and emailed as "[removed: possible health
  information]".
- **Limits:** 30 messages an hour per key (direct notes included), 2,000
  characters a message.
- **Model:** `PARTNER_TELLO_MODEL` in wrangler.toml (Opus 5.5 at low effort,
  with the prompt and knowledge cached and the API's server-side fallback
  on). If the model fails, the question is still stored and emailed and the
  partner is told a person will reply.
- **Knowledge:** `workers/partner_tello/knowledge.md`, checked against the
  code and the site, dated per section, with an "Unverified, not included"
  list. Her rules are `prompt.md`. Both are bundled into the Worker, so a
  change needs `deploy-partner-tello.yml` to go live.

**Making links: title22.app/meet/admin (2026-10-02).** `partner_tello_admin.html`,
no SQL: a form (name, organization, email, note for Tello) makes a SHORT link,
`title22.app/meet/<name>-<6 random>` (e.g. `charise-k7q2xm`), with Copy, Share
and Email it; a list shows every link with its message count and an On/Off
switch. Only `profiles.title22_is_partner_admin` accounts get anything: the
three `partner_tello_admin_*` functions in
`migrations/2026-10-02_partner_tello_admin.sql` check it themselves. The page
uses the app's own sign-in storage, so being signed in to title22.app is
enough, and it never signs anyone out. Keys may now be 8 to 128 characters
(table check, Worker `KEY_RE`, page); the first 64-character links still work,
as `/meet?k=` or `/meet/<key>`. Nothing on that page returns message text.

**RULE: when a feature, a price, a plan, the trial or the partner program
changes, update `workers/partner_tello/knowledge.md` in the same PR**, with
the date it was checked and where. Partner Tello may say only what that file
says; a stale line there is a false statement made to a partner. Its tests
check the training hours against `training-rules.js`.

Not live until: the migration is run, the deploy workflow is run, the three
Worker secrets are added in Cloudflare (`ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, `PARTNER_TELLO_DB_SECRET`), `notify_to`/`email_from` are
set, and the page is merged. Then `partner-tello-live-test.yml` (repository
secret `PARTNER_TELLO_TEST_KEY`) runs the owner's tests against it.

## Forms library — blank forms, and how to use them (2026-09-27)

The Forms tab (`#tab-forms`, `T22_FORMS`, `renderFormsTab`) and Tello's
"print LIC ___" (`telloFormsIntent`, answered in the page with no AI call).
One of three highlights with certification tracking and Tello: what a new
administrator or new hire needs, for whom, and how.

- **BLANK FORMS ONLY — the owner's rule.** Every Print opens the empty, current
  form on the CDSS site. Never pre-fill a form from Title22's data, never print
  one filled, never save, upload or scan a completed resident form. A blank
  form is not PHI; a filled one is, and it stays on paper at the home.
- **A link goes in only after someone opened it and saw the right form** (the
  ADMISSION_FORMS rule). Entries without `url` show "Link being checked" and
  Tello says so rather than guessing. As of 2026-09-27 only the six RCFE
  admission links are checked; this environment could not reach cdss.ca.gov.
- Cards say what a form is, who fills it in, when, and where the finished copy
  goes. Never how often it is due, how long it lasts, or what an inspector
  accepts.
- License type (RCFE / ARF / Adult Day Program) is picked on the tab and kept
  per browser, NOT written to `facilities.facility_type`: no schema change,
  no risk to a check constraint nobody has read. Adult Day participant forms
  are not listed yet, and the tab says so.
- The printable new-hire and admission checklists were written from the
  owner's own checklists (a real home's). Home-specific names (the facility,
  its doctor, pharmacies, other software, house contracts) are left out on
  purpose; the source documents are not committed.
- SETTLED 2026-09-29: LIC 622 is the centrally stored medication and
  destruction record (§87465(h)(6), (i)), not a staff form. "Staff files (LIC
  622)" is gone from the site, the app and Tello's knowledge. Never label a
  staff file with it.

## Training hours are data, checked against the law (2026-09-29)

`training-rules.js` (UMD: `window.T22Training` in the page, `require` in
`tests/training-rules.test.mjs`) holds the three RCFE requirements and the
arithmetic; `public.title22_training_requirements` stores the same numbers,
and the test fails if the migration and the JS disagree.

- A `admin_ce`: 40 h in the 2 years before the certificate expires, 8
  dementia, 4 laws/regs, at least 20 live, at most 20 self-paced count (a
  warning shows when more are logged). HSC §1569.616(f); §87407.
- B `initial`: 40 h, 20 before working alone (6 dementia, 4 postural /
  restricted / hospice), the rest within 4 weeks of hire; 16 hands-on, 12
  dementia. HSC §§1569.625, 1569.626, 1569.696.
- C `annual`: 20 h per year from the hire anniversary, 8 dementia, 4
  postural / restricted / hospice. Hours in the first 4 weeks count toward B,
  not C.
- `staff_trainings` gained `topic_area`, `hands_on`, `delivery`,
  `counts_toward`; `staff` gained `admin_cert_expiry`. Old rows map from
  `category` through `T22T.normalise`.
- RCFE only (`facility_types` on the rule and on `checklist_items`). An ARF
  sees a plain hours-by-topic line and nothing checked against a requirement.
- The old "Continuing Education (20 hrs / 2 years) §87405" item is WRONG and
  was deleted by `migrations/2026-09-29_title22_training_requirements.sql`,
  which also fixed every mis-cited checklist item. The full audit, with what
  the law says for each, is `docs/citation-audit-2026-09-29.md`.
- The regulation text (§§87411(c), 87412(c)) still says 10 and 4 hours. The
  statute's 40 and 20 govern. Do not "correct" the numbers from the regs.
- `training.html` is a redirect: it read `training_courses` rows nobody had
  checked. Do not bring it back without checking every row.
- Phases (2026-09-30): phase 1 = 20 h (6 dementia, 4 postural) before
  working alone; phase 2 = 20 more (6 dementia) within 4 weeks. Entries carry
  `phase`; untagged ones fill phase 1 first by date. Required topics are
  checked covered / not covered with NO hour minimums: the partner's 1 h LGBT,
  3 h personal care, 2 h physical limitations and 2 h medication policies are
  not in any source checked and are not enforced. Do not add them as rules.
- Medication (HSC §1569.69) only for `staff.assists_with_medication`, sized by
  `facilities.capacity`: 10 h (6 hands-on before assisting, 4 within 2 weeks)
  or 24 h (16 hands-on, 8 within 4 weeks). Elder abuse training within 60
  days (WIC §15655). Hands-on entries carry the confirming `supervisor`.
- `title22_course_catalog` holds a course's credit hours and topic split
  (`courseToEntries` turns one into log entries). No SCORM yet.

## ARF checklists and training checks (2026-09-30)

ARFs (adults 18 to 59) follow 22 CCR §80000 and §85000, not §87100. Built
from CDSS's "Reference Guide to ARF Administrator, Staff, and Volunteer
Training Requirements" (Dec 2025, PIN 25-11-ASC), the CDSS Administrator
Certification FAQ, and the current regulation text in CDSS's own files
(arfman.docx, genman1-4.docx). Every item carries a citation and
`checked_on = 2026-09-30`.

- `migrations/2026-09-30b_title22_arf_checklists.sql`: 25 ARF items
  (`facility_types = {arf}`), 4 rows in `title22_training_requirements`, a
  `checked_on` column on `checklist_items`, and every previously untagged item
  marked `{rcfe,cbrc}` (all were written for RCFEs). Additive; verified twice
  on Postgres 16. Run it BEFORE merging the app change.
- No resident items and no medication items for ARF, not even tick-boxes. Do
  not add any.
- PPE training for all staff is NOT an ARF item: §85095.5(b)(2)(C) applies
  only when a client has a contagious disease (CDSS's guide lists it
  unconditionally; the regulation text wins). Removed on review 2026-09-30 by
  `2026-09-30c_title22_arf_drop_ppe.sql`, which is RUN: its report on the live
  database, 2026-09-30, read arf 25, rcfe/cbrc 76 (arf 26 before). `30b` no
  longer inserts the item, so a fresh database never gets it either. Do not
  add it back unconditionally.
- `training-rules.js`: `arf_admin_ce` (40 / 2 yr, 4 laws-regs, >=20 live,
  <=20 self-paced, NO dementia; initial 35 h live-only + exam in 60 days),
  `arf_admin_hiv_tb` (3 + 1 h within 6 months, then every 2 yr, counted from
  the administrator's hire date), `arf_infection_control` (10 days),
  `arf_emergency_plan` (hire + yearly), `arf_first_aid`. `elder_abuse` applies
  to ARF too. `adminCeStatus(rows, exp, today, rule)`; no rule = RCFE.
  `topicsFor(type)`: ARF gets HIV and TB and loses dementia and aging.
- The app shows only tasks whose item applies to the facility's type
  (`t22TaskApplies`). An ARF home seeded before 2026-09-30 still HOLDS its RCFE
  tasks in the database; they are hidden, not deleted, and the zero self-heal
  gives it the ARF list once ("zero" = zero for this type).
- Staff cards and the readiness score drop CPR and "Initial training" for ARF
  (CPR is ARF-required only with emergency intervention, §85165). The RCFE
  label "16hr Training" was wrong and is now "Initial training".
- Sample ARF home: `seedArfDemoData`, "Sample ARF (Demo)", 4 invented staff,
  no residents, no incidents, never the classroom MAR (`t22MarAllowed` names
  the RCFE sample).
- Tello gets `facility_type` and `training_rules` for that type only, and is
  told never to give an ARF an RCFE rule and to say "I'm not sure. Check with
  CCLD" otherwise. `tello/title22-knowledge.js` changed too: needs a
  `deploy-title22-ai.yml` run after merge.
- NOT modelled (named in the code): regional-center DSP training (WIC
  §4695.2, not reachable from an official source here), up to 24 Regional
  Center CE hours, the 10-hours-a-day CE cap, the 1-hour LGBT CE hour,
  emergency intervention / delayed egress / secured perimeters / hospice
  training.
- ARF checklists are LIVE as of 2026-09-30: 25 items, no resident or
  medication items. title-22.com says "Checklists for California RCFEs and
  ARFs" (homepage, contact page, partner handout; title-22-site #58). Claim
  nothing about ARF beyond the 25 items, the ARF Training tab and the sample
  ARF home.

CBRC ("Community Board and Care") stays in the facility-type picker for now
(the owner, 2026-09-30): no CDSS licence of that name was found, and the owner
is checking a real licence certificate before deciding. Do not remove it
without that decision. Under both pickers a hint says a board and care home is
an RCFE (residents 60+) or an ARF (18 to 59).

## Portfolio briefing — Tello for the executive (2026-09-23)

`#ai-portfolio` in the Tello tab, `renderPortfolioCard` / `runPortfolioBriefing`
in `index.html`. One row per home plus a Tello summary for someone who runs
several homes. Built for the 30-Day Proof (called "Ghost Audit" until
2026-09-23); runbook in `docs/30-day-proof.md`, public page
`title-22.com/pilot/`.

- **No-PHI by construction.** Reads only `compliance_tasks(completed,due_date)`,
  staff certification dates/flags (no names) and `incidents(occurred_at)`. No
  PHI table, whatever `showMAR` says. Tello is sent facility names and counts.
- **Numbers are computed in the browser; Tello only writes prose from them.**
  If she is unavailable the summary is computed from the table and says so.
- **"Checklist %" is NOT the readiness score** and must not be relabelled one —
  the dashboard score also counts staff records and documents.
- A home that fails to read is shown as unread and left out of totals, never
  counted as zero.
- Shown to the owner/administrator with 2+ non-sample homes and `ai` in
  `allowedTabs()`. In the sandbox it shows the demo home beside an
  *Illustration* row — the same home with every open item closed, incidents
  unchanged. That row is labelled as an illustration and must stay so.
- One AI call per press, never automatic. Cleared from the DOM by
  `clearSession`.
- Found from two places: a line under the card's note linking to
  title-22.com/pilot/, and a one-time toast (`maybeAnnouncePortfolio`,
  `title22_portfolio_announced` in localStorage) when onboarding adds the
  second real home. Never in the sandbox.

## Way-finding motion in the app (2026-09-23)

New accounts stopped on the dashboard not knowing where anything was — on a
phone every destination is behind the avatar button. `maybeIntroNav()` (called
from `initFacility` after `mountTelloDock`) runs ONCE per browser
(`localStorage.title22_nav_intro`): the sidebar slides in item by item, the
account menu opens itself with its items dropping in, a line at its top says
everything is in this menu, and one item carries "Start here"
(`t22StartHereTab`: Staff, else Checklist, Start Your Home or Dashboard —
Start Your Home first when the person was sent to the Launch Hub). The marks
go at the first click anywhere.

Not in the sandbox (the guided tour runs there), during the tour, or over an
open modal; in those cases the flag stays unset and the next arrival tries
again. Every later open of the menu drops its items in quickly
(`t22MenuCascade`, ~0.6s at most). `prefers-reduced-motion` gets the open menu
and the marks, with no movement. Reads and writes nothing but that one flag.

The menu has separate `openUserMenu()` / `closeUserMenu()` (2026-09-25). Every
menu item used to run `switchTab(x);toggleUserMenu()`, and `switchTab` already
closes the menu, so the toggle reopened it: on a phone, tapping a tab left the
menu covering the page. Menu items call `closeUserMenu()`, which can only
close. The panel slides down on open and up on close (~0.2s); reduced motion
gets neither. Do not put `toggleUserMenu()` back on a menu item.

The marketing site's matching piece is `title-22-site/assets/motion.js`: an
intro the first time someone lands on title-22.com, and the readiness dial on
every click through to title22.app.

## Explore without a licence number (2026-09-23)

The onboarding form now has a way out for whoever stops at the licence field:
**"Just exploring? Open the practice home instead"** (`#ob-explore`). It runs
the same `startJustLooking` as the chooser's "Show me around" — the Lite
sample facility from `seedLiteDemoData`. It is NOT the form pre-filled with
placeholders: a placeholder facility is not recognised by `isSampleFacility`,
so it would count against the trial's 2-facility cap, sit in the switcher
looking real, and print a fake licence on the DSS audit packet.

- `seedLiteDemoData({quick:true})` skips the confirm and the closing alert
  (a toast instead) — only when the account has NO facility at all. Anyone
  with a facility gets both dialogs exactly as before.
- `?mode=sandbox` (title-22.com's trial CTAs) is stored as
  `localStorage.title22_explore` and consumed by `maybeAutoExplore` at the
  zero-facility onboarding exit: it presses "Show me around" once, only for a
  verified, entitled `trial` with no pending invite. Paid, edu, invited and
  expired accounts are left on the normal screen; the flag is dropped either
  way, and after 24h.
- The licence field says "(optional)" — it always was: `handleOnboard`
  requires only the name. The lock note under it is written from what
  `license_number` actually does (Facility tab and the printed DSS packet;
  not in Tello's context, `track()` or any worker). Do not strengthen it to
  "never shared with anyone" — it is stored with the database host, and the
  packet exists to be handed to an analyst.

## The trial is 30 days, no card, nothing to cancel (2026-09-23)

`T22_TRIAL_DAYS = 30` in index.html, read by `t22RefTrialDays`. It was 14,
and 14 read as a deadline: a busy shift on day one and by day five the
person felt they had missed it. A trainer code can give more (90 by default)
and never less — `Math.max` with the default, so a student is never handed a
shorter trial than a stranger.

"Zero obligation" is a claim about the code, and it is true only while both
halves hold: signup takes no card (so nothing can be charged), and an expired
trial is read-only with every record kept (`t22ReadOnly`). If either changes,
the signup card, the trial banner, tello.html and title-22.com all say
something false.

Trials already running keep the end date they were stamped with.
`migrations/2026-09-23_title22_trial_30_days.sql` moves them out to 30 —
preview first, guarded, verified on Postgres 16. **Steps 1 and 2 were RUN
against the live database on 2026-09-23, after #127 merged, with no errors**
(reported by the owner). Do not run step 2 again expecting it to do anything:
its guard makes a second run a no-op.

**Step 3 was RUN too, the same day**: every expired Title22 trial was
reopened with `title22_trial_ends_at = now() + 30 days`, so every past trial
account is live again until about 2026-10-23. That is the win-back window —
the people who met the broken first sessions described in the history can
come back to a working app with their records intact. Step 3 has NO guard:
running it again would reopen whatever has expired by then. Do not re-run it
without a decision.

The `trial_warning` email template in `workers/title22-email/` no longer says
"upgrade to keep access to your facility records" — false since expiry became
read-only. Nothing calls that template today, and the Worker deploys by hand,
so the source change is not live until someone deploys it.

## Partner links: title-22.com/r/<code> (2026-09-23)

The one link a partner shares is **`title-22.com/r/<code>`**, a Cloudflare
Pages rule in title-22-site's `_redirects` that sends it to
`title22.app/?ref=<code>&src=partner-link`. It exists because the old flow lost
credit in three places:

- `/affiliates/` handed out `title-22.com/?ref=<code>`, and nothing on the
  site read `?ref=`: the code died on the homepage. The site homepage now
  carries `?ref=` onto every app link, so links already shared still work.
- The app saved `?ref=` as typed, but the payout report joins
  `profiles.referred_by = title22_trainers.code` exactly, and codes are stored
  lowercase. `?ref=JSmith` got the right trial and no credit. The capture now
  lowercases and keeps only letters, digits and hyphens — the same rule as
  `title22_create_trainer`. `migrations/2026-09-23_title22_normalise_referral_codes.sql`
  fixes rows written before (preview first, verified; RUN 2026-09-23, no errors).
- `/affiliates/` stripped hyphens, so `oak-hill` became `oakhill` and never
  matched. It keeps them now.

A code does not have to be registered to be recorded: `referred_by` is saved
for any code, and the payout report joins at read time, so signups made before
Eli registers a code still count once he does. Registering is one tap on
`/affiliates/` (a pre-filled email). Self-serve registration would need an RPC
anyone can call that writes a commission rate — deliberately not built.

A visitor who arrives on a partner link sees it worked: `renderRefNote` puts
"You're joining through <code>'s link — a N-day free trial" on the landing and
signup pages, and the signup card's numbers follow N. N is what
`t22RefTrialDays` will stamp (the code's length, never below 30). The code is
escaped and already reduced to letters, digits and hyphens.

## The public sandbox is ONE flagged facility (2026-09-23)

`title22.app/?demo=1` reads the single facility with `is_demo = true`, as the
anon role. Since 2026-09-23 that is **`970f35b4-ec9d-47a2-be85-2b5e0ee23285`**,
a "Sunrise Demo Home (Sample)" owned by the company address and seeded by the
Lite seeder — five invented staff, four with something out of date.

It went missing once: the sandbox answered "isn't available right now" and
nothing was flagged, most likely because the test-facility reset kept only the
newest sample home and deleted the older one that was the sandbox. The reset
now never touches an `is_demo` facility. Restored with
`migrations/2026-09-23_title22_restore_demo_sandbox.sql`.

Rules: do not delete it, do not clear its flag, and never flag a real home or a
sample owned by a customer — whatever is flagged is readable by anyone on the
internet. The 30-Day Proof's executive presentation, the site's "See it first"
button and `/pilot/` all open this sandbox.

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
  (`capture="environment"`, so a phone opens the camera). One card open at a
  time.
- **Four languages, one line at a time.** The English title is always the
  heading; a picker (`LAUNCH_LANGS`, `setLaunchLang`, `launchTr`) chooses which
  translation sits under it — Tagalog, Español, ਪੰਜਾਬੀ, or English only for
  none. Stored per browser in `title22_launch_lang`, defaulted from
  `navigator.language`, falling back to **Spanish** (the owner's call,
  2026-10-06; it was Tagalog before). Every card, every step, the
  progress counter, the header badge, the guide line and the button labels
  follow it (`LAUNCH_UI`; until 2026-10-06 those last three were fixed
  Tagalog in the markup and ignored the picker). Stacking all three under twelve steps would
  triple the reading on a screen whose whole design is one decision per
  screenful — hence one line, never three. `launchTr` falls back to Spanish, then
  Tagalog, if a translation is ever missing, so a gap shows in one language rather than
  blanking the line.

  **The Spanish and Punjabi are machine-produced and have not been read by a
  native speaker.** Neither has the Tagalog. They are short imperative phrases,
  so the risk is low, but this is a compliance product read by people who may
  not read English well — get each language checked by someone who speaks it
  before leaning on it in marketing.

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

**Present is not the same as correct, though.** `title22_member_entitlement`
was written before Lite and Multi-Home and only covered a team on trial, edu,
starter, pro, specialist or agency. Checked live 2026-10-01: covers_lite =
false, covers_multi = false, 0 members under a Lite or Multi-Home owner. So on
the two plans sold, an invited team member would go read-only when their own
trial ended. Fixed by `migrations/2026-10-01_title22_member_entitlement_lite_multi.sql`
(replaces the one function; tested on Postgres 16: Lite and Multi caregivers
covered, cancelled-and-ended refused, trial team unchanged). RUN on the live
database 2026-10-01 by the owner; the one-line check in its last comment read
covers_lite = true, covers_multi = true. Re-running it is harmless.

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

## Sign-up 500 / "{}" — a trigger from another app (2026-09-25)

Every new account, email and Google alike, failed with 500 from
`/auth/v1/signup` and the sign-up box showed "{}". The cause is
`on_auth_user_created` → `public.handle_new_user()` on `auth.users`, installed
by ANOTHER app on this shared project: `insert into credit_balances ...` with
no schema and no pinned search_path. Supabase Auth runs with
`search_path = auth`, so the name meant `auth.credit_balances` → 42P01. It
succeeds from the SQL editor, which is why it looks fine when tested by hand.
Fix: `migrations/2026-09-25_fix_handle_new_user_search_path.sql` (pins
`search_path = ''`, qualifies `public.`, same behaviour otherwise). Verified
against a local Postgres 16 stand-in, then RUN on the live database on
2026-09-25 and reported fixed by the owner. Re-running it is harmless
(`create or replace`), but there is no reason to.

Any trigger on `auth.users` runs inside EVERY sign-up for EVERY app on this
project, and one failing statement blocks them all. Anything added there must
pin its search_path and schema-qualify every name.

"{}" itself: supabase-js 2.110 builds a 5xx auth error from the Response
object, not its body. `t22Fetch` now captures the body and `authErrorText()`
shows it; never render `error.message` from auth directly.

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

- **The $29 path is CLOSED. It completed end to end on 2026-09-14.** A live
  purchase went through and the account activated — reported by Eli, and
  consistent with the state of the system at that moment: Worker run #11
  (version `046b4577`, commit `355c565`) carried the restored `SUPABASE_URL`
  and the corrected Lite price. This entry had been open since 2026-09-06 and
  was the longest-standing item in this file.

  Getting there took finding two bugs in series, the outer one hiding the
  inner: a CI deploy had deleted `SUPABASE_URL` so every event 500'd before
  reaching any business logic, and underneath that the Lite price in
  `PRICE_PLANS` was one character wrong. Both are written up below. Neither was
  in the code this bullet spent a week worrying about — the price map and
  `welcomeIsPaid` were correct and irrelevant.

  **The post-payment redirect is SET (2026-09-30).** Both Payment Links, Lite
  and Multi-Home, have "After payment" → Don't show confirmation page →
  Redirect to `https://title22.app#welcome` — reported by the owner from the
  Stripe dashboard. It is dashboard configuration, so nothing in this repo sets
  it or can show it; this environment cannot reach `buy.stripe.com` to check.
  If it is ever changed, the customer pays and is left on Stripe's own page.
  The app half: the router (`location.hash.includes('welcome')` in the boot
  path) calls `handleWelcome()`, which polls `welcomeIsPaid()` for 30s and
  shows "You're in." — or, if Stripe has not confirmed by then, "Still
  processing" with a "Check again" button.

  Do NOT "fix" this by changing `openStripe`'s `window.open(..., '_blank')` to
  a same-tab navigation. The new tab is deliberate: `index.html:1755` carries a
  `visibilitychange` listener that re-runs `refreshAccess()` when the customer
  returns to the original tab, so both tabs end up correct. That was nearly
  removed on 2026-09-13 by someone reading `_blank` as a bug.

  `docs/test-the-29-path.md` is the runbook: what to check at each of the three
  hops and what each failure means. Two things it establishes that are worth
  knowing before anyone tries: **Stripe test mode cannot test this**, because
  `PRICE_PLANS` holds only live price ids and a test-mode event refuses with
  422; and the in-app purchase path is the one to test, because `openStripe()`
  attaches `client_reference_id` and every CTA on title-22.com leads there.

  Traced 2026-09-13 without running it. `resolveUserId` tries
  client_reference_id, then a `subscriptions` lookup by subscription id, then
  the customer email. An in-app purchase resolves on the first branch and never
  reaches the fragile one. A bare `buy.stripe.com` link sent to somebody with no
  account resolves on none of them — that used to return 202, which Stripe
  treats as handled and never retries, so the money landed and nothing was
  written. It returns 409 now and Stripe retries for ~3 days, which heals the
  ordinary version of it. Still: **never share a raw Payment Link.** Send people
  to title22.app and let them buy from inside.
- **49 test facilities across 32 accounts.** Guarded reset is written and
  dry-run ready: migrations/2026-09-08_title22_reset_test_facilities.sql.
- **The trainer partner path has never been run end to end by anybody.** Same
  shape as the $29 path, and the first time it runs there is a partner
  watching it. Traced through the code on 2026-09-15 and written up in
  `docs/onboard-a-trainer.md` — the `?ref=` capture, `title22_check_trainer_code`
  for the trial length, the code riding in `user_metadata.referred_by` through
  the OAuth redirect, `ensureProfile` writing `profiles.referred_by`, and
  `title22_trainer_signups` joining on it with the edu exclusion. Three things
  in it that are not obvious from the tab:

  - **Classroom access and a trainer code are separate**, and neither implies
    the other. A trainer who teaches WITH the app needs both.
  - **They must sign up BEFORE the grant.** `title22_grant_classroom_account`
    looks up an existing auth user and returns `found:false` otherwise —
    nothing queues, nothing retries, and a mistyped email looks identical to
    "they have not signed up yet".
  - **The commission field is pre-filled 20%.** It is written into
    `title22_trainers` and read at payout, and nothing downstream will ever
    say it was wrong.

  One live failure mode that reads as a bug and is not: a referral never
  records for someone who ALREADY had a profile. `ensureProfile` upserts with
  `ignoreDuplicates`, so an existing row is never re-stamped. Referral capture
  only works on a genuinely new account.

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
secrets), and `wrangler deploy` does not touch them.

**That last clause was half true, and the wrong half broke the webhook — see
"How the $29 path actually failed" below.** `wrangler deploy` preserves
SECRETS. It REPLACES plain-text vars with whatever `[vars]` in `wrangler.toml`
says, and that file had no `[vars]` block, so the first CI deploy deleted
`SUPABASE_URL`. Three of the four bindings were deploy-safe. The fourth — the
only one that was a var rather than a secret — was not, and the sentence above
is what stopped anyone looking at it. Its last deploy was
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

## How the $29 path actually failed (2026-09-13)

The first real Lite purchase. Card charged $29, subscription created in Stripe,
account showed "Free Trial, 14 days" through every refresh. The cause was not
in `index.html`, not in the price map, and not in `resolveUserId`. It was a
missing environment variable, and every layer built to make this loud was
looking somewhere else.

**`wrangler deploy` deleted `SUPABASE_URL` from the Worker.** Secrets survive a
deploy; plain-text vars do not — wrangler sends the complete set of vars from
`wrangler.toml` and replaces what the Worker had. `wrangler.toml` had no
`[vars]` block, so the complete set was none. `SUPABASE_URL` had been typed
into the dashboard by hand and was the only one of the four bindings stored as
a var rather than a secret.

Runs #8 and #9 on 2026-09-09 were this Worker's first `wrangler deploy`s ever
— every prior deploy was a dashboard paste — so they were also the first
deploy that could take it. Both went green. Nothing anywhere reported it.

Then `fetch(undefined + '/rest/v1/profiles?...')` throws `TypeError: Invalid
URL`, the handler's catch turns that into **500 "Handler error"**, and that is
all the Stripe delivery log ever said.

What made it survive four days of looking:

- **The endpoint looked healthy.** Active, no required tasks, correct URL. That
  is what an endpoint that has never once succeeded also looks like.
- **The signature check kept passing**, because `STRIPE_WEBHOOK_SECRET` is a
  secret and secrets survived. So the Worker was demonstrably alive and
  correctly wired — which argued against exactly the right answer.
- **Unhandled events kept answering 200.** `invoice.payment_succeeded` hits
  `default:` and touches no binding, so the log showed a green row next to the
  red ones. A totally dead Worker would have been easier to find.
- **Only `SUPABASE_URL` produces a 500.** Work the other three: a missing
  `STRIPE_WEBHOOK_SECRET` answers 400 at the signature check; a missing
  `SUPABASE_SERVICE_KEY` sends the string "undefined" as a header, gets 401
  from PostgREST, and returns **200** having written nothing; a missing
  `STRIPE_SECRET_KEY` returns null from its own guard. Only an absent
  `SUPABASE_URL` throws. A 500 on this Worker names its own cause, if you
  know that table.
- **And CLAUDE.md said it could not happen** — "`wrangler deploy` does not
  touch them", written on 2026-09-08 when it was true of the three that were
  secrets. Corrected above.

Reproduced before it was fixed, not reasoned about: the deployed build
(`3125a0b`) replayed against a real-shaped `checkout.session.completed` and
`customer.subscription.created` with `SUPABASE_URL` removed returns 500
"Handler error" on both and 200 `{"received":true}` on
`invoice.payment_succeeded` — the same three rows, same bodies, as the live
delivery log. With the binding restored, all three return 200 and write
`title22_plan: 'lite'`, `status: 'active'` and a real `current_period_end`.

The two fixes:

- `[vars]` in `workers/stripe-webhook/wrangler.toml` now carries
  `SUPABASE_URL`. It is not a secret — it is the same public REST host
  `index.html` ships to every browser — and putting it in the file makes a
  deploy idempotent instead of destructive. **Do not set it in the dashboard
  instead. A dashboard value is precisely what the next deploy erases.**
- `REQUIRED_BINDINGS` is checked in `index.js` before anything else, including
  the signature check, and a missing one returns 500 naming it **in the
  response body** — the body is what the Stripe delivery log shows, and the
  console needs `wrangler tail` to have been running at the time. The
  bottom-of-file catch now puts the thrown message in the body too, instead of
  "Handler error".

The rule this leaves behind: **a binding that is not in `wrangler.toml` does
not survive CI.** Any Worker here whose config lives only in the dashboard is
one deploy from this same outage, and none of the six `wrangler.toml` files in
`workers/` declares a single var. The other five were last deployed by hand,
so they still hold whatever the dashboard holds — that is luck, not design.
Before adding any of them to CI, write their vars into their `wrangler.toml`
first.

And the lesson that is not about Cloudflare: **Stripe's delivery log was
right all along.** It had been showing red 500s since the moment of purchase.
Four days went to the app, the database, the wrong Stripe account and a
sandbox belonging to a different product, because nobody opened the one page
that records what the payment system actually did. Check the delivery log
first, before any code.

### And underneath it, a second bug: the price map does not match Stripe

Found 2026-09-13, once the Worker could finally get far enough to fail properly.

With `SUPABASE_URL` restored, `checkout.session.completed` returns **200** —
the fix is confirmed against the live database, and the **200 on
`customer.subscription.deleted`** is the strongest evidence there is, because
that handler does both a `patchProfile` and an `upsertSubscription` and neither
threw.

But `customer.subscription.created` then returned **422 Unmapped price**. The
price on a real live $29 subscription did not byte-match `PRICE_PLANS`.

**RESOLVED. It was one character, at index 9.**

    was:  price_1UC I AiAH9qPFLg89ln6eHAVa     LATIN CAPITAL LETTER I
    is:   price_1UC l AiAH9qPFLg89ln6eHAVa     LATIN SMALL LETTER L

That is the whole bug. The $29 price was ABSENT from the map on 2026-09-06 (the
original bug), was added on 2026-09-07/08 by reading it off the screen, and one
capital `I` was written where a lowercase `l` belonged. Nobody could tell,
because until 2026-09-13 the Worker died on `SUPABASE_URL` long before it
reached the price lookup. Two bugs in series, the outer one hiding the inner
one, for a week.

**Read this part before ever eyeballing an identifier again.** Working from a
photograph of the 422 message, the difference looked like it was at indexes 11
and 22 — `Ai` read as `AI`, and `ln6` read as `In6`. Both of those were
CORRECT already. Had anyone "fixed" what the screenshot appeared to show, they
would have changed two right characters, left the one wrong character in place,
and still had a 422 — with the map now differing from Stripe in three positions
instead of one. The ID was settled by pasting it as TEXT and diffing it
programmatically, which found exactly one difference and named the Unicode
codepoints on both sides. Do that. A screenshot of an identifier is not
evidence about the identifier.

Note what the 422 IS, though: the Worker refusing a payment it cannot name,
loudly, exactly as designed. That is the intended behaviour and it worked.

**The defence that follows from it — `PRODUCT_PLANS`.** One hand-copied string
was the only thing between a payment and an account. There are two now:

- On a price-map miss, the Worker asks Stripe what the price is
  (`stripePrice`) and tries again on its PRODUCT. `prod_VDBXSXDdmtFrmh` → lite,
  `prod_VDypF9WL2wmjGO` → multi-home. Both identifiers being mistyped is far
  less likely than one.
- The lookup runs ONLY on a miss, so a recognised price costs no extra API
  call. Verified: zero lookups on the normal path.
- A rescue is not silent, and this is the part that matters. It returns **200
  with a `warning` in the body** naming the exact price ID to add to
  `PRICE_PLANS`. Stripe records response bodies against every delivery, so the
  problem appears on the delivery log where somebody will actually meet it.
  `console.error` alone would need `wrangler tail` running at that moment —
  which means needing to already suspect the bug. The whole of this week says
  nobody does.
- A genuine miss still 422s, but the body now carries what Stripe says the
  price is (amount, interval, product) and the full list of keys we know.

Only the two sellable tiers are in `PRODUCT_PLANS`. Legacy subscribers renew
on their price IDs as they always have.

Verified across four cases: known price (200, plan written, zero lookups);
mis-cased price with a real product (200, `lite` written, warning in the body);
unknown price and unknown product (422 naming everything); and Stripe's API
unreachable (422, degrades, still names the price and the known keys).

The corrected ID is in `PRICE_PLANS`, `wrangler.toml`, `workers/README.md`,
this file and `index.html`'s comment — all five, swept so no stale copy is left
for somebody to re-transcribe from. Verified: the real price resolves to `lite`
with ZERO Stripe lookups, which is the proof the map is right rather than the
fallback quietly carrying it. The old wrong ID, should it ever turn up on a
legacy subscription, is still rescued via its product with the warning in the
body.

**Still worth doing in Stripe, not code:** put `plan=lite` / `plan=multi` in
the Payment Links' SUBSCRIPTION metadata (not the checkout session's —
`planFromSubscription` reads `sub.metadata`). That is a third independent path
to the tier.

**It is only safe to do that as of 2026-09-15, and the reason is worth reading
before anyone "simplifies" the resolution order back.** Until then
`planFromSubscription` returned the metadata plan as its ANSWER, so metadata
was consulted BEFORE the `PRODUCT_PLANS` rescue and won. Following the advice
in the paragraph above would therefore have DISARMED the alarm built two
sections up: a mistyped price with metadata set resolves from metadata, the
rescue never runs, the warning naming the bad price ID never reaches the
delivery log, and the map stays wrong until the next identifier is typed badly.
The account activates, so nothing looks broken. That is the 2026-09-13 bug
re-entering through the back door of its own fix.

Resolution is now **price → product → metadata**, in falling order of how far
the source is trusted, and BOTH fallbacks put a warning in the response body.
Verified by replay against the deployed build, nine cases: Multi-Home $79 on
all four event types (200, `multi`, zero Stripe lookups), Lite $29 (200,
`lite`, zero lookups), mistyped price with a real product (200 + warning),
unknown price with unknown product but valid metadata (200 + warning), and
422 with no writes for nonsense metadata, absent metadata, a Map bundle and
an other-business product. A known price still costs zero Stripe API calls,
which is the proof the map is right rather than the fallback carrying it.

Deployed by run **#12** on 2026-09-15 against commit `9cc2b7d`, conclusion
success. (Dated on purpose — see the CHECK THE ACTIONS HISTORY note below.
This is the fourth time this file has had to correct a deploy claim.)

**The $79 path has now been verified in code end to end, but still has never
been bought by a human.** The webhook writes `multi`; the app's `T22_PAID`
includes `multi` and `TIER_LIMITS.multi` is `{facilities:5, ai:true}`. Every
link in the chain is checked. That is not the same as a card being charged.

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

## Partner course completions become training hours (2026-10-06)

`workers/title22-learnupon` turns a LearnUpon `course_completion` into
`staff_trainings` rows, on `migrations/2026-10-06_learnupon_training_hours.sql`.
Owner-only while it is tested (the Partners tab card).

- **Who:** the owner picks a staff member on the card before "Open partner
  courses"; the Worker writes `learnupon_learner_links` (learner email ->
  staff, facility) after checking the staff member is in a home the owner
  owns. The latest link made before the completion wins.
- **How many hours:** ONLY from `title22_course_catalog`, matched on
  `external_ref` = LearnUpon course id, split by `courseToEntries` (the Worker's
  copy is tested against `training-rules.js`). Never from the payload's credits.
  A course with no catalog row logs no hours. Real courses get their hours from
  the partner; do not invent them. The one catalog row the migration adds is
  the sandbox test course, 1 h, inactive, labelled as a test.
- Every completion's log row says what happened: `training_status` recorded /
  no_staff_link / no_course_hours / not_completed. A failed training write is
  500 so LearnUpon retries; `source_ref = learnupon:<enrollment id>` keeps a
  retry from doubling the hours.
- **Tello says who finished (2026-10-06, the owner's ask).** `telloPartnerNews`
  in index.html reads this home's `staff_trainings` rows with a `learnupon:`
  source_ref from the last 14 days and, for each completion not yet announced
  in this browser (`title22_tello_partner_seen_<facility>`), adds a dock line:
  who, which course, how many hours, under Training. It opens the dock unless a
  form or the tour is open. Runs 2.5 s after the home opens (staff loaded) and
  whenever the tab comes back into view. Written in the page, no AI call.
- **Staff train from their own phone (2026-10-06, the owner: "I cannot hand
  them the computer").** "Send training link" on the same Partners card makes
  `title22.app/train/<token>` for the picked staff member (`_redirects` sends
  it to the Worker's `/t/<token>`, which signs them on by SQSSO). The learner
  is `staff-<staff id>@learners.title22.app`, a made-up address naming the
  record and no person; the learner link is written when the link is made.
  Only the token's SHA-256 is stored (`learnupon_staff_invites`,
  `migrations/2026-10-06b_learnupon_staff_links.sql`); 30 days; a new link
  switches the old one off. Also a "Training link" button on each active
  staff card, so no customer waits on us (the owner: "they will not contact
  me and wait for my reply"). Who: the home's owner or an `administrator` in
  `facility_members`. ONE SWITCH, two places, still OFF: `STAFF_LINKS_OPEN`
  in the Worker's wrangler.toml and `T22_STAFF_TRAINING_LINKS_OPEN` in
  index.html. Off = only the app owner. Turn both on only once the partner
  agrees, because every link opened creates a learner on THEIR portal. A new
  learner sees only courses the portal enrols them in.
- **The Training tab leads with what each person still needs (2026-10-06,
  the owner: the menu's Training should open the courses they need to
  finish).** "What each person still needs" now sits above Log training. Each
  person gets a "Courses to finish" box: the partner courses
  (`title22_course_catalog`, active, `external_ref` set) that cover the gaps
  the requirement checks already report, and "Send <name> a training link".
  Same switch as the links: owner-only until the partner agrees. Empty until
  the partner's real courses and hours are in the catalog. This is the HOME
  flow; trainers and their students are a separate flow, not designed yet.
- How real staff (not the owner's own account) get a LearnUpon identity is NOT
  decided. Staff records have no email. Decide with the partner before opening
  this past the owner.
