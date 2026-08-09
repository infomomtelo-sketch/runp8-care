-- Title22 document slots, part 2: give a filed document its own dates, and name
-- the one document type the first migration missed.
--
-- Run 2026-08-09_title22_document_slots.sql first. This one is additive and
-- idempotent on top of it; safe to re-run.
--
-- Why: with part 1, a document can belong to a staff member. But the app still
-- reads every expiry from a date a human typed into the staff record. A TB
-- clearance card has a date printed on it — that date should come off the card,
-- not off the honour system. These columns are where it goes, so "expires in 12
-- days" can eventually mean "the document on file says so" rather than "someone
-- typed that in March".

-- 1. Dates that belong to the document, not to the person ---------------------

alter table public.documents
  add column if not exists issued_at date;

alter table public.documents
  add column if not exists expires_at date;

create index if not exists documents_expires_at_idx
  on public.documents (facility_id, expires_at)
  where expires_at is not null;

comment on column public.documents.issued_at is
  'Date printed on the document itself (test date, certification date). Null when unknown.';

comment on column public.documents.expires_at is
  'Date the document stops being valid. Null when the document does not expire or the date is unknown.';

-- 2. Link a certificate to the training entry it proves ----------------------
--
-- Training history logs a topic, hours and a date. The certificate that backs
-- one entry has to be identifiable as that entry's certificate — matching on
-- "same person, same date" would attach the wrong file the moment someone logs
-- two trainings in a day.
--
-- The foreign key is added only if staff_trainings exists (it, like documents,
-- was created outside this repo). ON DELETE SET NULL for the same reason as
-- staff_id: deleting the log entry should not destroy the certificate.

alter table public.documents
  add column if not exists training_id uuid;

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'staff_trainings')
     and not exists (select 1 from pg_constraint where conname = 'documents_training_id_fkey')
  then
    alter table public.documents
      add constraint documents_training_id_fkey
      foreign key (training_id) references public.staff_trainings(id) on delete set null;
  end if;
end $$;

create index if not exists documents_training_idx
  on public.documents (training_id)
  where training_id is not null;

comment on column public.documents.training_id is
  'The staff_trainings entry this certificate proves. Null for documents that are not in-service certificates.';

-- 3. Two more document types --------------------------------------------------
--
-- mandated_reporter: part 1 added training_cert, which the 16-hour initial
-- training uses. Mandated Reporter training is a separate DSS requirement with
-- its own certificate, and two slots sharing one doc_type would show each
-- other's document.
--
-- inservice_cert: the certificates behind the 20-hour annual in-service
-- requirement. Also distinct from training_cert — an in-service certificate is
-- not evidence that the 16-hour initial training was completed.
--
-- Same drop-and-replace approach as part 1 — the constraint name is not assumed.

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
      -- resident-side
      'lic601', 'lic602', 'lic602a', 'physician_report', 'isp',
      -- staff-side
      'tb_test', 'cpr_card', 'first_aid', 'livescan', 'training_cert',
      'mandated_reporter', 'inservice_cert',
      -- generic
      'cert', 'other'
    ));
end $$;
