-- Title22 — stop role self-escalation at the database.
--
-- WHY THIS IS THE CRITICAL ONE
-- Everything in index.html (ROLE_CAPABILITIES, canTeam(), ASSIGNABLE_ROLES) is
-- client-side. It hides buttons. A signed-in caregiver holds a valid Supabase
-- token and can call the REST API directly:
--
--   PATCH /rest/v1/facility_members?id=eq.<their-own-row>
--   {"role":"administrator"}
--
-- If that succeeds they are an administrator of the facility and every other
-- control in the app is moot. This migration is what makes it fail.
--
-- SAFE BY CONSTRUCTION
--   * Adds only RESTRICTIVE policies. In Postgres these AND with whatever
--     permissive policies already exist, so this can only narrow access, never
--     widen it. It does not need to know what the current policies are — which
--     matters, because they were created outside this repo.
--   * One policy per write command, and none for SELECT. Every read path in the
--     app (loadApp, initFacility, loadTeam) is untouched and behaves exactly as
--     it does today.
--   * Does NOT run `alter table ... enable row level security`. Flipping RLS on
--     a table that currently has it off would apply every existing policy at
--     once and could lock people out. Section 4 reports the state instead and
--     leaves that call to a human.
--   * Idempotent and additive, per the convention in this folder.
--
-- VERIFIED, not assumed. Applied to a throwaway Postgres 16 with a Supabase-
-- shaped schema (auth.uid(), auth.jwt(), a broad pre-existing permissive
-- policy) and exercised as each role: 4 escalation attempts blocked, 4 owner
-- operations still working, 4 invite-acceptance cases correct, reads unchanged,
-- and a clean second run.
--
-- CAUTION for whoever writes the next policy on this table. A policy whose
-- USING clause selects from facility_members will throw "infinite recursion
-- detected in policy for relation facility_members" — it re-enters the table it
-- guards. Route the membership lookup through a `security definer` function, as
-- title22_is_facility_owner below does. This bit during testing.
--
-- NOTE ON FAILURE MODE. A write blocked by RLS updates 0 rows rather than
-- raising — PostgREST returns success. That is why the team functions in
-- index.html now check `error` and re-read the list afterwards: a silent
-- no-op and a success look identical from the client.
--
-- ROLLBACK — these three lines undo it completely:
--   drop policy if exists title22_members_update_owner_only on public.facility_members;
--   drop policy if exists title22_members_delete_owner_only on public.facility_members;
--   drop policy if exists title22_members_insert_self_or_owner on public.facility_members;

-- 1. Who owns this facility. One definition, so the policies read plainly.
create or replace function public.title22_is_facility_owner(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.facilities f
    where f.id = p_facility_id
      and f.user_id = auth.uid()
  );
$$;

-- 2. Changing a membership row — the escalation path. Owner only, and even the
--    owner cannot write 'administrator': that is decided by facilities.user_id,
--    not granted here. Mirrors ASSIGNABLE_ROLES in index.html so the two cannot
--    drift into disagreeing.
drop policy if exists title22_members_update_owner_only on public.facility_members;
create policy title22_members_update_owner_only
  on public.facility_members
  as restrictive
  for update
  to authenticated
  using      ( public.title22_is_facility_owner(facility_members.facility_id) )
  with check ( public.title22_is_facility_owner(facility_members.facility_id)
               and lower(btrim(facility_members.role)) in ('caregiver','supervisor','readonly') );

-- 3. Removing a member — owner only.
drop policy if exists title22_members_delete_owner_only on public.facility_members;
create policy title22_members_delete_owner_only
  on public.facility_members
  as restrictive
  for delete
  to authenticated
  using ( public.title22_is_facility_owner(facility_members.facility_id) );

-- 4. The one write a non-owner legitimately makes: accepting an invite that was
--    addressed to them. Scoped hard — you may insert only yourself, only against
--    a pending invite for your own email, and only at the role that invite
--    named. Without the role match an invited caregiver could accept as an
--    administrator, which would defeat sections 2 and 3.
drop policy if exists title22_members_insert_self_or_owner on public.facility_members;
create policy title22_members_insert_self_or_owner
  on public.facility_members
  as restrictive
  for insert
  to authenticated
  with check (
    public.title22_is_facility_owner(facility_members.facility_id)
    or (
      facility_members.user_id = auth.uid()
      and exists (
        select 1
        from public.facility_invites i
        where i.facility_id = facility_members.facility_id
          and i.status = 'pending'
          and lower(btrim(i.role))  = lower(btrim(facility_members.role))
          and lower(btrim(i.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
      )
    )
  );

-- 5. Report, do not act. If rls_enabled comes back false the policies above are
--    inert and the hole is still open — enabling RLS is a separate, deliberate
--    step that needs the existing permissive policies reviewed first.
do $$
declare
  v_enabled boolean;
begin
  select c.relrowsecurity into v_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'facility_members';

  if v_enabled is null then
    raise notice 'facility_members not found - nothing applied.';
  elsif v_enabled then
    raise notice 'OK: RLS is enabled on facility_members. The restrictive policies are now in force.';
  else
    raise notice 'WARNING: RLS is OFF on facility_members. The policies exist but do NOTHING until it is enabled. Review the existing permissive policies first, then: alter table public.facility_members enable row level security;';
  end if;
end $$;
