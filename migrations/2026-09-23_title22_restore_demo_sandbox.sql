-- Restore the public sandbox (title22.app/?demo=1).
--
-- Reported 2026-09-23 from a phone: "The demo sandbox isn't available right
-- now — start a free trial instead." That message is enterDemoMode() getting
-- no row back from
--     facilities?select=*&is_demo=eq.true&limit=1
-- as the anon role. So one of three things is true, and step 1 says which:
--   a. no facility is flagged is_demo any more (deleted, or never flagged),
--   b. the anon read policy title22_demo_read on facilities is gone,
--   c. anon has lost SELECT on the table.
--
-- The likeliest is (a). migrations/2026-09-08_title22_reset_test_facilities.sql
-- kept "the newest sample home" and did not know about is_demo, so if the
-- sandbox's facility was not the newest sample, a run of it deleted it. That
-- script now refuses to touch an is_demo facility.
--
-- The 30-Day Proof's executive presentation, the site's "See it first" button
-- and /pilot/'s "See the sandbox first" all open this sandbox.

-- ── 1. DIAGNOSE (read only) ──────────────────────────────────────────────────
select 'flagged demo facilities'           as check,
       count(*)::text                      as result
  from public.facilities where is_demo
union all
select 'anon read policy on facilities',
       coalesce(max(policyname), 'MISSING')
  from pg_policies
 where schemaname = 'public' and tablename = 'facilities' and policyname = 'title22_demo_read'
union all
select 'anon can SELECT facilities',
       has_table_privilege('anon', 'public.facilities', 'select')::text
union all
select 'sample homes that could be flagged',
       count(*)::text
  from public.facilities where name ilike '%sample%';

-- Reading it:
--   flagged = 0, policy present, SELECT true  -> (a). Do step 2.
--   policy MISSING                            -> re-run
--       migrations/2026-07-23_title22_demo_tenant.sql (idempotent).
--   SELECT false                              -> grant select on public.facilities to anon;
--   flagged >= 1 and everything else fine     -> the sandbox should load; if it
--       still does not, the problem is not the database. Say so.

-- ── 2. PICK A SAMPLE HOME TO BE THE SANDBOX (read only) ──────────────────────
-- Only ever a SAMPLE facility: whatever is flagged here is readable by anyone
-- on the internet, with its staff, checklist and incidents. The sample homes
-- are seeded by the app with invented people ("Load sample facility" /
-- "Show me around"). Never flag a real home.
select f.id, f.name, u.email as owner, f.created_at,
       (select count(*) from public.staff s where s.facility_id = f.id)            as staff,
       (select count(*) from public.compliance_tasks t where t.facility_id = f.id) as tasks,
       (select count(*) from public.incidents i where i.facility_id = f.id)        as incidents
  from public.facilities f
  join auth.users u on u.id = f.user_id
 where f.name ilike '%sample%'
 order by (select count(*) from public.compliance_tasks t where t.facility_id = f.id) desc,
          f.created_at desc;

-- Choose one with staff > 0 and tasks > 0 — ideally one owned by your own
-- account, so nobody else can edit what the public sees.

-- ── 3. FLAG IT ────────────────────────────────────────────────────────────────
-- Paste the id from step 2. The name guard means a real facility can never be
-- flagged by a mistyped id.
--
-- update public.facilities
--    set is_demo = true
--  where id = 'PASTE-THE-ID-HERE'
--    and name ilike '%sample%';
--
-- Expect UPDATE 1. Then open https://title22.app/?demo=1&tour=0 on a phone.
