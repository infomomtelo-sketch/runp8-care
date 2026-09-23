# The Ghost Audit pilot

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

## What "ghost" means, and the line it must not cross

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

**They sign up first.** At <https://title22.app>, with the email of whoever
will own the pilot account. Every CTA on title-22.com leads there.

- A new account is a **14-day trial** that allows **two facilities** —
  exactly the one-or-two-homes shape of the pilot, with no code change.
- They add their one or two lowest-performing homes as facilities, and invite
  the administrator of each from the Team tab.
- **Do not** have them press "Load sample facility" in the pilot account. It
  does not count against the cap, but it sits in the facility switcher next to
  their real homes and invites exactly the confusion the pilot is meant to
  remove.

**Extending the trial to 30 days is a manual step,** run in the Supabase SQL
editor by someone on the Title22 team, after they have signed in once (the
first sign-in is what stamps the 14-day trial):

```sql
-- Read first: confirm it is the right account and still on trial.
select p.id, u.email, p.title22_plan, p.title22_trial_ends_at
from public.profiles p join auth.users u on u.id = p.id
where u.email = 'director@example.com';

-- Then extend. Only a 'trial' row; never touch a paid plan this way.
update public.profiles p
set title22_trial_ends_at = now() + interval '30 days'
from auth.users u
where u.id = p.id and u.email = 'director@example.com'
  and p.title22_plan = 'trial';
```

The app reads `title22_trial_ends_at` on the next refresh. There is no pilot
plan, no pilot code and no new Stripe product — a pilot is a longer trial.

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
