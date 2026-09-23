# Video scripts

Written 2026-09-23. Nine short videos, one per person who arrives at Title22,
plus the rules every one of them has to keep. Nothing here has been recorded.

Every earlier walkthrough clip was deleted on 2026-09-07/08 because it showed
a Residents tab, a MAR, or named residents with rooms and dates of birth (see
CLAUDE.md, "Recordings and copy: all removed"). These scripts are written so
that cannot happen again. Read the rules before recording anything.

---

## Rules for every video

**What is on screen**

- Record ONLY in the public sandbox (`title22.app/?demo=1&tour=0`) or in a
  freshly loaded sample home ("Load sample facility" / "Show me around") on an
  account made for recording. Never a customer's account, never your own real
  facility.
- Every name on screen is invented. The sandbox and sample homes already are.
  Blur or crop the browser's address bar, the account email in the menu, and
  any notification that pops up.
- **No Residents tab, no Medications, no MAR, no Daily log** — they do not
  exist in Lite, and showing them sells something the product does not hold.
  The ONE exception is videos 4 and 5 (trainers and students), inside the
  Classroom practice home, with the on-screen label *Practice home — eight
  invented residents. No real resident can be added.* Never cut a MAR shot
  from those videos into any other video.
- Incidents are written without naming anyone. If an incident appears on
  screen, its description names no resident.

**What is said**

- No compliance guarantees. Title22 helps you see and close open items; it
  does not guarantee compliance or an inspection result. Never say "pass your
  inspection", "DSS-approved", or "fully compliant".
- State no requirement as fact — no "TB is due every year", no "you need 20
  hours". Say what the app tracks, not what the regulation says. Anything
  regulatory: "check with your licensing program analyst."
- Tello never comments on medication or dosage, on any plan. Do not show her
  being asked one.
- Tello is on every plan, including the trial. Never call AI a paid feature.
- Prices, if said at all: Lite **$29/month** (one home), Multi-Home
  **$79/month** (up to five). Agency is "talk to us" — never a number.
- The trial: **30 days, no credit card, nothing to cancel.** When it ends the
  account becomes read-only; nothing is deleted. Both halves are true in code
  today; if either changes, these scripts are wrong.
- The audit log is "append-only". Never "immutable" or "tamper-proof".
- "No PHI" means: Title22 holds no resident health information. Say it that
  way. Do not say "HIPAA compliant".

**How they are made**

- Phone-first: record at 1080×1920 (vertical) for the short ones, with a 16:9
  cut for the site. Burned-in captions on every video — most are watched with
  the sound off.
- One idea per screen. If a shot needs a paragraph of voice-over, it is two
  shots.
- End every video on ONE action and its link, not three.
- Links carry `?src=video-<name>` so the events table shows which video sent
  whom. The ones below already do.
- When a video is published, `VIDEO_MAP` in index.html may point at it — it
  is `{}` on purpose until something current exists. Only add a clip that
  was checked against this page.

---

## 1. "Should I bother?" — the undecided visitor

**For:** someone on title-22.com who has not decided. **Length:** 60 s.
**Where:** homepage, above "Ten seconds, not ten paragraphs"; pinned on social.
**Tone:** shows, does not ask. No "please try", no "we'd love".

| # | On screen | Voice / caption |
|---|---|---|
| 1 | A binder, pages sticking out. Close-up. (Real footage or the four-step icon drawing.) | "Most care homes keep compliance in a binder. It's fine — until the night before a visit." |
| 2 | Sandbox dashboard. The readiness score, low. | "This is the same home in Title22." |
| 3 | Staff tab: three rows, one amber "20 days", one red "Overdue", one green. | "It tells you whose certification is running out, and when. A name and a date — not a chart." |
| 4 | Tick a checklist item. The score climbs. | "Close an item, and the score moves." |
| 5 | Tello dock opens (record this shot on the recording account's sample home — the sandbox has no dock). Type: *What should I fix first this week?* Answer appears. | "Ask Tello what to do first. She answers from your own records." |
| 6 | Text on screen: **No resident health information. No agreement to sign. Nothing to breach.** | "Title22 holds no resident health information — by design." |
| 7 | Title card: **30 days free · No card · Nothing to cancel** | "Thirty days. No card. When it ends, your records stay." |
| 8 | End card: **title22.app** — "See it with a sample home first." | "Open a sample home and look around. No licence number needed." |

End link: `https://title22.app/?src=video-undecided&mode=sandbox`

---

## 2. The owner — "What am I paying for?"

**For:** the licensee who signs the cheque, often running one home, not at a
desk all day. **Length:** 75–90 s. **Where:** `/pricing/`, `/features/`.

| # | On screen | Voice / caption |
|---|---|---|
| 1 | Owner on a phone, sitting in a car. (Stock, or text card.) | "You own the home. You're not there every shift. You still answer for it." |
| 2 | Dashboard on a phone: readiness score + "Tasks overdue". | "One screen tells you where the home stands today." |
| 3 | Staff tab, the red row. | "Whose CPR is out. Whose TB is due. Before it becomes a finding." |
| 4 | Team access: invite a Supervisor. The role cards. | "Your administrator does the work. You see it. Each role sees only what it needs — a caregiver never sees billing." |
| 5 | Facility tab → print the DSS audit packet. | "When the analyst arrives, the packet prints from what's already recorded." |
| 6 | Audit log scrolling. | "Every change is logged, append-only, with who made it." |
| 7 | Text: **Lite $29/month — one home.** **Multi-Home $79/month — up to five.** | "Twenty-nine a month for one home. Seventy-nine for up to five." |
| 8 | Text: **No resident health information.** | "It holds no resident health information, so there's no business associate agreement to sign." |
| 9 | End card. | "Thirty days free, no card. Start with a sample home." |

End link: `https://title22.app/?src=video-owner`

Do not say it "saves X hours" — nobody has measured it.

---

## 3. The administrator — "Your first evening"

**For:** the person who will actually enter everything. A how-to, not a pitch.
**Length:** 2–3 min, chaptered. **Where:** inside the app (the Walkthrough
modal), `/walkthrough/`, YouTube.

**Chapter 1 — Find your way (0:00)**
Open the app for the first time. The menu opens by itself; "Start here" is on
Staff. *"Everything is in this menu. Start with the one that's marked."*

**Chapter 2 — Add your staff (0:20)**
Staff → Add. Name, role, then the dates: CPR, First Aid, TB, Live Scan,
mandated reporter. *"Dates go in once. After that, Title22 watches them."*
Show the amber/red chips appear. Do not say how long any of them lasts.

**Chapter 3 — Work the checklist (0:55)**
Compliance → tick three items; the score on the dashboard moves. *"Each item
you close moves your readiness score."* Open an item's note field — type
nothing identifying.

**Chapter 4 — File documents (1:25)**
Documents → an empty slot shows "How to complete this". Upload a PDF.
*"Each slot says what the document is and who issues it. For what DSS
expects, ask your licensing analyst."*

**Chapter 5 — Log an incident (1:50)**
Incidents → new. Type, date, time, what happened — written without a name.
Point at the note under the field. *"Describe what happened. Don't name the
resident — Title22 doesn't hold resident information."*

**Chapter 6 — Invite your team (2:15)**
Team access → Invite → Caregiver → copy the link. *"Send it by text. They
join your home with only what a caregiver needs."*

**Chapter 7 — Ask Tello (2:35)**
Tello dock: *Which staff certifications expire in the next 30 days?* *"She
answers from your records. She won't give medical or medication advice."*

End link: `https://title22.app/?src=video-admin`

---

## 4. The trainer — "Teach with it, and your students get 90 days"

**For:** CE and ICTP instructors. **Length:** 90 s. **Where:**
`/for-trainers/`, `/classroom/`, sent directly to prospects.

| # | On screen | Voice / caption |
|---|---|---|
| 1 | A classroom (the trainer pitch footage, `videos/title22-trainer-pitch.mp4`). | "You teach caregivers the paperwork. They meet the real thing on their first shift." |
| 2 | Classroom account: the practice home. Label on screen: *Practice home — eight invented residents.* | "A Classroom account gives you a practice home — eight invented residents and a practice MAR." |
| 3 | Try to add a resident: refused. | "The roster is fixed. There's no field to type a real name into. Nothing real can end up in it." |
| 4 | Lessons tab → New lesson. | "Write your own lessons and knowledge checks. Your content, your class." |
| 5 | Team access → invite a student. | "Invite each student. They practise under their own name." |
| 6 | Partner link on screen: `title-22.com/r/yourname` | "Your own link gives every student who signs up a 90-day trial for their workplace — instead of 30." |
| 7 | Text: **Classroom access and your partner link are separate. Ask for both.** | "Classroom access is how you teach. Your link is how they keep going after class." |
| 8 | End card. | "Write to hello@title-22.com and we'll set up both." |

End: `mailto:hello@title-22.com` / `https://title-22.com/for-trainers/?src=video-trainer`

Do not state commission figures in the video — rates are agreed one to one.
Do not promise that the app satisfies any CE or ICTP hour requirement.

---

## 5. The student — "How to join your class"

> **BLOCKED — do not record scene 5 yet (found 2026-09-23).** A student who
> signs up from the invite link gets their own 30-day trial, and
> `resolveTierLimits` only falls back to the facility's plan when the
> person's OWN account is not entitled. So the student's plan reads `trial`,
> not `edu`, and `t22MarAllowed` keeps the MAR off — even standing in the
> trainer's practice home. They would see no MAR tab until their own trial
> ran out. The Classroom invite card ("each one logs MAR entries") promises
> otherwise. Needs a decision and a code fix before this video is made; the
> other scenes are fine.

**For:** a caregiver student who was just handed an invite link. A how-to.
**Length:** 90 s. **Where:** sent by the trainer; `/classroom/`.
Captions in English; a Tagalog and Spanish subtitle track is worth making.

| # | On screen | Voice / caption |
|---|---|---|
| 1 | Phone, a text message with a link. | "Your instructor sent you a link. Tap it." |
| 2 | Create account (or Google). | "Make an account with your own email." |
| 3 | You land in the practice home. Label: *Practice home — invented residents.* | "This is your class's practice home. Everyone in it is invented." |
| 4 | Menu opens, items drop in. | "Everything is in this menu." |
| 5 | MAR tab (Classroom only): record a practice pass. | "Practise recording a medication pass exactly the way your instructor shows you." |
| 6 | Lessons tab: read, answer a knowledge check. | "Your instructor's lessons are here. Read, then answer the check." |
| 7 | Incidents: write a practice report without a name. | "Practise writing an incident report. Real reports never name the resident." |
| 8 | Text: **This is practice. Nothing here is a real record.** | "It's practice. You can't break anything." |
| 9 | End card. | "Starting a job? Your instructor's link gives your workplace a longer free trial." |

Tello's answers in class come from the practice home only. Do not show her
being asked anything about a medication or a dose.

---

## 6. The caregiver on shift — "Thirty seconds on your phone"

**For:** a caregiver invited by their administrator. **Length:** 45 s,
vertical. **Where:** sent with the invite link.

1. *"Your administrator invited you. Tap the link and make an account."*
2. Menu opens. *"You'll only see what a caregiver needs."*
3. Checklist: tick "Fire drill held and logged". *"Done something on the list? Tick it."*
4. Incidents → new, written without a name. *"Something happened? Write down what, where and when — never a resident's name."*
5. Tello dock: *What's still open today?* *"Not sure what's left? Ask Tello."*
6. End: *"That's it. Your administrator sees it straight away."*

---

## 7. The executive with several homes — "The 30-Day Proof"

**For:** a regional director or owner of 3+ homes. **Length:** 60–75 s.
**Where:** `/pilot/`, sent after a first call.

| # | On screen | Voice / caption |
|---|---|---|
| 1 | Text: **Which of your homes do you look at first?** | "You run several homes. Which one needs you this week?" |
| 2 | Sandbox: Tello tab → Portfolio briefing. Two rows: the sample home, and the row labelled *Illustration*. | "Tello's portfolio briefing puts every home on one screen — lowest first." |
| 3 | Zoom on the columns. | "Checklist, overdue items, expired staff certifications, open clearances. Counted by the app — not guessed by the AI." |
| 4 | The "Illustration" label, highlighted. | "This second row is an illustration: the same home with every open item closed." |
| 5 | Summary paragraph appears. | "Then Tello writes it up for someone with a minute." |
| 6 | Text: **Two homes. Thirty days. Judge it on day 30.** | "Pick two homes. Run it beside what you use today. Compare day 1 with day 30." |
| 7 | End card. | "Set up a 30-Day Proof — hello@title-22.com." |

Keep the *Illustration* label visible whenever that row is on screen. Never
call "Checklist %" a readiness score. No outcome claims.

---

## 8. The applicant — "Opening a home? Start here"

**For:** someone who has not got a licence yet — a large share of signups.
**Length:** 60 s. **Where:** homepage, social, `/blog/` posts on getting
licensed. Make a Tagalog, Spanish and Punjabi caption track — the Launch Hub
already speaks all three.

1. *"Not licensed yet? Title22 has a place for you too."*
2. Start Your Home tab: three cards — Get Certified, Prep House, Get License.
3. Language picker → Tagalog. *"Every step, in your language."*
4. Tap a step's button; take a photo of the house with the phone camera.
   *"No typing. A button, or a photo."*
5. Progress counter moves.
6. Text on screen: *"Title22 tells you what each step IS and who issues it.
   For what the state requires, ask your licensing office."*
7. End: *"Thirty days free. Start your home."*
   `https://title22.app/?src=video-applicant`

Do not state timelines, costs, or what an inspector accepts — the tab itself
refuses to.

---

## 9. The partner — "Share one link"

**For:** consultants, agencies, anyone recommending Title22. **Length:** 30 s.
**Where:** `/affiliates/`, `/partners/`.

1. *"You recommend Title22. Here's the whole process."*
2. `title-22.com/r/yourname` on screen. *"One link, with your name in it."*
3. Signup page showing *"You're joining through yourname's link."* *"They see
   it worked."*
4. *"They get a longer trial. You get credit when they subscribe."*
5. End: *"Get your link at title-22.com/affiliates."*

Never show a raw Stripe payment link in any video.

---

## Which to make first

1. **Undecided visitor** — it is the homepage, and it is the one most people
   will ever see.
2. **Administrator "first evening"** — it replaces the walkthrough clips that
   were deleted, and it is what a new account needs on day 1.
3. **Trainer** and **student**, together — a trainer will not share the app
   with a class without a how-to to hand them.
4. The rest as the audience turns up.
