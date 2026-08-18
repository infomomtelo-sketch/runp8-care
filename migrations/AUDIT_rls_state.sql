-- AUDIT ONLY — this file changes nothing.
--
-- Not a migration. Do not treat it as one: it creates, alters and drops
-- nothing, and is safe to run against production at any time. It exists
-- because the RLS policies for the core tables were created outside this repo
-- (same as public.documents, see CLAUDE.md), so nobody reading this codebase
-- can tell what the database actually enforces.
--
-- The app's role system (ROLE_CAPABILITIES / ROLE_TABS in index.html) is
-- client-side only. It hides buttons. It cannot stop anyone who opens the
-- browser console or calls the Supabase REST API with their own login token.
-- Whether a caregiver can actually read every resident record in their
-- facility is decided entirely by what this query returns.
--
-- Run it in the Supabase SQL editor and keep the output. Section 3 is the
-- answer to "is RBAC real?".

-- 1. Which of our tables have RLS switched on at all.
--    rls_enabled = false means the table is wide open to any signed-in user,
--    whatever the app UI shows.
select
  c.relname                                as table_name,
  c.relrowsecurity                         as rls_enabled,
  c.relforcerowsecurity                    as rls_forced,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'facilities','facility_members','facility_invites','residents','staff',
    'staff_trainings','medications','mar_entries','incidents','daily_logs',
    'checklist_items','compliance_tasks','documents','audit_log','profiles','events'
  )
order by c.relrowsecurity asc, c.relname;

-- 2. Every policy on those tables, in full.
--    Look for any mention of facility_members.role or
--    title22_current_facility_role(). If no policy references a role, then the
--    database does not distinguish a caregiver from an administrator — the
--    only thing separating them is the UI.
select
  tablename,
  policyname,
  cmd            as applies_to,
  roles          as granted_to,
  qual           as using_expression,
  with_check     as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'facilities','facility_members','facility_invites','residents','staff',
    'staff_trainings','medications','mar_entries','incidents','daily_logs',
    'checklist_items','compliance_tasks','documents','audit_log'
  )
order by tablename, cmd, policyname;

-- 3. The summary line. This is the question that matters.
select
  count(*) filter (where qual ilike '%role%' or with_check ilike '%role%')
    as policies_that_mention_a_role,
  count(*) as policies_total
from pg_policies
where schemaname = 'public'
  and tablename in (
    'residents','staff','medications','mar_entries','incidents','daily_logs',
    'staff_trainings','documents'
  );

-- 4. Does the SQL role helper from 2026-08-13b actually exist in this project?
--    index.html's restored permission layer was built expecting it.
select
  p.proname       as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'title22%'
order by p.proname;
