-- Undo the near-duplicates that 2026-09-07_title22_lic_checklist_items.sql
-- inserted, and move its citations onto the rows that were already there.
--
-- WHAT WENT WRONG
--
-- Yesterday's migration guarded every insert on an exact title match:
--
--   where not exists (select 1 from checklist_items c where c.title = v.title)
--
-- That only stops a byte-identical title. checklist_items already covered most
-- of the same ground in different words, from 2026-08-20_title22_checklist_items.sql
-- — "Fire clearance current" versus "Your fire clearance is current and the
-- drill log is up to date". The guard passed, and 19 of the 20 items inserted;
-- only "RCFE Administrator Certificate Current" matched exactly and was
-- correctly skipped.
--
-- The cost is not cosmetic. seedComplianceTasks writes one compliance_task per
-- checklist_item, and the readiness score is met-over-total, so every
-- restatement inflates the denominator and asks an administrator the same
-- question twice in the same list.
--
-- WHAT THIS KEEPS
--
-- Three of the nineteen are genuinely new and stay:
--
--   LIC 602A (Medical Assessment)  — the August set had no 602A item at all
--   LIC 508 (Criminal Record Statement) — a form, not the LiveScan clearance
--                                    that "Criminal record clearance before
--                                    contact with residents" already covers
--   medication entry attribution   — "who administered it" is distinct from
--                                    "the record is complete"
--
-- SAFE TO RUN
--
-- Verified before writing this: all 19 rows have zero compliance_tasks
-- pointing at them (seedComplianceTasks runs only at onboarding, and no
-- facility has been created since). Each delete below is still guarded twice
-- anyway — it fires only if the older row it duplicates actually exists, and
-- only if nothing references it. A guard that fails leaves the row in place
-- rather than opening a hole in the list.


-- 1. Citations first ---------------------------------------------------------
--
-- Yesterday's rows carried references taken from the verified list published on
-- title-22.com/score. Those are worth keeping even though the rows are not, so
-- they move onto the surviving titles — and only where the survivor has none,
-- so nothing already recorded is overwritten.

update public.checklist_items set regulation_reference = '§87506'
 where title = 'LIC 601 — Identification and Emergency Information on file'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87463'
 where title = 'Resident appraisal reviewed for changed needs'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87411'
 where title = 'TB test renewed'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87411(e)'
 where title in ('CPR certification current', 'First aid certification current')
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87355'
 where title = 'Criminal record clearance before contact with residents'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87465'
 where title = 'Centrally stored medication record complete for every dose'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87212'
 where title = 'Fire clearance current'
   and regulation_reference is null;

update public.checklist_items set regulation_reference = '§87212(a)'
 where title = 'Emergency and disaster plan reviewed'
   and regulation_reference is null;


-- 2. Delete the sixteen restatements -----------------------------------------
--
-- Each pair is (the row inserted yesterday, the older row that already said
-- it). The delete fires only when the older row is present.

delete from public.checklist_items ci
 using (values
    ('Administrator continuing education hours are current for this certification period',
     'Administrator continuing education hours completed'),
    ('A LIC 624 is completed and reported for every incident that requires one',
     'Unusual incidents reported to the licensing agency as required'),
    ('The facility licence is posted where residents and visitors can see it',
     'Facility licence posted where residents and visitors can see it'),
    ('Your emergency disaster plan is written, current, and staff have been trained on it',
     'Emergency and disaster plan reviewed'),
    ('Your fire clearance is current and the drill log is up to date',
     'Fire clearance current'),
    ('Centrally stored medications are locked, and the record matches what is physically in the med room',
     'Medications stored locked, and only where they should be'),
    ('Your medication records for the last 30 days are complete, with no unexplained blank entries',
     'Centrally stored medication record complete for every dose'),
    ('Every admission has a signed admission agreement on file',
     'Admission agreement signed and on file'),
    ('Every current resident has a LIC 601 (Identification and Emergency Information) on file',
     'LIC 601 — Identification and Emergency Information on file'),
    ('Every resident has a current appraisal / needs and services plan you could hand over today',
     'Resident appraisal reviewed for changed needs'),
    ('Continuing training hours are logged for every caregiver this year',
     '20 hours annual in-service training completed'),
    ('Every caregiver has completed the 40-hour initial training',
     '40 hours initial training completed within the first year'),
    ('Every staff member has a cleared LiveScan on file before their first shift with residents',
     'Criminal record clearance before contact with residents'),
    ('Every staff member has completed mandated reporter training',
     'Mandated reporter training completed'),
    ('Every staff member''s TB clearance is on file',
     'TB test renewed'),
    ('No staff member is working with an expired CPR or First Aid card',
     'CPR certification current')
  ) as v(new_title, old_title)
 where ci.title = v.new_title
   and exists (
     select 1 from public.checklist_items o where o.title = v.old_title
   )
   and not exists (
     select 1 from public.compliance_tasks t where t.checklist_item_id = ci.id
   );


-- 3. Check what survived -----------------------------------------------------
--
-- Expect exactly three rows: LIC 602A, LIC 508, and medication attribution.

select title, category, regulation_reference
  from public.checklist_items
 where title in (
   'Every current resident has a LIC 602A (Medical Assessment) on file, dated within the last year',
   'A LIC 508 (Criminal Record Statement) is on file for every employee',
   'Every medication entry identifies the individual who administered it — no shared logins or initials you cannot attribute'
 )
 order by category;

-- Expect nothing at all from this one. Anything it returns is a delete whose
-- guard did not fire — which means the older row it was supposed to duplicate
-- is not actually in the table, and that row should be kept, not deleted.

select title, category
  from public.checklist_items
 where title in (
   'Administrator continuing education hours are current for this certification period',
   'A LIC 624 is completed and reported for every incident that requires one',
   'The facility licence is posted where residents and visitors can see it',
   'Your emergency disaster plan is written, current, and staff have been trained on it',
   'Your fire clearance is current and the drill log is up to date',
   'Centrally stored medications are locked, and the record matches what is physically in the med room',
   'Your medication records for the last 30 days are complete, with no unexplained blank entries',
   'Every admission has a signed admission agreement on file',
   'Every current resident has a LIC 601 (Identification and Emergency Information) on file',
   'Every resident has a current appraisal / needs and services plan you could hand over today',
   'Continuing training hours are logged for every caregiver this year',
   'Every caregiver has completed the 40-hour initial training',
   'Every staff member has a cleared LiveScan on file before their first shift with residents',
   'Every staff member has completed mandated reporter training',
   'Every staff member''s TB clearance is on file',
   'No staff member is working with an expired CPR or First Aid card'
 )
 order by category, title;

-- And the totals, to compare against yesterday's run
-- (administrator 20, facility 32, medication 19, residents 28, staff 36):

select category,
       count(*) as items,
       count(regulation_reference) as with_citation
  from public.checklist_items
 group by category
 order by category;
