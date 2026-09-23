# Onboarding a trainer partner

The runbook for the path a partner actually walks. Written because the $29
path was debugged for a week by guessing, and this path has never been run
end to end by anybody — the first time it runs, someone is watching.

Companion to `docs/test-the-29-path.md`. Same rule: check what each hop
actually did before assuming the next one worked.

## Two separate things, and neither implies the other

People confuse these because they happen in the same tab, minutes apart.

| | What it is | What it does NOT do |
|---|---|---|
| **Classroom account** | Their own access to Title22. Plan `edu`, never expires, sample facility with a practice MAR. | Does not create a referral code. Does not pay them anything. |
| **Trainer code** | A `?ref=` link. Longer trial for their students, commission if a student subscribes. | Does not give THEM an account. Does not grant Classroom. |

A trainer who teaches with the app needs both. A pure affiliate needs only
the second. Decide which before you start.

## Order matters

**They sign up first. You grant second.**

`title22_grant_classroom_account` looks up an existing auth user by email. If
they have not signed up yet it returns `found: false` and the page says so —
nothing is queued, nothing retries. Run it again after they sign up.

1. They create an account at <https://title22.app> themselves.
2. Confirm the email address they actually used. Not the one they gave you in
   a DM — the one they typed into the signup form. A typo here reads exactly
   like "they haven't signed up yet."
3. **Partners tab → Grant classroom access →** their email.
4. Tell them to click **Load sample facility** on their own dashboard. You
   cannot do this for them, and nothing seeds until they do.

## Creating the code

**Partners tab → Create code.**

| Field | Note |
|---|---|
| Code | Becomes `?ref=<code>`. Lowercased, and anything that is not a letter, number or hyphen is stripped. `Raya G.` becomes `rayag`. |
| Trainer name | Used in the ready-to-send message. First name is taken from it. |
| Email | Optional. Not the same as the Classroom grant email and not linked to it. |
| **Commission rate %** | **Defaults to 20.** Type the rate you actually agreed. Nobody is going to catch this later — it is written into `title22_trainers` and read at payout. |
| Trial days | Defaults to 90. Their students get this instead of the standard 30 — and never less than 30. |

The code must be unique. A duplicate surfaces the raw Postgres unique-violation
message in the error line — ugly, but it did not create anything.

You get a copy-ready message back. Send that, not a bare link: it explains the
longer trial, which is the part that makes the link worth sharing.

## What the link actually does

1. Visitor lands on `https://title22.app/?ref=<code>`.
2. The code goes into `sessionStorage.title22_ref`, and
   `title22_check_trainer_code` is called to fetch the trial length. **If that
   call fails the signup still works** — they just get the default 30 days
   instead of 90. Silent by design.
3. On signup the code rides in `user_metadata.referred_by`, which survives the
   Google OAuth redirect.
4. `ensureProfile` writes `profiles.referred_by` on first login.
5. `title22_trainer_signups()` joins on it. Classroom (`edu`) accounts are
   excluded from the paid count on purpose — see
   `migrations/2026-08-19_title22_trainer_paid_count_excludes_edu.sql`.

**The link is reusable and permanent.** One code per trainer, not per class.

## Failure modes, and what each one means

| Symptom | Cause |
|---|---|
| "No account found for \<email\>" | They have not signed up, or the email differs from the one they signed up with. Not a bug. |
| "not authorized" on Create code | Your profile lacks `title22_is_partner_admin`. Set it in the database; the Partners tab is Owner-only and reads the same flag. |
| "Partner report unavailable" | `migrations/2026-08-03_title22_trainers.sql` has not been run. |
| Referred signup got 30 days, not 90 | `title22_check_trainer_code` failed or the code does not exist. Check the code was created BEFORE the link was shared. |
| Signup does not appear under their code | `profiles.referred_by` was not written. Most likely they already had a profile — the upsert uses `ignoreDuplicates`, so an existing row is never re-stamped. Referral capture only works for a genuinely new account. |
| They see no MAR in the sample facility | The MAR is on only for plan `edu` **standing in the sample facility**. Their own real facility correctly has no MAR. That is not a bug — see the `showMAR` section in CLAUDE.md. |

## What they see, so you can say it accurately

A Classroom account gets the sample facility only: **eight invented residents
and a practice MAR**. The roster is fixed — add, edit and delete are refused at
the function, not just hidden, so there is no field to type a real name into.
Written up in `docs/classroom-practice-mar.md`.

Say that plainly to a trainer. "You can practise charting on it, and you cannot
put a real resident in it" is the honest sentence, and it is also the selling
point for a classroom.
