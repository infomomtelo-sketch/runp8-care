-- Title22 document slots: let a stored document belong to a staff member, and
-- name the document types a staff file actually contains.
--
-- Why: every "on file?" control in the app is a self-reported yes/no. A facility
-- can mark LIC 601, LIC 602 and ISP as "Yes" with nothing behind them and score
-- 100% on the compliance dashboard. DSS does not want the claim, it wants the
-- document. This migration is the first step toward those flags being derived
-- from a document that actually exists.
--
-- Additive and idempotent. Safe to re-run. Nothing is dropped or rewritten.
--
-- NOTE: public.documents was created outside this repo, so its RLS policies are
-- not visible here. This migration assumes they are facility-scoped (gating on
-- facility_id) rather than column-enumerated — which is what the existing client
-- upload path implies, since it already inserts rows from the browser. If any
-- policy enumerates columns, add staff_id to it as well or inserts carrying a
-- staff_id will be rejected.

-- 1. Attach a document to a staff member ------------------------------------
--
-- ON DELETE SET NULL, not CASCADE: a departed employee's TB clearance is still
-- a record the facility may have to produce. Deleting the person should not
-- destroy the evidence — the file survives, unattached.

alter table public.documents
  add column if not exists staff_id uuid references public.staff(id) on delete set null;

create index if not exists documents_facility_staff_idx
  on public.documents (facility_id, staff_id)
  where staff_id is not null;

comment on column public.documents.staff_id is
  'Staff member this document belongs to. Mutually exclusive with resident_id in practice, but not enforced — a training roster could legitimately reference both.';

-- 2. Allow the staff-side document types ------------------------------------
--
-- The existing type list is resident-shaped (lic601, lic602, lic602a,
-- physician_report, cert, isp, other); the only fit for a staff file was the
-- generic 'cert'. Under audit an inspector asks for TB clearances specifically,
-- so an undifferentiated pile of "Certificate" is close to useless.
--
-- doc_type may or may not carry a CHECK constraint — it was created outside
-- this repo. This finds any check constraint on the column and replaces it with
-- one covering both the old and new values. If there is no constraint, nothing
-- happens and the new values are already accepted.

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'documents'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%doc_type%'
  loop
    execute format('alter table public.documents drop constraint %I', con.conname);
  end loop;

  alter table public.documents
    add constraint documents_doc_type_check check (doc_type in (
      -- resident-side (unchanged)
      'lic601', 'lic602', 'lic602a', 'physician_report', 'isp',
      -- staff-side (new)
      'tb_test', 'cpr_card', 'first_aid', 'livescan', 'training_cert',
      -- generic
      'cert', 'other'
    ));
end $$;

-- 3. Record how a document arrived -------------------------------------------
--
-- Distinguishes a photo or PDF captured through Scan to fill from a manual
-- upload. Useful for telling a caregiver where a file came from, and for
-- measuring whether the scan path is actually being used.

alter table public.documents
  add column if not exists source text
  check (source is null or source in ('upload', 'scan'));

comment on column public.documents.source is
  'How the file arrived: ''scan'' via Scan to fill, ''upload'' via the Documents tab. Null for rows predating this column.';
