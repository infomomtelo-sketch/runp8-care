-- LIC 602 -> 602A migration.
--
-- Why: LIC 602 is the Physician's Report for Community Care Facilities — the
-- wrong facility type for an RCFE. The form this product actually needs on
-- file is LIC 602A, "Medical Assessment for Residential Care Facilities for
-- the Elderly" (current revision 4/25). Decision: no LIC 602 anywhere.
--
-- Staged so the app keeps working between steps. Do not run STEP 2 until the
-- index.html code that reads/writes lic602a (not lic602) is deployed —
-- running it earlier makes every already-filed LIC 602 document look
-- "missing" to the still-live old code, which is exactly the false-negative
-- this product exists to prevent.

-- ============================================================================
-- STEP 1 — residents column. Additive only. Run this first, verify, then
-- deploy the index.html code changes.
-- ============================================================================

alter table public.residents
  add column if not exists lic602a text;

update public.residents
   set lic602a = lic602
 where lic602a is null
   and lic602 is not null;

-- Verify before doing anything else.
select count(*) filter (where lic602 is not null)  as old_602,
       count(*) filter (where lic602a is not null) as new_602a
  from public.residents;

-- ============================================================================
-- STEP 2 — documents.doc_type carry-over. public.documents was created
-- outside this repo (see CLAUDE.md), so this is written defensively.
--
-- 'lic602a' is already an allowed doc_type value (added in
-- 2026-08-09_title22_document_slots.sql), so no CHECK constraint change is
-- needed to run this. Run it in the SAME sitting you deploy the index.html
-- changes — right after the deploy, not before — so there is no window where
-- a real, already-filed LIC 602 report reads as missing on the dashboard.
-- ============================================================================

update public.documents
   set doc_type = 'lic602a'
 where doc_type = 'lic602';

-- Verify: should be 0 remaining under the old key, and old_602 (from Step 1)
-- or fewer should now show up under the new one.
select count(*) filter (where doc_type = 'lic602')  as docs_still_602,
       count(*) filter (where doc_type = 'lic602a') as docs_now_602a
  from public.documents;

-- ============================================================================
-- STEP 3 — cleanup. Only after both of the above are verified and the
-- deployed app has been checked against the "Verify before closing out"
-- list in the task (a resident with 602A on file shows correctly, the DSS
-- audit packet reads LIC 602A, the demo seeder produces 602A values, Tello
-- names both forms correctly). Run this last, separately.
-- ============================================================================

-- alter table public.residents drop column lic602;

-- Tightens the documents.doc_type list to match: no 'lic602', no
-- 'physician_report' (index.html no longer offers either as an upload
-- option). Same drop-and-replace approach as the existing doc_type
-- migrations, since the constraint name is not assumed.
--
-- do $$
-- declare
--   con record;
-- begin
--   for con in
--     select c.conname
--     from pg_constraint c
--     join pg_class t on t.oid = c.conrelid
--     join pg_namespace n on n.oid = t.relnamespace
--     where n.nspname = 'public'
--       and t.relname = 'documents'
--       and c.contype = 'c'
--       and pg_get_constraintdef(c.oid) ilike '%doc_type%'
--   loop
--     execute format('alter table public.documents drop constraint %I', con.conname);
--   end loop;
--
--   alter table public.documents
--     add constraint documents_doc_type_check check (doc_type in (
--       -- resident-side
--       'lic601', 'lic602a', 'isp',
--       -- staff-side
--       'tb_test', 'cpr_card', 'first_aid', 'livescan', 'training_cert',
--       'mandated_reporter', 'inservice_cert',
--       -- generic
--       'cert', 'other'
--     ));
-- end $$;
