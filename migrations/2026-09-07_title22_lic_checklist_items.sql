-- The LIC forms, as facility-level yes/no checklist items.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and idempotent
-- — every insert is guarded on the title, so re-running changes nothing.
--
-- WHY THESE ARE FACILITY-LEVEL, NOT PER-RESIDENT
--
-- "Every current resident has a LIC 602A on file" is one yes/no for the
-- facility. No resident is named, no document is uploaded, nothing about a
-- person is stored. That keeps Lite's No-PHI line intact while still telling a
-- new administrator what DSS will ask for — which is the whole reason someone
-- who was licensed last month buys this.
--
-- WHAT A TICK MEANS, AND WHAT IT DOES NOT
--
-- These are attestations. "Yes" means the administrator said yes on a date,
-- not that a document exists. DSS wants the document, not the answer. The
-- checklist should never render a completed item as "compliant" — it is a
-- record of what someone told us, and it is dated.
--
-- ON THE SECTION REFERENCES
--
-- 2026-08-20_title22_checklist_items.sql left most of these NULL on the
-- grounds that a guessed citation is worse than none. That still holds, and
-- nothing below is guessed: every reference here is one already published on
-- title-22.com/score, written by a certified California RCFE administrator.
-- The distinction that matters is authorship — a fixed list a licensed person
-- wrote is not the same risk as a model generating one, which is what the
-- original rule was written against.
--
-- Anything not on that verified list is left NULL here too. Fill the rest in
-- from the regulations themselves, one at a time, the same way the CDSS form
-- URLs are added — only after someone has read the section.
--
-- The app should carry one line under the list: "Section references are a
-- starting point — confirm with your licensing analyst."

-- Resident-record requirements. The facility still has these obligations
-- whether or not Title22 holds the records — and Lite deliberately does not.
insert into public.checklist_items (title, category, frequency, regulation_reference)
select v.title, v.category, v.frequency, v.regulation_reference
  from (values
    ('Every current resident has a LIC 602A (Medical Assessment) on file, dated within the last year',
     'residents', 'annual', '§87506'),
    ('Every current resident has a LIC 601 (Identification and Emergency Information) on file',
     'residents', 'on_admission', '§87506'),
    ('Every resident has a current appraisal / needs and services plan you could hand over today',
     'residents', 'annual', '§87463'),
    ('Every admission has a signed admission agreement on file',
     'residents', 'on_admission', null)
  ) as v(title, category, frequency, regulation_reference)
 where not exists (
   select 1 from public.checklist_items c where c.title = v.title
 );

-- Staff records. This is the half Lite actually tracks, and the half that
-- produces most of the deficiencies a small facility gets written up for.
insert into public.checklist_items (title, category, frequency, regulation_reference)
select v.title, v.category, v.frequency, v.regulation_reference
  from (values
    ('Every staff member''s TB clearance is on file',
     'staff', 'annual', '§87411'),
    ('No staff member is working with an expired CPR or First Aid card',
     'staff', 'monthly', '§87411(e)'),
    ('Every staff member has a cleared LiveScan on file before their first shift with residents',
     'staff', 'on_hire', '§87355'),
    ('Every staff member has completed mandated reporter training',
     'staff', 'on_hire', null),
    ('Every caregiver has completed the 40-hour initial training',
     'staff', 'on_hire', null),
    ('Continuing training hours are logged for every caregiver this year',
     'staff', 'annual', null),
    ('A LIC 508 (Criminal Record Statement) is on file for every employee',
     'staff', 'on_hire', null)
  ) as v(title, category, frequency, regulation_reference)
 where not exists (
   select 1 from public.checklist_items c where c.title = v.title
 );

-- Medication records. Lite holds none of this — the facility keeps it on
-- whatever system it already uses — but a new administrator still has to know
-- the requirement exists, so it stays on the list as an attestation.
insert into public.checklist_items (title, category, frequency, regulation_reference)
select v.title, v.category, v.frequency, v.regulation_reference
  from (values
    ('Your medication records for the last 30 days are complete, with no unexplained blank entries',
     'medication', 'monthly', '§87465'),
    ('Every medication entry identifies the individual who administered it — no shared logins or initials you cannot attribute',
     'medication', 'monthly', '§87465'),
    ('Centrally stored medications are locked, and the record matches what is physically in the med room',
     'medication', 'monthly', null)
  ) as v(title, category, frequency, regulation_reference)
 where not exists (
   select 1 from public.checklist_items c where c.title = v.title
 );

-- Facility and administrator. The items an analyst asks for in the first ten
-- minutes of a visit.
insert into public.checklist_items (title, category, frequency, regulation_reference)
select v.title, v.category, v.frequency, v.regulation_reference
  from (values
    ('Your fire clearance is current and the drill log is up to date',
     'facility', 'quarterly', '§87212'),
    ('Your emergency disaster plan is written, current, and staff have been trained on it',
     'facility', 'annual', '§87212(a)'),
    ('The facility licence is posted where residents and visitors can see it',
     'facility', 'annual', null),
    ('A LIC 624 is completed and reported for every incident that requires one',
     'facility', 'monthly', null),
    ('RCFE Administrator Certificate Current',
     'administrator', 'biennial', null),
    ('Administrator continuing education hours are current for this certification period',
     'administrator', 'biennial', null)
  ) as v(title, category, frequency, regulation_reference)
 where not exists (
   select 1 from public.checklist_items c where c.title = v.title
 );


-- What this does NOT do -----------------------------------------------------
--
-- Existing facilities do not get these items. seedComplianceTasks() only runs
-- at onboarding, so a facility created before today keeps the checklist it was
-- built with. New facilities pick the full list up automatically.
--
-- To backfill everyone, run this after the inserts above — it adds only the
-- items each facility is missing, and touches nothing already there:
--
--   insert into public.compliance_tasks
--     (facility_id, checklist_item_id, title, category, priority, due_date, completed)
--   select f.id, ci.id, ci.title, ci.category,
--          case when ci.frequency in ('daily','on_hire','on_admission')
--               then 'high' else 'medium' end,
--          current_date + interval '30 days',
--          false
--     from public.facilities f
--     cross join public.checklist_items ci
--    where not exists (
--      select 1 from public.compliance_tasks t
--       where t.facility_id = f.id and t.checklist_item_id = ci.id
--    );
--
-- Left commented because it writes a row per facility per item and there is no
-- undo but a delete. Read the count first:
--
--   select count(*) from public.facilities;
--   select count(*) from public.checklist_items;


-- Check what landed ---------------------------------------------------------

select category,
       count(*) as items,
       count(regulation_reference) as with_citation
  from public.checklist_items
 group by category
 order by category;
