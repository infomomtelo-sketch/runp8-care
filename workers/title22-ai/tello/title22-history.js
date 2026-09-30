// What Tello knows about Title22's history, for PARTNER MODE ONLY.
//
// Written 2026-09-27 from this repository's own notes (CLAUDE.md, which is
// public) and the owner's working sessions. Nothing here is new to the
// public: it restates what the repo already records, in plain words, so the
// owner's partner knows what the owner knows. Nothing personal beyond how the
// owner likes to work. The private partner instructions stay in the database.
//
// Keep it current: when something here stops being true, change it here and
// deploy the Worker. A partner who repeats a stale fact is worse than one who
// says she does not know. Date every status line.

export const TITLE22_HISTORY = `TITLE22: WHAT HAS HAPPENED, WHAT IS DECIDED, WHAT IS OPEN
(Written 2026-09-27. Anything dated is true as of that date; check the live numbers for anything that changes.)

THE PRODUCT TODAY
- Title22 (title22.app, marketing site title-22.com) keeps a California care home's staff records, training and clearances current, and shows what DSS will ask for. Built for California RCFEs and ARFs (ARF checklists and training checks added 2026-09-30).
- On sale: Lite $29/month (1 home) and Multi-Home $79/month (up to 5 homes). Agency is "contact sales", with no price anywhere, on purpose. Older plan names (starter, pro, specialist, agency) exist only as labels for any old subscribers and are never offered.
- Trial: 30 days, no card, nothing to cancel. When a trial ends the account becomes read-only and keeps every record; it is never locked out. This was changed from 14 days on 2026-09-23 because 14 felt like a deadline. Every expired trial was reopened for 30 days that same day, so past trial accounts are live again until about 2026-10-23: a win-back window.
- Tello (you) is included on every plan. Inside the app: a daily briefing read aloud in your voice, a Tello tab and a chat bubble. On title22.app/tello: your own page, with this partner mode for the owner only.
- A Start Your Home tab walks people who have not opened yet through getting certified, preparing the house and getting licensed, in English plus Tagalog, Spanish or Punjabi (machine translations, not yet checked by native speakers).
- A public sandbox (title22.app/?demo=1) shows one invented home, "Sunrise Demo Home (Sample)". A 30-Day Proof pilot (title-22.com/pilot/) shows several homes to an owner who runs more than one.

NO PHI: THE LINE THAT DEFINES THE PRODUCT
- Title22 holds no resident health information: no resident records, no medications, no MAR, no LIC 601 or 602A. They were removed and the data purged in early September 2026. That is why there is no business associate agreement to sign and why it can cost $29.
- The one exception, approved by the owner on 2026-09-09: a Classroom account (for trainers teaching students) sees eight invented practice residents and a practice MAR in the sample home only. The roster is fixed; nobody can type a real name into it.
- Incident reports (LIC 624) are kept, with no resident linked or named.
- Free-text boxes refuse Social Security numbers, emails, phone numbers, medical record numbers and date-of-birth or insurance markers. They do not try to detect names, on purpose: that caught ordinary phrases like "Fire Drill".
- Wording rules: the audit trail is "append-only", never "immutable" or "tamper-proof". No promise of compliance or of passing an inspection. "No PHI" stays true only while nothing re-adds resident data.

MONEY AND PAYMENTS: WHAT HAPPENED
- The first real $29 purchase (2026-09-13) charged the card but the account kept saying "Free Trial". Two bugs in a row: a deploy had deleted a setting the payment webhook needed (every payment event failed for four days, and the Stripe delivery log showed it the whole time), and under that, the $29 price ID was mistyped by one character (a capital I where a lowercase l belonged). Both were fixed; the $29 path worked end to end on 2026-09-14.
- Lessons that stuck: check Stripe's delivery log first, before any code. Never read an ID off a screenshot; paste it as text. A setting that lives only in a dashboard can be erased by the next deploy.
- The $79 Multi-Home path is correct in code end to end but has never been bought by a real customer.
- Still open: the Payment Links do not send the customer back to title22.app after paying. Each link needs "Don't show confirmation page, redirect to https://title22.app#welcome" set in the Stripe dashboard, both Lite and Multi-Home.
- Still open: two $79 products exist in Stripe. The old one has no name, which is what appears on a customer's receipt and card statement (a common cause of disputes). Archive it once no subscription still bills on it.
- The Stripe account is shared with other businesses (about 85 products: Postpilots, Rekey Locks, TV Mount and more). Two "Map Bundle" products ($99 and $149) look like Title22 tiers but belong to a different build; the owner confirmed it on 2026-09-14. Never treat them as Title22.
- Never send anyone a bare Stripe payment link. Send them to title22.app and let them buy from inside, so the payment finds their account.

THE DATABASE AND SIGN-UP
- The Supabase project is shared with other apps. On 2026-09-25 every new sign-up failed because another app's database trigger broke; it was fixed the same day.
- Several database changes were written and never run, and nothing said so; an audit on 2026-09-10 found them. Analytics events were lost from 2026-08-07 to 2026-09-10 for that reason, so there is no usage data before 2026-09-10.
- About 49 test facilities across 32 accounts are in the database. A careful cleanup script exists; it has not been run.

DEPLOYS
- title22.app and title-22.com publish automatically from GitHub through Cloudflare Pages. On 2026-09-25 to 27 the connection broke silently and nothing new was published for two days; the owner reconnected it. After every merge, check that a "Cloudflare Pages" build ran.
- The Workers behind the app (payments, Tello, her voice) deploy with a button in GitHub Actions, and each deploy is checked so it cannot erase a setting.

PARTNERS AND GROWTH
- Partner link: title-22.com/r/code. A partner code gives a longer trial (90 days by default, never under 30). Trainers get 20% of every paid month by default (the rate is set per trainer when the owner registers the code). Nothing is paid automatically: the app counts signups and paid months per code, and the owner pays each commission by hand. Partners must say they earn a commission.
- The trainer partner path (code, signup, credit, payout report) is correct in code but has never been run end to end with a real partner. The first time will have a partner watching it.
- A classroom account and a trainer code are separate things; a trainer who teaches with the app needs both, and must sign up before being granted classroom access.
- A referral only records on a brand-new account.
- Social: Facebook, Instagram @title22app, YouTube @title22app, TikTok @title22529, scheduled through Metricool. title-22.com/follow lists them.
- Current focus (owner's words): first paying homes; trainer partners (Raya); 6Beds and SBDC outreach.

HOW THE OWNER WORKS (so you work the same way)
- Builds fast, mostly from a phone, often late at night, with Claude Code doing the engineering.
- Step by step: show the change, wait for "ok" before anything goes live. Anything touching money, customers or the database gets the steps first.
- Never paste a password, API key or secret into a chat.
- Quality matters: images and video must look sharp; Tello's look and voice match her intro video.
- Explain plainly and never assume he already knows a term; show what to tap and what to expect.
- Flag anything on the site or app that is not true or not legal, with the corrected wording.
- Tello can see and advise; she does not act. The owner decides and does, or asks Claude Code to.`;
