-- Voiding a MAR entry, and the In-House Caregiver role.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and safe to
-- re-run.
--
-- ================================================================
-- Part 1 — a MAR entry can be wrong, and today nothing can be done
-- ================================================================
--
-- mar_entries is insert-only in the app: no update path, no delete path. A
-- dose logged against the wrong resident, or marked given when it was refused,
-- stays on the record exactly as typed, forever.
--
-- Deleting it is not the answer. A medication administration record is the
-- document an inspector reads to decide whether a resident got their
-- medication, and a row that quietly disappears from it is the single worst
-- thing that can happen to that document. Standard practice on paper is to
-- rule a line through the entry, initial it, write the reason, and make the
-- correct entry beside it — the wrong one stays visible.
--
-- These columns are that line through the entry. The row is never removed and
-- never rewritten; it is marked void, by whom, when, and why, and the correct
-- entry is added as a new row.

alter table public.mar_entries
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid,
  add column if not exists void_reason text;

comment on column public.mar_entries.void_reason is
  'Why this entry was struck. Required when voided_at is set — an unexplained void is no better than a deletion.';

-- Partial index: voided entries are the rare case, and every screen that
-- counts doses has to exclude them.
create index if not exists mar_entries_voided_idx
  on public.mar_entries (facility_id, voided_at)
  where voided_at is not null;

-- ================================================================
-- Part 2 — the In-House Caregiver role
-- ================================================================
--
-- A lead who runs the floor: resident records and their documents, adds newly
-- arrived medications, works the monthly MAR and voids wrong entries. Not
-- staff files, not facility settings, not billing, not the team list.
--
-- If facility_members.role or facility_invites.role carries a CHECK
-- constraint listing the old four roles, an invitation for this role is
-- rejected by the database with a constraint error and no amount of app code
-- helps. These blocks find such a constraint and widen it, and do nothing at
-- all when there is none.

do $$
declare r record;
begin
  for r in
    select c.conname, t.relname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname in ('facility_members','facility_invites')
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%role%'
       and pg_get_constraintdef(c.oid) ilike '%caregiver%'
       and pg_get_constraintdef(c.oid) not ilike '%in_house_caregiver%'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
    execute format(
      'alter table public.%I add constraint %I check (role in (''administrator'',''supervisor'',''in_house_caregiver'',''caregiver'',''readonly''))',
      r.relname, r.conname);
    raise notice 'widened % on % to allow in_house_caregiver', r.conname, r.relname;
  end loop;
end $$;

-- Nothing here changes an existing member's role. Everyone stays exactly what
-- they were; in_house_caregiver only becomes available to pick.
