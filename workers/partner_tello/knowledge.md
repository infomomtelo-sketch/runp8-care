# What Partner Tello knows about Title22

Checked on 2026-10-01 against the code on `main` (runp8-care 11b068f, which is
title22.app) and the published site (title-22-site 55e4f87, which is
title-22.com). Each section names where it was checked.

This is knowledge, not data. Partner Tello cannot see any home, staff member,
document or account. When someone asks about their own records, the answer is
in the app at title22.app, not here.

RULE FOR WHOEVER EDITS THIS FILE: when a feature changes, this file changes in
the same pull request (CLAUDE.md, "Partner Tello"). Never add a person's name.

## In one line

Title22 keeps a California care home's staff records, training hours and
clearances current, and shows what is open before a licensing visit. It is
built for RCFEs (Residential Care Facilities for the Elderly, residents 60 and
over) and ARFs (Adult Residential Facilities, adults 18 to 59). The rules it
carries are California's (Title 22 of the California Code of Regulations and
the Health and Safety Code); it carries no other state's rules.

## What Title22 does NOT hold (checked 2026-10-01: index.html showMAR / t22Fetch, site /security/ and /faq/)

- No resident records, no medications, no MAR (medication administration
  record), no LIC 601 and no LIC 602A. No PHI. This is by design, and it is
  why no business associate agreement is needed.
- Incident reports (LIC 624) are kept without naming a resident.
- Staff records (TB, LiveScan, certifications) are employment records.
- The AI never gives clinical, medication or dosage advice.
- Title22 is not a certifying body and does not guarantee an inspection
  result. It shows what is open and helps close it. Staying licensed is the
  home's job.
- One exception, for teaching only: a Classroom account's practice home has
  eight invented residents and a practice MAR with a fixed roster, so no real
  person can be entered.

## Plans and trial (checked 2026-10-01: site /pricing/, index.html T22_TRIAL_DAYS)

Published prices, which may be quoted as written:
- Lite: $29 a month, one home.
- Multi-Home: $79 a month, up to five homes.
- Agency (more than five homes, or a management company): contact
  hello@title-22.com. No published price.
- Free trial: 30 days, no card, nothing to cancel. When it ends the account
  turns read-only and keeps everything.
- Tello, the AI assistant, is included on every plan.

Anything else about money (partner pricing, discounts, revenue share,
licences, contracts) goes to the Title22 team.

## Dashboard and readiness score (checked 2026-10-01: index.html refreshDashboard)

What it does: the first screen after sign-in. The "Inspection readiness
score" is requirements met over all requirements: the home's compliance
checklist items plus each active staff member's required records (TB,
First Aid, LiveScan, mandated reporter training; for an RCFE also CPR and
initial training). It shows how many are met, what is overdue and what is due
in the next month.
Where: Dashboard, the first item in the menu.
How to raise the score:
1. Open Dashboard and read what is listed as expired, missing or due.
2. Go to that person on Staff, or that line on Compliance.
3. Add the date, file the document, or tick the item. The score updates.

## Staff (checked 2026-10-01: index.html Staff tab, COMPLIANCE_REQUIREMENTS)

What it does: one record per person with hire date, role and the dates of
their TB test, CPR (RCFE), First Aid, LiveScan clearance and mandated reporter
training. Each card says what is missing, expired or expiring.
Searchable by name or document type.
Where: Staff.
How to add a person:
1. Open Staff and tap "+ Add staff".
2. Enter the name, role and hire date.
3. Add the certification dates you have, and tick "Assists residents with
   their medication" if they do (this adds the medication training check).
4. Save. The card shows what is still missing.

## Training tab (checked 2026-10-01: index.html Training tab, training-rules.js)

What it does: logs each training session with hours, a topic area, the date,
how it was taught (live or self-paced), what it counts toward, and for an
RCFE new hire the phase. It then checks each person's hours against the
requirements below and lists what is short, by topic. Hours stay accurate at
large staff sizes (tested with 300 staff).
Where: the account menu, "Training".

RCFE requirements it checks:
- New direct care staff, 40 hours of initial training in two phases. Phase 1:
  20 hours before working with residents on their own, including 6 on
  dementia and 4 on postural supports, restricted health conditions and
  hospice. Phase 2: 20 more within the first 4 weeks, including 6 on dementia.
  16 of the 40 must be hands-on. Required topics are checked as covered or not.
- Annual: 20 hours every year from the hire date, including 8 on dementia and
  4 on postural supports, restricted health conditions and hospice.
- Administrator certificate renewal: 40 hours in the 2 years before the
  certificate expires, including 8 on dementia and 4 on laws and regulations,
  at least 20 live (in person or live-stream) and no more than 20 self-paced.
- Medication training, for staff who assist residents with their medication,
  sized by the home's licensed capacity (entered on the Facility tab):
  15 or fewer: 10 hours, 6 hands-on shadowing before assisting and 4 more
  within 2 weeks. 16 or more: 24 hours, 16 hands-on shadowing before
  assisting and 8 more within 4 weeks. Then 8 hours every year.
- Elder and dependent adult abuse reporting training within 60 days of hire.

How to log hands-on training for a new hire:
1. Open the account menu and tap "Training".
2. Under "Log training", pick the staff member.
3. Type the course or session, choose the topic area, and enter the hours and
   the date.
4. For a new hire, choose the initial training phase (or leave "Work it out
   from the date").
5. Tick "Hands-on training" and type the name of the supervisor who watched
   it in "Confirmed by (supervisor)". Hands-on hours need that name.
6. Tap "Save training". It appears in that person's hands-on training log.

A certificate can be attached to the entry ("Certificate (optional)").

## ARF (checked 2026-10-01: migrations 2026-09-30b and 2026-09-30c, training-rules.js)

ARF checklists are live: 25 items, with an ARF Training tab and a sample ARF
home. ARF rules come from 22 CCR §80000 and §85000, not the RCFE rules. There
are no resident or medication items for ARF. The training checks are: the
administrator's 40 hours every 2 years (at least 4 on laws and regulations, at
least 20 live, no more than 20 self-paced, no dementia requirement), the
administrator's HIV and TB training, infection control plan training within
10 days of starting, emergency and disaster plan training on hire and every
year, and abuse-reporting training within 60 days. For an ARF, CPR and the RCFE
initial training are not scored.
Not covered for ARF (say so plainly): regional-center requirements such as
DSP training, emergency intervention training, delayed egress, secured
perimeters and hospice.

## Compliance checklist (checked 2026-10-01: index.html Compliance tab)

What it does: the facility requirements for the home's licence type, each
with a due date to tick off. It feeds the readiness score.
Where: "Compliance" in the menu (called Checklist in the account menu).
How to use it:
1. Open Compliance.
2. Work through the open items, oldest due date first.
3. Tick an item when it is done.

## Documents (checked 2026-10-01: index.html Documents tab, DOC_SLOT_HOWTO)

What it does: a document vault for the home's own papers and each staff
member's papers. Staff slots: TB test or clearance, CPR card, First Aid card,
LiveScan clearance, Mandated Reporter training, initial training certificate.
An empty slot explains what the document is and who issues it. No resident
files. Searchable by name or document type.
Where: Documents.
How to file a staff certificate:
1. Open Documents (or the staff member's card).
2. Choose the slot, for example "CPR card".
3. Upload the file, or use "Scan to fill" to read the dates off the card.
Scan to fill works on CPR, First Aid, LiveScan, Mandated Reporter and training
certificates. It is off for TB, which is typed by hand.

## Forms (checked 2026-10-01: index.html Forms tab)

What it does: links to blank, current state licensing forms (opened on the
CDSS site), with what each form is, who fills it in and where the finished
copy goes. Title22 never fills in a form and never stores a completed
resident form.
Where: Forms.

## Incidents (checked 2026-10-01: index.html Incidents tab, site /features/)

What it does: LIC 624 incident reports written without naming a resident.
Where: Incidents.

## Start Your Home (checked 2026-10-01: index.html LAUNCH_CARDS)

What it does: twelve steps in three cards (Get Certified, Prep House, Get
License) for someone who has not opened yet. Each step is answered with a
button or a photo. A translation line can be shown under each step in
Tagalog, Spanish or Punjabi.
Where: "Start Your Home" in the menu.

## Roles and team (checked 2026-10-01: index.html ROLE_ACCESS)

Five roles, each person with their own login: Administrator, Supervisor,
In-House Caregiver, Caregiver, and Read Only (for an inspector, a consultant
or family). Each role sees only what it needs. The administrator invites
people from "Team access" and sets their role.

## More than one home (checked 2026-10-01: index.html, site /pilot/)

Switch between homes from one account; each home's records stay separate.
With two or more homes, the Tello tab has a portfolio briefing: one row per
home with checklist percentage, overdue items, expired certifications and
open clearances, counted by the app, then a short summary. The 30-Day Proof
(title-22.com/pilot/) is two homes, thirty days, beside what they use today.

## Tello inside the app (checked 2026-10-01: index.html)

Tello, the AI assistant, is in every plan. In the app she gives a daily
briefing in plain language (certifications lapsed or about to, overdue
checklist items, missing staff documents, incidents to write up), answers
questions about that home's records, and helps a new home set up (staff,
staff certificates, the home's own documents). She never gives clinical or
dosage advice and never states a licensing requirement as fact.

## Sample homes (checked 2026-10-01: index.html)

- A practice home with invented staff, to look around without entering a
  licence ("Show me around" or "Just exploring?").
- A public sandbox, title22.app/?demo=1, with invented staff.
- A sample ARF home with invented staff and no residents.

## Trainer and partner program (checked 2026-10-01: site /partners/, /for-trainers/, /affiliates/, /classroom/)

- A partner gets a code and one link: title-22.com/r/<code>.
- People who sign up through it get a longer trial, usually 90 days instead
  of 30, with no card. A code only attaches to a brand-new account.
- Trainers earn 20% of every paid month for as long as the home stays. Other
  partners' rates are agreed with the Title22 team. The Title22 team pays
  partners directly.
- Signups count, not clicks. Partners always say they earn a commission.
- A free Classroom account is a separate request: a practice home to teach
  with that never expires. Students accept the trainer's invite to it; the
  trainer then sees their lesson attempts and scores.
- Trainers keep their own approved course. Title22 is where students practise.
- Lessons: a trainer can write lessons in the app or load a starter set and
  edit it.

## Courses inside Title22 (checked 2026-10-01)

- SCORM course integration is NOT built. Title22 cannot run or import a SCORM
  package today. Say so plainly and make no promise about when.
- What works today: a completed course's hours are logged on the Training tab
  (with topic, delivery and a certificate attached), and they count toward the
  requirements above.

## Security, as published (checked 2026-10-01: site /security/)

Each home's records are separated at the database. HTTPS everywhere and
encryption at rest. An append-only, timestamped audit trail of changes. Data
is never sold. Records can be exported or deleted.

## Unverified, not included

Do not answer from these; pass the question to the Title22 team.

- The "In-service" page (inservice-staff.html): not reviewed for this file.
- Any customer count, user count, result, testimonial or partner name.
- Dates for any future feature, including SCORM, other languages for the
  whole app, and other states.
- Whether the Spanish, Tagalog and Punjabi lines in Start Your Home have been
  reviewed by native speakers (they have not been confirmed).
- Data residency, uptime figures, certifications such as SOC 2: not stated
  anywhere checked.
- Exact commission rates for anyone other than trainers, payout dates and
  payment methods.
