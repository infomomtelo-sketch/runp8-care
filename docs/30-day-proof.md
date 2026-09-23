# The 30-Day Proof

Called the "Ghost Audit" pilot until 2026-09-23. Renamed because "ghost" read
as covert and "audit" as a licensing inspection — the thing CDSS does, and a
claim this product does not make. The tone of the name is the tone of the
offer: we show, they judge. Two homes, thirty days, judge it on day 30.

A sales motion for operators with several homes: a regional director, an owner
with a portfolio, a management company. Three parts, in the order a prospect
meets them.

1. **The executive presentation** — on the public sandbox, never on their data.
2. **The 30-day pilot** — one or two of their lowest-performing homes, in a
   Title22 account of their own.
3. **The portfolio briefing** — Tello's summary across every home, which is
   what the executive reads on day 1 and again on day 30.

The public page is `title-22.com/pilot/` (title-22-site). This file is the
runbook behind it.

## What "beside" means, and the line it must not cross

The pilot runs **beside** whatever the facility uses today. Nothing is
imported from their systems, nothing is connected to them, and nothing in
their systems is changed. Their staff keep doing what they do; the pilot
account records the same facility's staff certifications, checklist and
incidents in parallel, so at day 30 there is a before and after to compare.

Title22 holds **no resident health information**, and the pilot is no
exception. No resident records, no medications, no MAR, no LIC 601 or 602A.
Staff records are employment records and are fine. Incidents are written
without naming anyone. If a prospect asks to load residents "just for the
pilot", the answer is no — the product has nowhere to put them, and that is
what lets it run without a BAA.

## 1. The executive presentation

Use the sandbox: <https://title22.app/?demo=1&tour=0>

It is anonymous, read-only, and reads only the `is_demo` facility. Nothing the
presenter clicks can write anything, and nothing of the prospect's is touched.
`&tour=0` skips the visitor tour, which is aimed at a single owner, not a room.

The order that works:

1. **Dashboard.** The readiness score and what is behind it. This is the
   "messy building".
2. **Tello tab → Portfolio briefing → "Brief me on every home".** In the
   sandbox this shows two rows:
   - the sample home **as it is recorded** — overdue items, expired staff
     certifications, open clearances;
   - the **same home with every open item closed**, badged *Illustration*.

   That is the messy-versus-clean comparison, side by side, in the product's
   own words. Say what the second row is: an illustration of the same home
   with its open items closed, not a second facility and not a promise of
   what any home will score. Its incident count is deliberately unchanged —
   closing a checklist does not remove an incident.
3. **Tello chat.** "Am I ready for DSS?" and "Who has expired certs?" answer
   from the sample data with no AI call (the sandbox's canned path).

Do not show the sandbox as a customer's data, and do not describe any number in
it as a typical result.

## 2. Setting up the pilot

**They sign up first**, with the email of whoever will own the pilot account.
Send them to <https://title22.app> directly, not through a "Start free trial"
button on title-22.com: those carry `?mode=sandbox` and drop a new account
straight into the practice home, which is right for a stranger and wrong for a
pilot that should start on the prospect's own homes.

- **Every new account is already a 30-day trial** (`T22_TRIAL_DAYS`, since
  2026-09-23), with no card and nothing to cancel. The pilot needs no manual
  extension, no SQL, no pilot plan, no pilot code and no Stripe product — a
  pilot is simply a trial that someone is walking with.
- A trial allows **two facilities** — exactly the one-or-two-homes shape of
  the pilot.
- They add their one or two lowest-performing homes as facilities (the license
  number is optional), and invite the administrator of each from the Team tab.
- If they do end up in the practice home, nothing is lost: it does not count
  against the two-facility cap, and the portfolio briefing leaves it out. They
  add their real homes from the user menu. It is still clearer not to start
  there, which is why the link above matters.

A pilot that needs longer than 30 days is the one case for a manual step: move
`profiles.title22_trial_ends_at` for that one account in the Supabase SQL
editor, `where title22_plan = 'trial'` only, never on a paid plan.

When it ends it behaves like any expired trial: **read-only, not locked out**.
Their checklist, staff files and readiness scores are all still there, and
billing is one click away.

## 3. The portfolio briefing

Tello tab → **Portfolio briefing** → **Brief me on every home**.

Shown to the facility owner or an administrator, when the account has **two or
more** homes of its own (the sample facility is not counted), and never to an
expired trial (Tello is off there). Code: `renderPortfolioCard` and
`runPortfolioBriefing` in `index.html`.

One row per home, lowest checklist first:

| Column | What it counts |
|---|---|
| Checklist | Share of that home's Title22 checklist marked complete |
| Overdue / Due ≤30d | Checklist items not complete, past due / due in the next 30 days |
| Staff certs expired / Expiring ≤30d | Active staff with CPR, First Aid or TB past date / within 30 days — **people, not certificates** |
| Clearances open | Active staff with LiveScan not cleared or mandated-reporter training not done |
| Incidents 30d | Incidents recorded in the last 30 days |

Under the table, Tello writes 3–6 lines for the executive from **those counts
only**. What she is sent is facility names and numbers — no resident, no staff
name, no free text — because the reads never ask for anything else: the
checklist's `completed,due_date`, staff certification dates and flags, and
incident `occurred_at`. No PHI table is read, whatever `showMAR` says.

Things it does on purpose:

- **"Checklist" is not the readiness score.** Each home's dashboard score also
  counts staff records against the document requirements, which needs that
  home's full records loaded. The card says so under the table. Do not relabel
  it "readiness" — a number beside a home's name that disagrees with its own
  dashboard is how an executive stops trusting both.
- **A home that could not be read says so**, and is left out of the totals
  rather than counted as zero. Zero overdue on a home nobody read is the one
  line this card must never show.
- **If Tello is unavailable** (limit reached, Worker down) the summary is
  computed from the table instead, and says that it was.
- **One AI call per press, never automatic.** On a trial that is from the same
  monthly allowance as every other Tello question.
- Up to 25 homes, read five at a time; beyond that it says how many it showed.

### Day 1 and day 30

Press it on the first day of the pilot and save the page (print to PDF). Press
it again on day 30. The two tables are the pilot's result, in the prospect's
own records. Present them as what was recorded, not as a compliance outcome:
Title22 does not guarantee compliance or an inspection result, and nothing in
the pilot should say otherwise.
