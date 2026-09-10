-- Title22 — which migrations in this folder have actually been applied?
--
-- READ ONLY. It creates nothing, changes nothing, and touches no row. Paste it
-- into the Supabase SQL editor (project title22) and read the two result sets.
--
-- Why this file exists: two migrations were found unapplied in one week —
-- 2026-09-06_title22_lite_users.sql (public.users, ERROR 42P01, and the paid
-- gate had been reading that table for days) and
-- 2026-08-13b_title22_facility_capabilities.sql (title22_current_facility_role,
-- ERROR 42883, which refused the Launch Hub migration outright). Nothing in
-- this folder records what has been run, so the only way to know is to ask the
-- database what exists. Run this whenever that question comes up again.
--
-- HOW TO READ IT. `applied` is inferred from a sentinel object each migration
-- creates — it says the object is there, not that the file ran start to finish.
-- A migration someone applied by hand, or half of, reads the same as one that
-- ran cleanly. It is still the right question to ask first.
--
-- Sentinels are chosen so they cannot be satisfied by a DIFFERENT migration.
-- 2026-08-13b's sentinel is title22_has_capability, NOT
-- title22_current_facility_role: the Launch Hub migration installs that second
-- function itself (deliberately — see its header), so it would report 08-13b as
-- applied when it is not. That is the exact trap this file is here to avoid.

-- ---------------------------------------------------------------------------
-- PART 1 — catalog checks. Safe on any database: every row is a lookup in the
-- system catalogs, so a missing table makes a row read `f`, never an error.
-- ---------------------------------------------------------------------------

with col as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
)
select * from (
  select '2026-07-23_audit_log'              as migration, 'table audit_log'                       as sentinel, to_regclass('public.audit_log')                is not null as applied
  union all select '2026-07-23_demo_tenant',        'facilities.is_demo',                 exists (select 1 from col where table_name='facilities'      and column_name='is_demo')
  union all select '2026-07-23_funnel_columns',     'profiles.title22_utm_source',        exists (select 1 from col where table_name='profiles'        and column_name='title22_utm_source')
  union all select '2026-08-03_classroom_accounts', 'fn title22_grant_classroom_account',  to_regprocedure('public.title22_grant_classroom_account(text)') is not null
  union all select '2026-08-03_trainers',           'table title22_trainers',              to_regclass('public.title22_trainers')          is not null
  union all select '2026-08-07_events',             'table events',                        to_regclass('public.events')                    is not null
  union all select '2026-08-09_document_slots',     'documents.staff_id',                 exists (select 1 from col where table_name='documents'       and column_name='staff_id')
  union all select '2026-08-09b_doc_slot_dates',    'documents.expires_at',               exists (select 1 from col where table_name='documents'       and column_name='expires_at')
  union all select '2026-08-13_profile_photo_url',  'staff.photo_url',                    exists (select 1 from col where table_name='staff'           and column_name='photo_url')
  union all select '2026-08-13_resident_extended',  'residents.gender',                   exists (select 1 from col where table_name='residents'       and column_name='gender')
  -- NOT title22_current_facility_role: 2026-09-09 installs that one itself.
  union all select '2026-08-13b_facility_caps',     'fn title22_has_capability',           to_regprocedure('public.title22_has_capability(uuid,text)')  is not null
  union all select '2026-08-19_staff_training_cat', 'staff_trainings.category',           exists (select 1 from col where table_name='staff_trainings' and column_name='category')
  union all select '2026-08-19_accept_my_invite',   'fn title22_accept_my_invite',         to_regproc('public.title22_accept_my_invite')   is not null
  union all select '2026-08-19_mar_void_lead_role', 'mar_entries.voided_at',              exists (select 1 from col where table_name='mar_entries'     and column_name='voided_at')
  union all select '2026-08-19_member_entitlement', 'fn title22_member_entitlement',       to_regproc('public.title22_member_entitlement') is not null
  union all select '2026-08-19_redeem_invite',      'fn title22_redeem_invite',            to_regproc('public.title22_redeem_invite')      is not null
  -- Same function name as 2026-08-03_trainers, so existence proves nothing.
  -- What this migration changed is the body: paid_count stopped counting edu.
  union all select '2026-08-19_trainer_excl_edu',   'title22_trainer_signups body has edu',
                   exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public' and p.proname='title22_trainer_signups'
                             and p.prosrc like '%edu%')
  union all select '2026-08-20_tello_memory',       'table tello_messages',                to_regclass('public.tello_messages')            is not null
  union all select '2026-08-20_checklist_items',    'table checklist_items',               to_regclass('public.checklist_items')           is not null
  union all select '2026-08-29_lic602_602a',        'residents.lic602a',                  exists (select 1 from col where table_name='residents'       and column_name='lic602a')
  union all select '2026-09-02_lessons',            'table title22_lessons',               to_regclass('public.title22_lessons')           is not null
  -- Expected FALSE, and must stay false. Do NOT create this table to "fix" it:
  -- it would be a third store of who has paid. See CLAUDE.md.
  union all select '2026-09-06_lite_users',         'table users (expect FALSE)',          to_regclass('public.users')                     is not null
  union all select '2026-09-09_launch_checklist',   'table launch_checklist',              to_regclass('public.launch_checklist')          is not null
) t
order by migration;

-- ---------------------------------------------------------------------------
-- PART 2 — the two migrations that insert or edit ROWS rather than create
-- objects. Their sentinel is data, so each check is guarded on its table
-- existing first: CASE short-circuits at run time and query_to_xml takes its
-- query as a string, so a missing table reads null instead of failing the
-- whole query.
-- ---------------------------------------------------------------------------

-- The sentinel here has to be a row 2026-09-07 inserted AND 2026-09-08 did not
-- then delete. That is not a detail: 09-07 inserted 20 titles, 09-08 deleted 16
-- of them as restatements of items already in the 08-20 seed, and the first
-- version of this file used one of those 16. It reported 09-07 as NOT applied
-- on a database where both had run correctly — which would send someone to
-- re-run 09-07, re-adding 16 restatements and dropping the starting readiness
-- score of every facility created afterwards. Exactly the harm CLAUDE.md warns
-- about under "checklist_items: read it before you insert".
--
-- Four of the 20 survived. Three are unique to 09-07; the fourth ("RCFE
-- Administrator Certificate Current") is also in the 08-20 seed, so it proves
-- nothing. LIC 508 is one of the three.
select
  '2026-09-07_lic_checklist_items' as migration,
  'LIC 508 row (survived the 09-08 dedupe)' as sentinel,
  case when to_regclass('public.checklist_items') is not null then
    (xpath('/row/c/text()', query_to_xml(
      $q$ select count(*) as c from public.checklist_items
          where title = 'A LIC 508 (Criminal Record Statement) is on file for every employee' $q$,
      false, true, '')))[1]::text::int > 0
  end as applied
union all
select
  '2026-09-08_lic_checklist_dedupe',
  'regulation_reference set to a section number',
  case when to_regclass('public.checklist_items') is not null then
    (xpath('/row/c/text()', query_to_xml(
      $q$ select count(*) as c from public.checklist_items
          where regulation_reference like '§87%' $q$,
      false, true, '')))[1]::text::int > 0
  end;

-- ---------------------------------------------------------------------------
-- NOT IN EITHER LIST, and not a bug — these files have no live DDL, so
-- "applied" is not a question they answer:
--
--   2026-08-19_documents_rls_check.sql    check scripts. The statements are
--   2026-08-19_mar_entries_check.sql      commented out on purpose: you read
--   2026-08-19_rbac_check.sql             the diagnosis first and uncomment
--   2026-08-23_invite_flow_check.sql      only the part you need.
--
--   2026-09-08_reset_test_facilities.sql  guarded, dry-run first. Deliberately
--                                         not run: 49 test facilities across
--                                         32 accounts are still there.
--
--   2026-09-06_lite_drop_phi.sql          DO NOT RUN. It revokes the grants at
--                                         the database level and breaks every
--                                         classroom. Kept as the written-out
--                                         database-level version of Lite.
-- ---------------------------------------------------------------------------
