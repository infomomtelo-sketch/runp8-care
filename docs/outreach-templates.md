# Outreach templates

Replacements for the Templates sheet in the Title22 Outreach Tracker.
**Copy only — nothing here touches index.html, the Worker, or title-22.com.**

Every line is checked against the rules this product already holds itself to:

- **No inspection-outcome guarantees**, and no absolute compliance claims.
- **Never state a regulatory requirement as fact.** Checklist citations are null
  on purpose; `DOC_SLOT_HOWTO` says what a document IS and who issues it, never
  what an inspector accepts. A sales email may not promise what Tello is
  forbidden to say.
- **The audit log is "append-only."** Never "immutable", never "tamper-evident".
- **No PHI** is a claim about what the product HOLDS, and it is a selling point
  rather than a limitation.
- **Async only** — no "book a call", per the Sep 1 decision.
- **CAN-SPAM**: physical postal address and an opt-out in every footer.

## Three things to fix before sending any of these

1. **The footer address is settled — 2026-09-16.** EC Rental Property Management
   LLC, 5287 North Tisha Ave, Fresno, CA 93723. I twice recommended a PO Box or
   a registered agent instead, because the street address is also where Eli
   lives; he chose this deliberately with the LLC name in front of it, which is
   what makes it read as a business address. Settled, not an oversight — do not
   re-open it.

   **The entity is EC Rental Property Management LLC. RunP8 LLC is gone.**
   These templates carried RunP8 for a few hours on 2026-09-16 because it was
   substituted from stale notes after the correct name had been given. It was
   also still in `trainers.html`'s public footer, which is how that got caught.
   Swept from the repo the same day.
2. **Send from `hello@title-22.com`.** The Log says the one recorded send went
   from the personal Gmail. Pick one address and keep it.
3. **Two rows on the list will never buy this.** WISTERIA WARNER CENTER (capacity
   850) and WOODLAND HILLS LIFE PLAN COMMUNITY (402) are continuing-care
   communities with compliance departments. Title22 is a $29 product for a
   six-bed home. Drop them rather than spend a first impression.

## What changed from the old templates, and why

| Old line | Problem |
|---|---|
| "tells you exactly what's missing — before an inspector finds it" | An inspection-outcome claim. The Read Me's own guardrail forbids it. |
| "an AI that checks your records against Title 22 requirements" | Tello is explicitly forbidden from stating a requirement as fact. |
| "ask 'Am I ready for DSS?'" | Instructs the prospect to ask the one question she is built to decline. |
| "a demo facility with real (fake) residents … planted compliance gaps" | **False for anyone who signs up normally.** `seedDemoData` gates the resident sample on `t22Plan==='edu'`; everyone else falls through to `seedLiteDemoData()` — no residents, no MAR. |
| `title-22.com/walkthrough` called a "10-minute self-serve demo" | That page is written steps now, not a player. |
| "No cost, no catch" | It is free for 30 days and $29/month after. Saying the price builds more trust than hiding it. |

---

# OPERATOR — FIRST TOUCH

**From:** hello@title-22.com
**Subject:** One page instead of the binder

> Hi {contact_name},
>
> I build Title22, a record-keeping tool for California RCFE and ARF operators.
> I built it with a certified RCFE administrator, which is the only reason it is
> shaped the way it is.
>
> What it does: keeps staff certifications, TB and LiveScan clearance, incident
> reports and your document file in one place, timestamped. When DSS asks, you
> print one page instead of digging through a binder.
>
> What it deliberately does not do: it holds no resident health information at
> all. No resident records, no medications, no medication log. That was a design
> decision, not a gap.
>
> Free for 30 days, then $29 a month for one home. No card to start, nothing to cancel.
>
> title22.app
>
> If it's not for you, no hard feelings — I'd still take your honest read on it.
>
> Eli
>
> —
> Title22 · EC Rental Property Management LLC · 5287 North Tisha Ave, Fresno, CA 93723
> Don't want these? Reply "unsubscribe" and I'll take you off the list.

# OPERATOR — FOLLOW-UP 1 (day 7)

Must carry something new. This one carries the expiry tracking, which is the
part operators recognise fastest.

**Subject:** The thing I should have led with

> Hi {contact_name},
>
> Following up on my note about Title22 — I didn't want to just bump it, so
> here's the part I should have led with.
>
> It tracks the expiry dates. TB, CPR, First Aid, LiveScan, mandated reporter,
> per person, and it tells you before they lapse rather than after. That is the
> thing that catches people out, and it is the thing a binder cannot do.
>
> Everything entered is timestamped and the record is append-only — entries are
> not edited away after the fact.
>
> title22.app — free for 30 days.
>
> Eli
>
> —
> Title22 · EC Rental Property Management LLC · 5287 North Tisha Ave, Fresno, CA 93723
> Don't want these? Reply "unsubscribe" and I'll take you off the list.

# OPERATOR — FOLLOW-UP 2 / FINAL (day 14)

Last one. No ask, no link-stuffing, no third email ever.

**Subject:** Last note from me

> Hi {contact_name},
>
> I'll leave you alone after this.
>
> If keeping the staff records in one place ever becomes worth ten minutes —
> today or a year from now — it's at title22.app and I'll still be the one
> answering the email.
>
> Wishing you a quiet inspection either way.
>
> Eli
>
> —
> Title22 · EC Rental Property Management LLC · 5287 North Tisha Ave, Fresno, CA 93723
> Don't want these? Reply "unsubscribe" and I'll take you off the list.

---

# TRAINER / CE PROVIDER — FIRST TOUCH

**The sequence is the fix, not the wording.** The old version told trainers to go
and look. They cannot see the classroom until you grant it — `seedDemoData` gates
the resident sample on `t22Plan==='edu'` — so they would have signed up, loaded a
sample with no residents in it, and quietly concluded you oversold.

So this email asks them to REPLY. Then you grant Classroom access, then they look.
Runbook: `docs/onboard-a-trainer.md`.

**Before sending to the six on the list:** all six are marked `Group Home` with
`RCFE-approved? (verify)=TBD`. Group Home administrators certify under Title 22
Division 6 Chapter 5 — children's facilities — not Chapter 8. Confirm which
categories each vendor is approved for before sending. The email below is written
for an RCFE/ARF trainer.

**Subject:** A practice facility for your students

> Hi {contact_name},
>
> I build Title22, a record-keeping tool for California RCFE and ARF operators.
> I'm writing about the classroom side of it rather than the product.
>
> I can set your class up with a practice facility — a seeded home with invented
> residents and staff, where students can work through the records without any
> real person's information being involved. The roster is fixed, so there is no
> field for a student to type a real name into.
>
> Title22 doesn't supply course content and doesn't award any hours. You teach
> your own material. This is the hands-on part, if you want one.
>
> It's free for your classroom. Reply and I'll switch it on for your account —
> it needs turning on from my end, so there's nothing to try until you do.
>
> Eli
>
> —
> Title22 · EC Rental Property Management LLC · 5287 North Tisha Ave, Fresno, CA 93723
> Don't want these? Reply "unsubscribe" and I'll take you off the list.

---

# NO EMAIL ON FILE — phone and Facebook

63 of the 92 have no email. These two are the only scripts that apply.

## Phone opener

> "Hi, is this {name}? I'm Eli — I build a record-keeping tool for RCFE and ARF
> operators here in California. It keeps the staff certifications and the
> document file in one place so there's one page to print when DSS comes.
> Would it be alright if I texted or emailed you a link to look at? No obligation
> either way."

If they say no, thank them and mark the row closed. There is no second call.

## Facebook message

> Hi — I build Title22, a record-keeping tool for California RCFE and ARF
> operators. Staff certifications, expiry dates, incident reports and documents
> in one place, so there's one page to print when DSS asks. Free for 30 days,
> $29 a month after, at title22.app. Happy to answer anything.

Keep it short and put no link in the first message if the account is new —
Instagram blocked a longer link-led message on 2026-09-14 and the recipient never
saw it. Facebook applies the same kind of filter.

---

# The one line that needed her permission — approved 2026-09-16

"I built it with a certified RCFE administrator." Checked with her and cleared.
Recorded here so nobody re-opens it: it is the strongest line in the sequence, it
is about her rather than about Eli, and it goes to strangers in her own industry.
Asked, answered, settled.

If the wording of that line ever changes materially, ask again. Consent was given
for this sentence, not for the idea in general.
