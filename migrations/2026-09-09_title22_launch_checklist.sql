-- Title22 Launch Hub — "Start Your Home" progress.
--
-- Supabase SQL editor, project title22. Additive and safe to re-run, including
-- after the failed attempt described below.
--
-- One row per facility per step. NO PHI, and nothing here can hold any: the
-- twelve steps are about the applicant, the building and the licence, there is
-- no resident column and no free-text column at all. `photo_path` points at an
-- object in the existing `facility-documents` bucket, under the same
-- <facility_id>/<uuid>.<ext> shape every other upload in the app uses.
--
-- SELF-CONTAINED ON PURPOSE. The first version of this file called
-- public.title22_current_facility_role() in its policies and was refused:
--
--   ERROR: 42883: function public.title22_current_facility_role(uuid) does not exist
--
-- because the migration that defines it — 2026-08-13b_title22_facility_capabilities.sql
-- — has never been run against this database either. That is the same fault as
-- public.users, twice in a week: code written against a migration somebody
-- assumed had been applied. So this file now installs the function it needs,
-- copied VERBATIM from 2026-08-13b so the two definitions cannot drift, with
-- create or replace — running 2026-08-13b later is then a no-op for this
-- function and still installs its second one (title22_has_capability).
--
-- The whole script is one transaction in the Supabase editor, so the failed
-- attempt left nothing behind: no table, no index, no policy. Re-running this
-- from the top is correct.
--
-- UNTIL THIS HAS RUN the app does not break and does not silently lose the
-- customer's progress: loadLaunchHub sees PGRST205/42P01, falls back to this
-- browser's localStorage, and says so on the page in as many words.

-- ---------------------------------------------------------------------------
-- PART 1 — the role helper, verbatim from 2026-08-13b.
--
-- SECURITY DEFINER matters here beyond convenience: these policies read
-- facilities and facility_members, and a policy body runs as the calling user.
-- If either of those tables ever carries RLS of its own, an inline subquery
-- would come back empty and lock out the very member it was meant to admit.
-- Reading them through a definer function takes that whole question off the
-- table.
--
-- Owner OR member, and the owner half is not optional: a facility's creator is
-- public.facilities.user_id and is NOT necessarily a row in facility_members.
-- That solo operator — one person, one house, not open yet — is exactly who
-- the Launch Hub is for, so a membership-only test would lock out its entire
-- audience. Same reasoning as the note in 2026-08-19_documents_rls_check.sql.
-- ---------------------------------------------------------------------------

create or replace function public.title22_current_facility_role(p_facility_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.facilities f
      where f.id = p_facility_id
        and f.user_id = auth.uid()
    ) then 'administrator'
    else (
      select fm.role
      from public.facility_members fm
      where fm.facility_id = p_facility_id
        and fm.user_id = auth.uid()
      limit 1
    )
  end
$$;

grant execute on function public.title22_current_facility_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- PART 2 — the table.
-- ---------------------------------------------------------------------------

create table if not exists public.launch_checklist (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  step_key    text not null,
  done        boolean not null default false,
  photo_path  text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (facility_id, step_key)
);

create index if not exists launch_checklist_facility
  on public.launch_checklist (facility_id);

alter table public.launch_checklist enable row level security;

-- ---------------------------------------------------------------------------
-- PART 3 — policies.
--
-- Reading is open to anyone with any role on the facility; writing is the
-- administrator's and the supervisor's, mirroring ROLE_ACCESS in index.html —
-- a caregiver has no business ticking off the owner's licence application.
--
-- Both INSERT and UPDATE are needed and neither is spare: the app writes with
-- upsert(onConflict:'facility_id,step_key'), which is INSERT .. ON CONFLICT DO
-- UPDATE, and that is refused unless both policies admit it.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='launch_checklist' and policyname='launch_checklist_select') then
    create policy launch_checklist_select on public.launch_checklist
      for select to authenticated
      using (public.title22_current_facility_role(facility_id) is not null);
  end if;

  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='launch_checklist' and policyname='launch_checklist_insert') then
    create policy launch_checklist_insert on public.launch_checklist
      for insert to authenticated
      with check (public.title22_current_facility_role(facility_id) in ('administrator','supervisor'));
  end if;

  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='launch_checklist' and policyname='launch_checklist_update') then
    create policy launch_checklist_update on public.launch_checklist
      for update to authenticated
      using (public.title22_current_facility_role(facility_id) in ('administrator','supervisor'))
      with check (public.title22_current_facility_role(facility_id) in ('administrator','supervisor'));
  end if;

  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='launch_checklist' and policyname='launch_checklist_delete') then
    create policy launch_checklist_delete on public.launch_checklist
      for delete to authenticated
      using (public.title22_current_facility_role(facility_id) in ('administrator','supervisor'));
  end if;
end $$;

grant select, insert, update, delete on public.launch_checklist to authenticated;

-- ---------------------------------------------------------------------------
-- PART 4 — did it work? Run this after the above and read the two rows.
--
-- Expected: has_role_function = t, and policy_count = 4. If you get that, open
-- Start Your Home in the app and the amber "saved on this device only" note
-- should be gone. If the note is still there, the app is still seeing
-- PGRST205 — reload the page once so PostgREST picks up the new table.
-- ---------------------------------------------------------------------------

select
  to_regprocedure('public.title22_current_facility_role(uuid)') is not null as has_role_function,
  to_regclass('public.launch_checklist')                        is not null as has_table;

select count(*) as policy_count
from pg_policies
where schemaname='public' and tablename='launch_checklist';
