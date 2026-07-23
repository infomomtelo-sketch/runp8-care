-- Title22 demo tenant (Section 7): read-only, no-auth sandbox backing the
-- marketing site's "Try the sandbox" CTA (title22.app/?demo=1).
-- Additive and idempotent.
--
-- Model: facilities flagged is_demo=true (and their child rows) become
-- SELECT-able by the anon role. Nothing grants anon INSERT/UPDATE/DELETE,
-- so the sandbox is read-only at the database level regardless of UI state.
-- (Supabase grants table privileges to anon by default; RLS is the gate. If
-- your project revoked anon SELECT grants, re-grant SELECT on these tables.)

alter table public.facilities add column if not exists is_demo boolean not null default false;

drop policy if exists title22_demo_read on public.facilities;
create policy title22_demo_read on public.facilities
  for select to anon using (is_demo);

do $$
declare t text;
begin
  foreach t in array array['residents','staff','medications','mar_entries','incidents','daily_logs','staff_trainings','compliance_tasks'] loop
    execute format('drop policy if exists title22_demo_read on public.%I', t);
    execute format(
      'create policy title22_demo_read on public.%I for select to anon using (exists (select 1 from public.facilities f where f.id = %I.facility_id and f.is_demo))',
      t, t);
  end loop;
end $$;

-- checklist_items is shared reference data (Title 22 requirement templates).
drop policy if exists title22_demo_read on public.checklist_items;
create policy title22_demo_read on public.checklist_items
  for select to anon using (true);

-- After running this migration, create the sandbox content with the in-app
-- "Load demo data" action (Facility tab), then flag that facility:
--   update public.facilities set is_demo = true
--   where name = 'Sunrise Demo Home (Sample)' and user_id = '<your admin uuid>';
