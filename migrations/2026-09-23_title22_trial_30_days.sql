-- Give trials that are running NOW the 30 days new signups get.
--
-- From 2026-09-23 a new account is stamped with a 30-day trial
-- (T22_TRIAL_DAYS in index.html). That only happens when
-- profiles.title22_trial_ends_at is NULL, so everyone already on a trial keeps
-- the 14-day end date they were stamped with. This moves it out by 16 days,
-- so they get the same 30 as someone who signs up today.
--
-- DATA ONLY. No DDL, no schema change, no resident table touched. Only the
-- title22_trial_ends_at column of Title22 trial rows — profiles is shared with
-- other apps, and nothing else on it is read or written here.
--
-- Who it touches, and who it deliberately does not:
--   YES  title22_plan = 'trial', trial still running, no trainer referral.
--        Those were stamped 14 days, so +16 makes 30.
--   NO   referred students: they were given the trainer's length (usually 90),
--        already longer than 30.
--   NO   expired trials. Reopening them is a separate decision; see step 3.
--   NO   paid, edu, anything not 'trial'.
--
-- RUN: steps 1 and 2 applied to the live database 2026-09-23, after
-- runp8-care#127 merged, no errors. Nothing here needs running again.
--
-- Run step 1, read it, then step 2. Re-running step 2 is a no-op: its guard
-- (ends within 14 days of now) excludes every row the first run moved.
-- Verified 2026-09-23 on Postgres 16 with five rows — a running 14-day
-- trial, a referred 90-day student, an expired trial, a paid Lite account and
-- a new 30-day trial: step 1 listed only the first, step 2 moved it from 5 to
-- 21 days left (UPDATE 1), a second run gave UPDATE 0, the others unchanged.

-- ── 1. PREVIEW (read only) ────────────────────────────────────────────────────
select u.email,
       p.title22_trial_ends_at                          as ends_now,
       p.title22_trial_ends_at + interval '16 days'     as ends_after,
       ceil(extract(epoch from (p.title22_trial_ends_at - now())) / 86400) as days_left_now
from public.profiles p
join auth.users u on u.id = p.id
where p.title22_plan = 'trial'
  and p.referred_by is null
  and p.title22_trial_ends_at > now()
  and p.title22_trial_ends_at <= now() + interval '14 days'
order by p.title22_trial_ends_at;

-- ── 2. APPLY ──────────────────────────────────────────────────────────────────
-- Uncomment and run once step 1 shows the rows you expect.
--
-- begin;
-- update public.profiles p
--    set title22_trial_ends_at = p.title22_trial_ends_at + interval '16 days'
--  where p.title22_plan = 'trial'
--    and p.referred_by is null
--    and p.title22_trial_ends_at > now()
--    and p.title22_trial_ends_at <= now() + interval '14 days';
-- -- Expect the same row count step 1 returned. If not: rollback;
-- commit;

-- ── 3. OPTIONAL: reopen expired trials for 30 days ───────────────────────────
-- NOT a repair — a win-back decision, and a business one. Most people who
-- tried Title22 before 2026-09-19 met bugs in their first session (see
-- CLAUDE.md), then a 14-day clock ran out on them. Giving them a fresh 30
-- days is the honest thing to put in a "we fixed it, come back" email.
-- Their records were never deleted; expiry is read-only.
--
-- begin;
-- update public.profiles p
--    set title22_trial_ends_at = now() + interval '30 days'
--  where p.title22_plan = 'trial'
--    and p.title22_trial_ends_at <= now();
-- commit;
