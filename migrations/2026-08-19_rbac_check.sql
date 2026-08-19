-- Who can actually read what. READ-ONLY.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Run it whole and
-- screenshot the result.
--
-- Why this matters more than the app's roles: index.html talks to Postgres
-- directly with the signed-in user's own JWT. ROLE_ACCESS, canEdit(),
-- canDelete() and the hidden nav items are all client-side — they decide what
-- is drawn, not what the database will hand over. Anyone can open devtools and
-- set currentUserRole, or skip the app entirely and call the REST endpoint
-- with their own token.
--
-- So the real boundary is row level security. RLS off on a table holding
-- facility data means every signed-in account on this project can read every
-- facility's rows, whatever the interface shows them.
--
-- None of these tables are created by anything in migrations/, so their
-- policies cannot be read from the repo.

-- PART 1 — is row level security on, and is anything actually written?
select
  c.relname                                   as table_name,
  case when c.relrowsecurity then 'on'
       else 'OFF — any signed-in account can read every facility' end as row_level_security,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)        as policies,
  case when c.relrowsecurity
        and (select count(*) from pg_policies p
              where p.schemaname = 'public' and p.tablename = c.relname) = 0
       then 'RLS on with no policies — denies everyone, including the owner'
       else '' end                                                    as note
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relname in (
    'facilities','facility_members','facility_invites',
    'residents','staff','medications','mar_entries','incidents',
    'daily_logs','staff_trainings','compliance_tasks','documents',
    'audit_log','profiles','checklist_items','title22_trainers','events'
  )
order by c.relrowsecurity, c.relname;

-- PART 2 — policies that let everyone through. A policy whose USING clause is
-- just `true` is RLS switched on and then waved past: the table reports as
-- protected in Part 1 while every row is still readable by any signed-in
-- account. Anything listed here is worth a second look.
select tablename, policyname, cmd, roles::text as granted_to,
       coalesce(qual, '(none)')       as using_expr,
       coalesce(with_check, '(none)') as with_check
from pg_policies
where schemaname = 'public'
  and (qual in ('true','(true)') or with_check in ('true','(true)'))
order by tablename, policyname;

-- PART 3 — the invitation table specifically. A pending invitation carries a
-- role, and redeeming one writes a facility_members row. If facility_invites
-- can be read by anyone, the tokens can be harvested; if facility_members can
-- be written freely, membership can be granted without an invitation at all.
select tablename, policyname, cmd, roles::text as granted_to,
       coalesce(qual, '(none)')       as using_expr,
       coalesce(with_check, '(none)') as with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('facility_invites','facility_members')
order by tablename, cmd, policyname;
