-- Where the 32 accounts actually stopped.  READ ONLY.
--
-- Written because "they signed up and disappeared" was being explained by
-- theory, and the same habit cost a week on the $29 bug: reasoning about a
-- system instead of reading what it recorded.  This reads what it recorded.
--
-- Every account lands in exactly one bucket, and the bucket names the reason
-- to investigate.  A theory that explains bucket 4 says nothing about bucket 1.
--
-- Paste into the Supabase SQL editor.  Selects only — no writes, no DDL.
-- Safe to re-run.  Nothing here reads a resident table.

-- ── 1. THE FUNNEL ────────────────────────────────────────────────────────────
with acct as (
  select
    p.id,
    p.created_at,
    p.title22_plan,
    p.referred_by,
    p.title22_utm_source,
    (select count(*) from public.facilities f        where f.user_id = p.id)      as facilities,
    (select count(*) from public.staff s
       join public.facilities f on f.id = s.facility_id
      where f.user_id = p.id)                                                     as staff_rows,
    (select count(*) from public.compliance_tasks c
       join public.facilities f on f.id = c.facility_id
      where f.user_id = p.id and c.completed)                                     as tasks_done,
    (select count(*) from public.documents d
       join public.facilities f on f.id = d.facility_id
      where f.user_id = p.id)                                                     as docs,
    (select max(e.created_at) from public.events e   where e.user_id = p.id)      as last_seen
  from public.profiles p
  where p.title22_plan is not null          -- Title22 users only; profiles is shared
),
bucketed as (
  select *,
    case
      when facilities  = 0 then '1. Signed up, never created a facility'
      when staff_rows  = 0 then '2. Facility, but never added a single person'
      when tasks_done  = 0 then '3. Added staff, never ticked one checklist item'
      when tasks_done  < 5 then '4. Started the checklist, stopped early'
      else                      '5. Actually used it'
    end as bucket
  from acct
)
select
  bucket,
  count(*)                                              as accounts,
  count(*) filter (where title22_plan not in
       ('trial','edu'))                                 as paying,
  count(*) filter (where referred_by is not null)       as referred,
  round(avg(tasks_done), 1)                             as avg_tasks_done,
  min(created_at)::date                                 as earliest,
  max(created_at)::date                                 as latest
from bucketed
group by bucket
order by bucket;

-- ── 2. HOW TO READ IT ────────────────────────────────────────────────────────
--
--  Bucket 1 heavy  -> they never SAW the product.  Nothing to do with
--                     administrators feeling judged, or with AI.  It is
--                     curiosity, or the signup promised something the first
--                     screen did not deliver.  Fix the landing page, not the app.
--
--  Bucket 2 heavy  -> the first real data entry was too much.  Onboarding.
--
--  Bucket 3 heavy  -> THIS is the discouragement bucket.  They saw a readiness
--                     score near zero and a screen full of red, and read it as
--                     a grade rather than a to-do list.  This is the one the
--                     "administrator feels threatened" theory explains, and the
--                     one the empty-state colours feed directly.
--
--  Bucket 4 heavy  -> they tried honestly and it was too much work per item.
--
--  Bucket 5 with no paying accounts -> the product works and the PRICE or the
--                     ask is wrong.  A completely different problem.
--
-- The theory only gets to claim the buckets it actually explains.

-- ── 3. THE LIST, so you can email them ───────────────────────────────────────
-- Uncomment.  31 people who tried it is 31 people who might answer
-- "what stopped you?" — which beats any amount of guessing, including mine.
--
-- select p.email, p.created_at::date as joined, p.title22_plan,
--        (select count(*) from public.facilities f where f.user_id = p.id) as facilities,
--        (select count(*) from public.compliance_tasks c
--           join public.facilities f on f.id = c.facility_id
--          where f.user_id = p.id and c.completed) as tasks_done
--   from public.profiles p
--  where p.title22_plan is not null
--  order by p.created_at desc;

-- ── 4. CAVEAT, and it matters ────────────────────────────────────────────────
-- public.events did not exist until 2026-09-10 (see CLAUDE.md, migration
-- audit).  So last_seen is NULL for everyone who came before that date, and
-- nothing was buffered — those events are gone.  The bucketing above does NOT
-- depend on events; it is reconstructed from rows that were always being
-- written.  That is why it works on the historic accounts at all.
