-- Title22: give back the trial length that trainer-referred students lost.
--
-- CREATES NOTHING. No table, no column, no function, no policy. It reads
-- title22_trainers and writes exactly one column on exactly the rows that were
-- shortchanged: public.profiles.title22_trial_ends_at.
--
-- Not part of the migration audit (2026-09-10) for that reason — "applied or
-- not" is not a question a data repair answers. Like the guarded test-facility
-- reset, it is run deliberately, once, by a person watching it.
--
-- Run in the Supabase SQL editor for project nwlhsshvqmbhemhxcran.
--
--
-- WHY ANY ROW NEEDS REPAIRING
--
-- The referral and the trial length travelled by different mechanisms, and only
-- one of them survived. `referred_by` rode in user_metadata, set at signUp, and
-- is still there whenever the account is next opened. The trial length rode in
-- sessionStorage alone — and sessionStorage is per TAB. The confirmation email
-- opens a new one, or a different browser entirely if mail is read on a phone.
-- ensureProfile ran there, found referred_by intact and the trial length gone,
-- and `||14` did the rest: correctly attributed to the trainer, stamped with
-- the default trial.
--
-- index.html now resolves the number from the durable code instead
-- (t22RefTrialDays). That fixes every signup from the moment it deploys. It
-- does not touch a row already written, which is what this file is for.
--
--
-- THE RULES IT HOLDS TO
--
--   * Only title22_plan = 'trial'. A paid plan is never touched, and neither
--     is 'edu' — a classroom account's entitlement does not come from here.
--   * Only ever EXTENDS. The new date must be later than the one on the row,
--     so nobody's trial is shortened by running this, and running it twice
--     changes nothing the second time.
--   * Dated from created_at, the day they actually signed up — not from today.
--     A student 20 days into a wrongly-stamped 14-day trial gets the 70 days
--     they have left, not a fresh 90.
--   * Skips a row with no created_at. There is no honest anchor for one: using
--     now() would date the trial from whenever the script happened to be run,
--     and running it twice would push the date out twice. Caught by the test,
--     not by reading it. Those rows are step 3, by hand.
--   * Only codes that are still active. An inactive trainer's students keep
--     what they have.
--
--
-- ============================================================
-- STEP 1 — DRY RUN. Read this before running step 2.
-- ============================================================
-- Shows every row that would change and by how much. If it returns no rows,
-- nothing was shortchanged and there is nothing to do.

select
  p.id                                         as profile_id,
  p.referred_by                                as trainer_code,
  t.name                                       as trainer,
  t.trial_days                                 as should_have_had,
  p.created_at::date                           as signed_up,
  p.title22_trial_ends_at::date                as trial_ends_now,
  (p.created_at + make_interval(days => t.trial_days))::date
                                               as trial_would_end,
  round(extract(epoch from
    (p.title22_trial_ends_at - p.created_at)) / 86400)::int
                                               as days_granted,
  round(extract(epoch from
    ((p.created_at + make_interval(days => t.trial_days))
     - p.title22_trial_ends_at)) / 86400)::int as days_owed,
  case when p.title22_trial_ends_at < now() then 'EXPIRED — locked out now'
       else 'still running' end                as state
from public.profiles p
join public.title22_trainers t
  on t.code = lower(trim(p.referred_by))
 and t.active
where p.referred_by is not null
  and p.title22_plan = 'trial'
  and p.title22_trial_ends_at is not null
  and p.created_at is not null          -- see step 3
  -- only where the trainer's length would actually be longer
  and p.title22_trial_ends_at
      < p.created_at + make_interval(days => t.trial_days)
order by state desc, days_owed desc;


-- ============================================================
-- STEP 2 — THE REPAIR. Uncomment and run once step 1 looks right.
-- ============================================================
-- The WHERE clause is identical to step 1's, so it writes exactly the rows you
-- just read and nothing else. greatest() is belt and braces: even if the where
-- clause were wrong, a date could only move forward.
--
-- begin;
--
-- update public.profiles p
--    set title22_trial_ends_at = greatest(
--          p.title22_trial_ends_at,
--          p.created_at + make_interval(days => t.trial_days)
--        )
--   from public.title22_trainers t
--  where t.code = lower(trim(p.referred_by))
--    and t.active
--    and p.referred_by is not null
--    and p.title22_plan = 'trial'
--    and p.title22_trial_ends_at is not null
--    and p.created_at is not null
--    and p.title22_trial_ends_at
--        < p.created_at + make_interval(days => t.trial_days);
--
-- -- Re-run step 1 here. It should come back empty.
-- -- Happy: commit;      Not happy: rollback;
-- commit;


-- ============================================================
-- STEP 3 — the two cases this cannot repair
-- ============================================================
-- (a) A profile with no created_at. Nothing records when they signed up, so
-- there is no date to count 90 days from. Find them, decide a date, set it:
--
--   select id, referred_by, title22_trial_ends_at from public.profiles
--    where referred_by is not null and title22_plan = 'trial'
--      and created_at is null;
--
-- (b) A student whose referral never recorded at all. ensureProfile upserts with
-- ignoreDuplicates, so an account that ALREADY had a profiles row — from
-- another app on this shared Supabase project — is never re-stamped, and
-- referred_by stays null. There is nothing in the database tying them to a
-- trainer, so no query can find them.
--
-- They have to be identified by the trainer and fixed by hand:
--
--   update public.profiles
--      set referred_by = '<the trainer code>',
--          title22_trial_ends_at = greatest(
--            title22_trial_ends_at,
--            coalesce(created_at, now()) + make_interval(days => <trial_days>))
--    where id = '<their auth user id>'
--      and title22_plan = 'trial';
--
-- Case (b) is also why the trainer's signup report can undercount: it joins on
-- referred_by, and a pre-existing account never gets stamped with one.
