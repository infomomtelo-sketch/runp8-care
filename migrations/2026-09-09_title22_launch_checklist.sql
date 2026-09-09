-- Title22 Launch Hub — "Start Your Home" progress.
--
-- Supabase SQL editor, project title22. Additive and safe to re-run.
--
-- One row per facility per step. NO PHI, and nothing here can hold any: the
-- twelve steps are about the applicant, the building and the licence, there is
-- no resident column and no free-text column at all. `photo_path` points at an
-- object in the existing `facility-documents` bucket, under the same
-- <facility_id>/<uuid>.<ext> shape every other upload in the app uses.
--
-- UNTIL THIS HAS RUN the app does not break and does not silently lose the
-- customer's progress: loadLaunchHub sees PGRST205/42P01, falls back to this
-- browser's localStorage, and says so on the page in as many words. That is
-- the direct lesson of public.users — a migration nobody ran, read by code
-- that assumed it had, for two days. Run this, and the fallback stops firing.

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

-- Same question every other facility-scoped table asks, asked the same way:
-- title22_current_facility_role() from 2026-08-13b. Reading is open to anyone
-- with any role on the facility; writing is the administrator's and the
-- supervisor's, which mirrors ROLE_ACCESS in index.html. A caregiver has no
-- business ticking off the owner's licence application.
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
