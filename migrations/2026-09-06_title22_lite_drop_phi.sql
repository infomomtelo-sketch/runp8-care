-- Title22 Lite: remove resident health information from the database.
--
-- DESTRUCTIVE AND IRREVERSIBLE. Nothing in this file is idempotent in the way
-- the other migrations here are — it deletes rows. Before running it:
--   1. Take a snapshot (Supabase: Database -> Backups) or note a PITR
--      restore point. This is the only way back.
--   2. Deploy index.html with showMAR = false first. Wiping the tables while
--      a client can still write to them leaves new rows behind you.
--   3. Run section 0 and read the counts. If a number surprises you, stop.
--
-- Name mapping, because the pivot note and this schema disagree:
--   mar_entries        -> public.mar_entries        (exists under that name)
--   resident_meds      -> public.medications
--   resident_profiles  -> public.residents
--   lic_602a           -> NO SUCH TABLE. LIC 602A is a self-reported yes/no
--                         column on public.residents (lic602a), plus an
--                         uploaded file in public.documents and its object in
--                         the storage bucket. Section 3 and section 6.
--
-- Order matters. Rows that reference residents are removed first so that
-- nothing here needs TRUNCATE ... CASCADE — cascade would silently take
-- incident reports and staff documents with it.


-- 0. Look before you delete -------------------------------------------------

select 'mar_entries'                     as what, count(*) from public.mar_entries
union all select 'medications',                count(*) from public.medications
union all select 'daily_logs',                 count(*) from public.daily_logs
union all select 'documents (resident)',       count(*) from public.documents where resident_id is not null
union all select 'incidents (resident-linked)',count(*) from public.incidents where resident_id is not null
union all select 'residents',                  count(*) from public.residents;


-- 1..5 The deletion ---------------------------------------------------------

begin;

-- 1. Medication administration record, then the prescriptions it refers to.
delete from public.mar_entries;
delete from public.medications;

-- 2. Daily log — vitals, food, bowel, hygiene. Clinical, per resident.
delete from public.daily_logs;

-- 3. Resident documents: LIC 601, LIC 602A, ISP and physician reports.
--    This removes the ROWS. The files themselves live in storage and are not
--    touched here — section 6.
delete from public.documents where resident_id is not null;

-- 4. Incidents. A LIC 624 report is a facility record the facility may still
--    have to produce, so the default is to keep the report and cut the link
--    to the resident. Choose one, and know which you chose:
update public.incidents set resident_id = null where resident_id is not null;
-- delete from public.incidents where resident_id is not null;   -- the other choice
--
-- If the update above errors with a not-null violation, the column is
-- required and the reports cannot be kept unlinked — either delete them (line
-- above) or drop the not-null constraint first. Do not "fix" it by cascading.

-- 5. The resident records themselves.
delete from public.residents;

commit;


-- 6. Files in storage -------------------------------------------------------
--
-- SQL cannot delete storage objects. Find what is left and remove it through
-- the Storage API or the dashboard:
--
--   select name from storage.objects
--    where bucket_id = '<bucket>'                       -- the app's documents bucket
--      and name in (select storage_path from public.documents);   -- run BEFORE section 3
--
-- Which is the catch: once section 3 has run, the paths are gone with the
-- rows. Export that list first if you intend to clean storage, or match on
-- the resident-document prefix the uploader uses.


-- 7. Recommended: stop the tables being reachable at all --------------------
--
-- The client-side guard in index.html (t22Fetch) is a product decision, not a
-- security control — anyone can open a console. If Lite is meant to be a
-- claim about what the system can hold, revoke the grants so an anon or
-- authenticated key cannot read these tables even if a build ships with
-- showMAR = true by mistake:
--
--   revoke all on public.mar_entries, public.medications,
--                 public.residents,   public.daily_logs
--     from anon, authenticated;
--
-- Left commented deliberately: it will break any other consumer of these
-- tables (a worker, a report, an admin tool) the moment it runs. Grant it
-- back with `grant select, insert, update, delete on ... to authenticated;`.


-- 8. Still to check by hand -------------------------------------------------
--
-- public.audit_log may hold resident names inside its recorded payloads, and
-- the app calls that log append-only. Deleting from it contradicts that
-- claim, so it is not done here. Look first:
--
--   select count(*) from public.audit_log where table_name in
--     ('residents','medications','mar_entries','daily_logs');
--
-- Decide deliberately: leave it (and stop calling Lite "no PHI stored"),
-- redact the payloads, or delete those rows and drop the append-only wording.
