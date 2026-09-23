-- Make stored referral codes match the codes they refer to.
--
-- RUN 2026-09-23, steps 1 and 2, no errors (reported by the owner; row count
-- not recorded). Safe to re-run: a second run matches no rows.
--
-- The payout report (title22_trainer_signups) joins
--   profiles.referred_by = title22_trainers.code
-- EXACTLY. title22_create_trainer stores codes lowercase, with only letters,
-- digits and hyphens. Until 2026-09-23 the app saved ?ref= as typed, so a
-- signup through ?ref=JSmith got the trainer's trial length (the trial lookup
-- lowercases) but was then missing from that trainer's signup count.
--
-- The app normalises on the way in now. This fixes rows written before that.
--
-- DATA ONLY. One column, profiles.referred_by, on rows that already have one.
-- Nothing else on profiles is read or written; profiles is shared with other
-- apps. Safe to re-run: a second run matches no rows.
--
-- Verified on Postgres 16 with seven rows (jsmith, JSmith, ' Oak-Hill ',
-- 'oak hill', null, '!!!', maria): step 1 listed the four that needed it,
-- step 2 gave UPDATE 4 and a second run UPDATE 0; the payout join went from
-- jsmith 1 / oak-hill 0 to jsmith 2 / oak-hill 1. '!!!' becomes null.
-- 'oak hill' becomes 'oakhill', not 'oak-hill': a space is not a hyphen, and
-- guessing would credit the wrong partner.

-- ── 1. PREVIEW (read only) ────────────────────────────────────────────────────
-- Every stored code that the payout join cannot match as written, and what it
-- becomes. `matches_a_trainer` says whether the fixed value is a real code.
select p.referred_by                                              as stored,
       lower(regexp_replace(trim(p.referred_by), '[^a-zA-Z0-9-]', '', 'g')) as becomes,
       exists (select 1 from public.title22_trainers t
                where t.code = lower(regexp_replace(trim(p.referred_by), '[^a-zA-Z0-9-]', '', 'g')))
                                                                  as matches_a_trainer,
       count(*)                                                   as signups
from public.profiles p
where p.referred_by is not null
  and p.referred_by <> lower(regexp_replace(trim(p.referred_by), '[^a-zA-Z0-9-]', '', 'g'))
group by 1, 2, 3
order by signups desc;

-- ── 2. APPLY ──────────────────────────────────────────────────────────────────
-- Run after step 1 looks right. Expect the total of step 1's "signups" column.
--
-- update public.profiles p
--    set referred_by = nullif(lower(regexp_replace(trim(p.referred_by), '[^a-zA-Z0-9-]', '', 'g')), '')
--  where p.referred_by is not null
--    and p.referred_by <> lower(regexp_replace(trim(p.referred_by), '[^a-zA-Z0-9-]', '', 'g'));
