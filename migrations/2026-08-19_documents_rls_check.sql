-- Diagnostic for public.documents access. READ-ONLY down to PART 3.
--
-- public.documents was created outside this repo, so its RLS policies are not
-- visible here and have to be read out of the database. Run PART 1, look at
-- what comes back, and only then decide whether PART 3 is needed.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran.

-- ---------------------------------------------------------------------------
-- PART 1 — what is actually there. Read-only.
-- ---------------------------------------------------------------------------

-- Is RLS switched on at all? rowsecurity = false means every authenticated
-- user can read every facility's documents, which is worse than a blocked
-- insert and should be fixed first.
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where oid = 'public.documents'::regclass;

-- The policies themselves. Expect at least one each for select and insert.
select policyname, cmd, permissive, roles, qual as using_expr, with_check
from pg_policies
where schemaname = 'public' and tablename = 'documents'
order by cmd, policyname;

-- Which columns exist. The app writes staff_id and source (migration
-- 2026-08-09), issued_at and expires_at (2026-08-09b), and training_id
-- (2026-08-09b). A missing column shows up as a failed upload with the
-- migration named in the alert, not as a silent loss.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'documents'
order by ordinal_position;

-- ---------------------------------------------------------------------------
-- PART 2 — does a write actually go through, as you? Read-only in effect:
-- the insert is rolled back, so nothing is left behind either way.
-- Run this from the SQL editor while signed in as the account that saw the
-- problem, and substitute a facility id you can really see.
-- ---------------------------------------------------------------------------

-- begin;
-- insert into public.documents
--   (facility_id, staff_id, resident_id, doc_type, title, file_name,
--    storage_path, mime_type, size_bytes, uploaded_by, source)
-- values
--   ('00000000-0000-0000-0000-000000000000'::uuid,  -- <- a real facility id
--    null, null, 'tb_test', 'rls probe', 'rls probe.pdf',
--    'rls-probe/never-uploaded.pdf', 'application/pdf', 1, auth.uid(), 'upload');
-- rollback;

-- ---------------------------------------------------------------------------
-- PART 3 — policies, only if PART 1 showed none and PART 2 was refused.
-- Idempotent. Nothing here drops or narrows an existing policy.
--
-- The membership test is deliberately owner OR member: a facility's creator is
-- in public.facilities.user_id and is NOT necessarily in facility_members, so
-- a policy written against facility_members alone locks out exactly the solo
-- operator most likely to be testing this. Both halves mirror loadApp() in
-- index.html, which builds the facility list from the same two sources.
--
-- Note the column is facility_members.user_id. There is no profile_id column
-- on that table.
-- ---------------------------------------------------------------------------

-- alter table public.documents enable row level security;
--
-- create or replace function public.title22_visible_facility_ids()
-- returns setof uuid
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select f.id from public.facilities f where f.user_id = auth.uid()
--   union
--   select fm.facility_id from public.facility_members fm where fm.user_id = auth.uid()
-- $$;
--
-- grant execute on function public.title22_visible_facility_ids() to authenticated;
--
-- do $$
-- begin
--   if not exists (select 1 from pg_policies where schemaname='public'
--                  and tablename='documents' and policyname='documents_select_own_facilities') then
--     create policy documents_select_own_facilities on public.documents
--       for select to authenticated
--       using (facility_id in (select public.title22_visible_facility_ids()));
--   end if;
--
--   if not exists (select 1 from pg_policies where schemaname='public'
--                  and tablename='documents' and policyname='documents_insert_own_facilities') then
--     create policy documents_insert_own_facilities on public.documents
--       for insert to authenticated
--       with check (facility_id in (select public.title22_visible_facility_ids()));
--   end if;
--
--   if not exists (select 1 from pg_policies where schemaname='public'
--                  and tablename='documents' and policyname='documents_delete_own_facilities') then
--     create policy documents_delete_own_facilities on public.documents
--       for delete to authenticated
--       using (facility_id in (select public.title22_visible_facility_ids()));
--   end if;
-- end $$;
