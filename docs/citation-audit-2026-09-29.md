# Citation audit — 2026-09-29

Every legal citation Title22 shows (checklist, app, Tello, title-22.com),
checked against the current law. Anything wrong was fixed or removed; nothing
here was left "probably fine".

## Sources

leginfo.legislature.ca.gov is blocked from this environment, so the law was
read from CDSS's own copies:

- Current RCFE regulations, 22 CCR Division 6 Chapter 8, from the CDSS
  manual (`cdss.ca.gov/Portals/9/Regs/Man/CCL/rcfeman1..4.docx`, manual
  letters through CCL-26-06).
- CDSS, *Reference Guide to RCFE Administrator, Staff, and Volunteer Training
  Requirements* (updated January 2025), which quotes the Health and Safety
  Code sections.
- CDSS administrator certification renewal page and FAQ.
- PIN 23-14-CCLD, PIN 23-16-ASC, PIN 24-09-ASC, PIN 25-11-ASC.

Where only the regulation and the statute disagree, the statute governs and
the statute is what Title22 uses (see "Training hours" below).

## Training hours — what changed

The item **"Continuing Education (20 hrs / 2 years) — CCR Title 22 §87405 —
Every 2 years"** was wrong three ways: the hours (it is 40), the section
(§87405 is "Administrator — Qualifications and Duties"; the renewal hours are
in HSC §1569.616 and §87407), and who it applies to. It is removed everywhere and replaced by
three items, stored as data (`training-rules.js`,
`public.title22_training_requirements`):

| | Requirement | Source |
|---|---|---|
| A | Administrator renewal: 40 hours in the 2 years before the certificate expires; at least 8 on dementia, at least 4 on laws, regulations, policies and procedural standards; at least 20 live (in person or live-stream), no more than 20 self-paced | HSC §1569.616(f); 22 CCR §87407 |
| B | Direct care staff, initial: 40 hours; 20 (incl. 6 dementia and 4 postural supports / restricted health conditions / hospice) before working on their own; the rest within 4 weeks; 16 hands-on; 12 dementia in total | HSC §§1569.625, 1569.626, 1569.696; 22 CCR §87411(c) |
| C | Direct care staff, annual: 20 hours every year from the hire date, incl. 8 dementia and 4 postural supports / restricted health conditions / hospice | HSC §§1569.625, 1569.626, 1569.696 |

Where the law differs from the brief I was given, and the law was used:

- **B and C also need 4 hours on postural supports, restricted health
  conditions and hospice care** (HSC §1569.696), and for B they come before
  working on their own. Added as its own topic and minimum.
- **A: 1 hour of LGBT cultural competency** if the administrator's initial
  certification course did not include it (22 CCR §87407(a)(3)). Shown in the
  rules note; not tracked as a minimum because the app cannot know what the
  initial course covered.
- **A: a Nursing Home Administrator licensee needs 20 hours, not 40**, and no
  more than 10 hours count per day (§87407). Not modelled; the note says to
  confirm with the licensing analyst.
- **The regulation text is out of date.** §§87411(c) and 87412(c) still say
  10 hours / 4 hours; the statute's 40/20 has governed since 2016. Title22
  uses the statute.
- **Staff who assist with medication** have their own hours (HSC §1569.69):
  not modelled here, and not claimed.
- Topics `laws_regs` and `postural_hospice` were added to the requested list,
  because A and B/C have minimums in them.

## Audit table

"Correct?" is the answer for the citation as it stood before this change.

### Checklist items (`public.checklist_items`, fixed by the 2026-09-29 migration)

| Item | Citation | What the law says | Correct? | Now |
|---|---|---|---|---|
| Continuing Education (20 hrs / 2 years) | §87405 | Administrator renewal is 40 hours / 2 years (HSC §1569.616(f), §87407). Staff hours are B and C above | **No** | Removed; replaced by A, B, C |
| 40-hour initial / 20-hour annual training items | various | As B and C above | **No** (hours and parts incomplete) | Replaced by B, C |
| CPR certification current | §87411(e) | §87411(e) is on-the-job training in homes of 16+. CPR: one person with CPR and first aid on duty at all times, HSC §1569.618(c)(3) | **No** | HSC §1569.618(c)(3) |
| First aid certification current | §87411(e) | First aid training for staff providing care: §87411(c)(1) | **No** | §87411(c)(1) |
| Health screening and TB clearance before first shift | §87411 | §87411(f): health screening with chest x-ray or intradermal test, 6 months before to 7 days after starting | **No** (timing) | Retitled, §87411(f) |
| TB test renewed (annual) | §87411 | No annual staff TB renewal in the RCFE regulations | **No** | Citation removed |
| Fire clearance current | §87212 | Fire clearance is §87202. §87212 is the emergency disaster plan | **No** | §87202 |
| Fire clearance current and drill log up to date | §87212 | No drill-log requirement in Chapter 8 | **No** | "Your fire clearance is current", §87202 |
| Emergency disaster plan | §87212(a) | Written plan, readily available, §87212(a); staff trained at hire and yearly, HSC §1569.695(b) | Yes | Unchanged |
| Centrally stored medication record complete for every dose | §87465 | §87465(h)(6): a record of centrally stored prescription medication, kept 1 year; per-dose records only for PRN (§87465(c)(3), (d)(3)) | **No** (overreach) | "kept current", §87465 |
| Every medication entry identifies who administered it | §87465 | Not in §87465 | **No** | Citation removed |
| Physician orders reconciled against the MAR | §87465 | Not in §87465 | **No** | Citation removed |
| Medication locked, centrally stored | §87465 | §87465(h) | Yes | Unchanged |
| Medication destruction record | §87465 | §87465(i): administrator and one other adult, record kept 3 years | Yes | Unchanged |
| Resident appraisal reviewed for changed needs | ISP citation | §87463: reappraisal as needed or at least every 12 months | **No** | §87463 |
| Individual Service Plan completed / reviewed | §87463 / other | "ISP" is not an RCFE term; RCFEs use the appraisal / needs and services plan | **No** | Citations removed |
| LIC 602A on file, dated within the last year | §87506 | §87458: made within the year before admission, then updated when the Department requires | **No** (timing) | Retitled, §87458, on admission |
| LIC 602 — Physician's Report | — | LIC 602 is the Physician's Report for other facility types; RCFE uses LIC 602A | **No** | Merged into the 602A item |
| LIC 601 on file | §87506 | Resident record contents, §87506 | Yes | Unchanged |
| Criminal record clearance before starting | §87411(g), §87355 | Clearance or exemption before employment or presence, §87411(g); §87355 | Yes | Unchanged |
| Personnel records | §87412 | §87412 | Yes | Unchanged |
| Incident reporting (LIC 624) | §87211 | §87211 | Yes | Unchanged |

Step 7 of the migration prints every checklist item that still carries a
citation. Anything it shows that is not in this table has not been checked.

### App (index.html, tello.html, Tello's knowledge)

| Item | Citation | What the law says | Correct? | Now |
|---|---|---|---|---|
| "Staff files (LIC 622)" (Tello knowledge) | LIC 622 | LIC 622 is the centrally stored medication and destruction record, §87465(h)(6)/(i) | **No** | Form number removed |
| "Explain a word or form" hint: LIC 622 (tello.html) | LIC 622 | As above; invited a wrong explanation | **No** | Now LIC 624 |
| Refusal tip, "document reason per Title 22 §87465" (classroom MAR) | §87465 | §87465 protects the right to refuse; it does not require a reason | **No** | Citation removed |
| Blood-pressure tip, "per Title 22 §87465" (classroom MAR) | §87465 | Not in §87465 | **No** | Citation removed |
| DSS packet: centrally stored medication record (LIC 622) | §87465 | §87465(h)(6) | Yes | Unchanged |
| DSS packet: staff certifications | §87411, §87412 | Personnel requirements and records | Yes | Unchanged |
| DSS packet: incidents | §87211 | §87211 | Yes | Unchanged |
| DSS packet: resident documents | §87506, §87569 | §87569 was the medical assessment section in the old numbering; it is §87458 now | **No** (§87569) | §87458, §87506 |
| In-service pages: trainer criterion and content statement | 22 CCR §87411 | §87411(c)(4) trainer criteria; (c)(6) documentation, statement of content covered | Yes | Unchanged |
| In-service record footer | HSC §§1569.625, 1569.626, 1569.69, 1569.696 | Staff training statutes | Yes | Unchanged |
| Training tab, "Annual hours" (20 / 8 dementia) and "Initial hands-on" cards | — | Missing the 4 hours postural / hospice; no administrator CE | **Incomplete** | Replaced by A, B, C per staff member |

### title-22.com

| Item | Citation | What the law says | Correct? | Now |
|---|---|---|---|---|
| Score: LIC 602A dated within the last year | §87506 | §87458, within the year before admission | **No** | §87458, reworded |
| Score: current appraisal | §87463 | Updated at least every 12 months or on significant change | Yes (wording tightened) | §87463 |
| Score: TB clearance on file | §87411 | §87411(f) | Partly | §87411(f), with the timing |
| Score: no expired CPR or First Aid card | §87411(e) | HSC §1569.618(c)(3): someone with CPR and first aid on duty at all times | **No** | HSC §1569.618(c)(3), reworded |
| Score: medication records complete, no blanks (30 days) | §87465 | Not in §87465 | **No** | Replaced: centrally stored record, §87465(h)(6) |
| Score: every medication entry attributable | §87465 | Not in §87465 | **No** | Removed |
| Score: fire clearance and drill log | §87212 | Fire clearance §87202; no drill-log rule | **No** | §87202, drill log removed |
| Score: emergency plan, staff trained | §87212(a) | §87212(a) and HSC §1569.695(b) | Partly | Both cited |
| Score: LiveScan before first shift | §87355 | §87355 | Yes | Unchanged |
| Score: LIC 601 on file | §87506 | §87506 | Yes | Unchanged |
| Staff files "LIC 622" (home, features, for-trainers, FAQ, partner kit, Tello voice line) | LIC 622 | Medication record, not a staff form | **No** | Removed; "personnel records" |
| Blog, medication post: assistance "under 87465(a)(5) and (a)(6)" | §87465 | (a)(5) is assistance; (a)(6) is a dosage record on request | **No** | (a)(5) |
| Blog, medication post: destruction "by the administrator or a designated representative" | §87465(i) | "the facility administrator and one other adult who is not a resident" | **No** | Matches the regulation |
| Blog, medication post: PRN record, 3-year destruction record, prescription blank | §87465(c)–(e), (i) | As stated | Yes | Unchanged |
| Blog, admissions post: "LIC 603 — Preplacement Appraisal" for RCFE | LIC 603 | RCFE form is LIC 603A, Resident Appraisal (LIC 603 is ARF) | **No** | LIC 603A |
| Blog, inspection post: "preplacement appraisal (LIC 603)" | LIC 603 | As above | **No** | Form number removed |
| Blog, recertification post: 40 h, 20 live, 8 dementia, 4 laws; 4-year late limit | HSC §1569.616, §87407 | As stated | Yes | Added the 1 LGBT hour |
| Blog, CE post and ICTP post: 40 h split; 80-hour ICTP | §87407; CDSS FAQ | As stated | Yes | Unchanged |
| "Reviewed with a licensed RCFE administrator" (blog) | — | CDSS certifies administrators; it does not license them | **No** | "certified" |

## ARF

Title22's checklists and training checks are written for RCFEs. An ARF can
sign up and gets the general staff-records tools. Every place that said
Title22 is "for RCFEs and ARFs" now says it is built for California RCFEs,
with ARF checklists in development, and choosing ARF at signup or in the
facility settings shows: "ARF-specific checklists aren't available yet.
You'll see the general staff-records tools." RCFE-only checklist items carry
`facility_types` and are not seeded into an ARF; the migration removes any
that were.

Not changed: "RCFE / ARF course instructors" in the site's navigation, which
describes who can be a partner, not what the app does.

## Second pass: the rest of the checklist (`2026-09-29b` migration)

Step 7 of the first migration printed every checklist item still carrying a
citation. Each was checked against the current regulations. 96 cited items
became 57.

Merged into the correct item (each home keeps one task; a tick on either copy
is kept):

| Merged | Into | Why |
|---|---|---|
| 16-hour initial / 8-hour annual caregiver training (4 items) | Items B and C | The law is 40 and 20 (HSC §§1569.625, 1569.626) |
| Annual TB Test (x2), TB Test on Hire (x2), Staff Health Screening on Hire | Health screening incl. TB, §87411(f) | One screening at hire; no annual TB rule; §87411(b) is minimum age |
| CPR (x2), First Aid (x2) cited §87411(d) | The corrected CPR and First Aid items | §87411(d) is a list of training topics |
| LiveScan (x2) | Criminal record clearance, §87355; §87411(g) | Duplicates |
| Fire Safety Inspection (x2) | Fire clearance, §87202 | Duplicates |
| Disaster plan posted, plan reviewed | Emergency disaster plan, §87212(a), (c) | §87211 is incident reporting; §87303 is maintenance |
| RCFE License Posted (§87309) | License posted, §87113 | §87309 is storage of poisons; §87207 is False Claims |
| Resident Rights Posted (§87572) | Rights posted, §87468(c) | §87572 does not exist |
| Physician Report (LIC 602) (x2), Annual Physical | LIC 602A item, §87458 | RCFE uses the 602A; no annual physical rule |
| Pre-Admission Appraisal (LIC 601), ISP Completed | Pre-admission appraisal (LIC 603A), §87457 | The LIC 601 is identification; "ISP" is not an RCFE term |
| ISP / ISP Annual Review (x3) | Reappraisal, §87463 | As above |
| Expired meds (x2), stored (x2), physician orders | The §87465 items | Duplicates; §87465(d)/(e)/(c) were the wrong subsections |

Citations corrected: administrator certificate §87405(a); renewal filed
§87407; hot water §87303(e)(2) (105–120°F); hazardous materials §87309(a);
bedrooms §87307(a)(2) (§87304 does not exist); telephone §87311; menus
§87555(b)(6) (homes of 16+); kitchen §87555(b); first aid kit §87465(a)(8);
labels §87465(h)(4); storage §87465(h); disposal §87465(i); PRN order
§87465(e); advance directive information §87468.2 (§87585 does not exist);
"evacuation drills 2x/year" (§87218 is Theft and Loss) became staff training
on the plan at hire and yearly, HSC §1569.695(b).

Citations removed, because no section in Chapter 8 says it: administrator
certificate posted, DSS inspection log, liability insurance, smoke and CO
detectors, exit signs, fire extinguishers (these belong to the fire
clearance), controlled substances log, MAR (x2), physician orders for all
medications, monthly weight, self-administration assessment, food handler
certificate, mandated reporter training.

## Initial training phases, topics and medication (2026-09-30)

From a training partner's new-staff orientation checklist, each rule checked
before it was built. Source unless noted: CDSS "Reference Guide to RCFE
Administrator, Staff, and Volunteer Training Requirements" (January 2025),
which quotes the statute, and the current text of 22 CCR §87411.

| Rule | Citation | Verified | Built as |
|---|---|---|---|
| Phase 1: 20 h before working with residents alone | HSC §1569.625(b)(1) | Yes | Enforced |
| Phase 1 includes 6 h dementia | HSC §1569.626(a)(1) | Yes | Enforced |
| Phase 1 includes 4 h postural supports / restricted conditions / hospice | HSC §1569.696(a)(1) | Yes | Enforced |
| Phase 2: remaining 20 h within the first 4 weeks, incl. 6 h dementia | HSC §§1569.625, 1569.626 | Yes | Enforced |
| 16 of the 40 hands-on | HSC §1569.625(b)(1) | Yes | Enforced (hands-on log) |
| Required topics: physical limitations, personal care, infection control, residents' rights, medication policies, psychosocial, emergency response, LGBT cultural competency | HSC §1569.625(c); 22 CCR §87411(c)(3)(A)–(F); HSC §1569.695(b) | Yes (topics) | Covered / not covered |
| First aid | 22 CCR §87411(c)(1) | Yes | Covered / on file |
| Elder abuse reporting training within 60 days | WIC §15655(a) | Yes | Enforced (60 days) |
| LGBT cultural competency: 1 h minimum | — | **No** | Topic only, no minimum |
| Personal care: 3 h minimum | — | **No** | Topic only, no minimum |
| Physical limitations: 2 h minimum | — | **No** | Topic only, no minimum |
| Medication policies: 2 h for every home | — | **No** | Topic only, no minimum |
| Medication, 15 or fewer: 10 h, 6 hands-on shadowing before assisting, 4 other within 2 weeks | HSC §1569.69(a) | Yes | Enforced, for staff who assist with medication |
| Medication, 16 or more: 24 h, 16 hands-on shadowing before assisting, 8 other within 4 weeks | HSC §1569.69(a) | Yes | Enforced, for staff who assist with medication |
| Medication course covers antipsychotics and psychotropic drugs | HSC §1569.69(a) | Yes (search of the statute text) | Stated; content not checked |
| Medication: 8 h every year after | HSC §1569.69(b) | Yes | Stated; not yet tracked |

Differences from the partner's checklist: the medication hours apply only to
staff who assist with self-administration, not every direct care worker; the
hands-on shadowing must come before the person assists; the non-hands-on hours
are due within 2 weeks in a home of 15 or fewer (not 4).
