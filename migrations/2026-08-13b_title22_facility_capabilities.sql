-- Title22 facility capability system (Section 7 / Section 87 compliance roles).
-- Additive and idempotent. Run after 2026-08-13_title22_profile_photo_url.sql.
--
-- Capability model
-- ────────────────
-- Each authenticated user has a role within a facility via facility_members.role.
-- Valid roles: administrator, supervisor, caregiver, readonly.
-- title22_current_facility_role(p_facility_id) returns the caller's role string.
-- title22_has_capability(p_facility_id, p_capability) returns boolean.
--
-- Role matrix
-- ┌──────────────────┬───────────────┬────────────┬──────────┬──────────┐
-- │ capability       │ administrator │ supervisor │ caregiver│ readonly │
-- ├──────────────────┼───────────────┼────────────┼──────────┼──────────┤
-- │ facility.view    │ ✓             │ ✓          │ ✓        │ ✓        │
-- │ facility.edit    │ ✓             │            │          │          │
-- │ resident.read    │ ✓             │ ✓          │ ✓        │ ✓        │
-- │ resident.edit    │ ✓             │ ✓          │          │          │
-- │ resident.delete  │ ✓             │            │          │          │
-- │ document.upload  │ ✓             │ ✓          │ ✓        │          │
-- │ document.read    │ ✓             │ ✓          │ ✓        │ ✓        │
-- │ medication.log   │ ✓             │ ✓          │ ✓        │          │
-- │ medication.manage│ ✓             │ ✓          │          │          │
-- │ team.manage      │ ✓             │            │          │          │
-- └──────────────────┴───────────────┴────────────┴──────────┴──────────┘
--
-- Facility owners (facilities.user_id = auth.uid()) always pass every check.

-- ── Helper: current role ─────────────────────────────────────────────────────

create or replace function public.title22_current_facility_role(
  p_facility_id uuid
) returns text
language sql stable security definer set search_path = public as $$
  select fm.role
  from   public.facility_members fm
  where  fm.facility_id = p_facility_id
    and  fm.user_id     = auth.uid()
  limit  1;
$$;

-- ── Main gate ────────────────────────────────────────────────────────────────

create or replace function public.title22_has_capability(
  p_facility_id  uuid,
  p_capability   text
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
begin
  -- Facility owner always passes.
  if exists (
    select 1 from public.facilities
    where id = p_facility_id and user_id = auth.uid()
  ) then
    return true;
  end if;

  v_role := public.title22_current_facility_role(p_facility_id);

  return case p_capability
    when 'facility.view'     then v_role in ('administrator','supervisor','caregiver','readonly')
    when 'facility.edit'     then v_role in ('administrator')
    when 'resident.read'     then v_role in ('administrator','supervisor','caregiver','readonly')
    when 'resident.edit'     then v_role in ('administrator','supervisor')
    when 'resident.delete'   then v_role in ('administrator')
    when 'document.read'     then v_role in ('administrator','supervisor','caregiver','readonly')
    when 'document.upload'   then v_role in ('administrator','supervisor','caregiver')
    when 'medication.log'    then v_role in ('administrator','supervisor','caregiver')
    when 'medication.manage' then v_role in ('administrator','supervisor')
    when 'team.manage'       then v_role in ('administrator')
    else false
  end;
end;
$$;

-- ── RLS: mar_entries ─────────────────────────────────────────────────────────
-- Drop stale policies that exist in production before re-creating them.

alter table public.mar_entries enable row level security;

drop policy if exists "Users can manage mar entries"  on public.mar_entries;
drop policy if exists "mar_entries_staff_only"        on public.mar_entries;
drop policy if exists "owner_mar"                     on public.mar_entries;

-- SELECT: facility members can read their own facility's MAR.
create policy mar_entries_select on public.mar_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = mar_entries.facility_id
        and (
          f.user_id = auth.uid()
          or public.title22_has_capability(f.id, 'resident.read')
        )
    )
  );

-- INSERT: staff can only log entries for their own facility and sign as themselves.
create policy mar_entries_insert on public.mar_entries
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and public.title22_has_capability(facility_id, 'medication.log')
  );

-- UPDATE/DELETE: facility owner only (corrections must be auditable).
-- INSERT is intentionally excluded here; owners inserting must still sign as
-- themselves via mar_entries_insert (staff_id = auth.uid()).
create policy mar_entries_owner_write on public.mar_entries
  for update to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = mar_entries.facility_id and f.user_id = auth.uid()
    )
  );

create policy mar_entries_owner_delete on public.mar_entries
  for delete to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = mar_entries.facility_id and f.user_id = auth.uid()
    )
  );

-- ── RLS: medications ─────────────────────────────────────────────────────────

alter table public.medications enable row level security;

drop policy if exists "Users manage medications for own facilities" on public.medications;
drop policy if exists "owner_medications"                           on public.medications;

create policy medications_select on public.medications
  for select to authenticated
  using (public.title22_has_capability(facility_id, 'resident.read'));

create policy medications_insert on public.medications
  for insert to authenticated
  with check (public.title22_has_capability(facility_id, 'medication.manage'));

create policy medications_update on public.medications
  for update to authenticated
  using  (public.title22_has_capability(facility_id, 'medication.manage'))
  with check (public.title22_has_capability(facility_id, 'medication.manage'));

create policy medications_delete on public.medications
  for delete to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = medications.facility_id and f.user_id = auth.uid()
    )
  );

-- ── RLS: residents ────────────────────────────────────────────────────────────

alter table public.residents enable row level security;

drop policy if exists "Users manage own facility residents" on public.residents;
drop policy if exists "owner_residents"                     on public.residents;

create policy residents_select on public.residents
  for select to authenticated
  using (public.title22_has_capability(facility_id, 'resident.read'));

create policy residents_insert on public.residents
  for insert to authenticated
  with check (public.title22_has_capability(facility_id, 'resident.edit'));

create policy residents_update on public.residents
  for update to authenticated
  using  (public.title22_has_capability(facility_id, 'resident.edit'))
  with check (public.title22_has_capability(facility_id, 'resident.edit'));

create policy residents_delete on public.residents
  for delete to authenticated
  using (public.title22_has_capability(facility_id, 'resident.delete'));

-- ── RLS: staff ────────────────────────────────────────────────────────────────

alter table public.staff enable row level security;

drop policy if exists "Users manage own facility staff" on public.staff;
drop policy if exists "owner_staff"                      on public.staff;

create policy staff_select on public.staff
  for select to authenticated
  using (public.title22_has_capability(facility_id, 'facility.view'));

create policy staff_insert on public.staff
  for insert to authenticated
  with check (public.title22_has_capability(facility_id, 'team.manage'));

create policy staff_update on public.staff
  for update to authenticated
  using  (public.title22_has_capability(facility_id, 'team.manage'))
  with check (public.title22_has_capability(facility_id, 'team.manage'));

create policy staff_delete on public.staff
  for delete to authenticated
  using (public.title22_has_capability(facility_id, 'team.manage'));

-- ── RLS: subscriptions ───────────────────────────────────────────────────────
-- SELECT: facility owner or the row's own user_id.
-- INSERT/UPDATE/DELETE: only the stripe-webhook service role (server-side);
-- the authenticated role is explicitly excluded to prevent self-promotion.

alter table public.subscriptions enable row level security;

drop policy if exists "owner_subscriptions" on public.subscriptions;

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.facilities f
      where f.user_id = auth.uid()
        and f.id = (subscriptions.metadata->>'facility_id')::uuid
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated — service role only.
