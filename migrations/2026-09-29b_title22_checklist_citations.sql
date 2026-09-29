-- Checklist citations, the rest (2026-09-29, second file).
--
-- Supabase SQL editor. Run it whole, after 2026-09-29_title22_training_requirements.sql.
-- Safe to run twice: every step matches on a title that the first run changes
-- or removes, so a second run finds nothing to do.
--
-- WHY
-- Step 7 of the first file listed every checklist item still carrying a
-- citation (the owner pasted it back on 2026-09-29). Checked one by one
-- against the current RCFE regulations (22 CCR Div. 6 Ch. 8, CDSS manual
-- through CCL-26-06), many were wrong:
--   * sections that are about something else: §87207 is False Claims, §87218
--     Theft and Loss, §87211 incident reporting, §87309 storage of poisons,
--     §87506 resident records;
--   * sections that do not exist any more: §87304, §87572, §87585 (old
--     numbering);
--   * requirements that are not in the law: an annual staff TB test, an annual
--     physical, 16 hours initial / 8 hours annual caregiver training (the law
--     is 40 and 20, now items B and C), an "ISP" (not an RCFE term);
--   * the wrong form: the pre-admission appraisal is not the LIC 601, and an
--     RCFE's physician's report is the LIC 602A, not the LIC 602;
--   * the same requirement listed two or three times (CPR x3, First Aid x3,
--     TB x4, LiveScan x3 ...), which also dragged the readiness score.
-- Where no section says it, the citation is removed rather than guessed.
-- The full table is in docs/citation-audit-2026-09-29.md.
--
-- WHAT IT DOES
--   1. Merges wrong or duplicate items into the correct one. Each facility
--      keeps ONE task for it; if either copy was ticked, the kept one is.
--   2. Corrects or removes the remaining citations.
--   3. Prints the result: every item that still has a citation.


-- 1. Merge ---------------------------------------------------------------

drop table if exists t22_merge;
create temp table t22_merge (old_title text, target_title text);
insert into t22_merge values
  -- Training hours: the law is 40 initial and 20 a year (items B and C).
  ('16-Hour Initial Caregiver Training Completed', 'Direct care staff: 40 hours of initial training (20 before working on their own, the rest within 4 weeks; 16 hands-on, 12 on dementia)'),
  ('Initial Caregiver Training (16 hours)',        'Direct care staff: 40 hours of initial training (20 before working on their own, the rest within 4 weeks; 16 hands-on, 12 on dementia)'),
  ('Annual Caregiver Training (8 hours)',          'Direct care staff: 20 hours of training every year from the hire date (8 on dementia, 4 on postural supports, restricted health conditions and hospice)'),
  ('Caregiver Annual In-Service Training (8 hrs)', 'Direct care staff: 20 hours of training every year from the hire date (8 on dementia, 4 on postural supports, restricted health conditions and hospice)'),
  -- TB: one health screening at hire (§87411(f)); no annual TB rule.
  ('Annual TB Test',                  'Health screening, including a TB test, on file for every employee (done from 6 months before to 7 days after starting)'),
  ('TB Test on Hire',                 'Health screening, including a TB test, on file for every employee (done from 6 months before to 7 days after starting)'),
  ('Staff Health Screening on Hire',  'Health screening, including a TB test, on file for every employee (done from 6 months before to 7 days after starting)'),
  -- Duplicates.
  ('CPR Certification Current',       'CPR certification current'),
  ('First Aid Certification Current', 'First aid certification current'),
  ('LiveScan Background Check Cleared', 'Criminal record clearance before contact with residents'),
  ('Mandated Reporter Training',      'Mandated Reporter Training Completed'),
  ('Fire Safety Inspection Current',  'Fire clearance current'),
  ('First Aid Kit Stocked',           'First Aid Kit Stocked and Accessible'),
  ('Disaster/Emergency Plan Posted',  'Emergency Disaster Plan Current and Posted'),
  ('Emergency and disaster plan reviewed', 'Emergency Disaster Plan Current and Posted'),
  ('RCFE License Posted',             'Facility License Posted and Current'),
  ('Resident Rights Posted',          'Resident Rights Posted in Common Area'),
  ('Expired Medications Disposed',    'Discontinued and expired medication disposed of and recorded'),
  ('Expired Medications Disposed Properly', 'Discontinued and expired medication disposed of and recorded'),
  ('Medications Properly Stored',     'Medications stored locked, and only where they should be'),
  ('Medications Stored Locked and Secure', 'Medications stored locked, and only where they should be'),
  ('Physician Orders on File',        'Physician Orders on File for All Medications'),
  ('Signed Admission Agreement on File', 'Admission Agreement Signed'),
  -- Resident side (dormant in Lite; corrected so it is right if it returns).
  ('Physician Report (LIC 602)',        'Every resident has a LIC 602A (Medical Assessment) on file, made within the year before admission'),
  ('Physician Report (LIC 602) on File', 'Every resident has a LIC 602A (Medical Assessment) on file, made within the year before admission'),
  ('Annual Physical Exam Completed',    'Every resident has a LIC 602A (Medical Assessment) on file, made within the year before admission'),
  ('Pre-Admission Appraisal (LIC 601)', 'Pre-Admission Appraisal (LIC 601) on File'),
  ('Individualized Service Plan (ISP) Completed', 'Pre-Admission Appraisal (LIC 601) on File'),
  ('Individualized Service Plan (ISP)', 'Resident appraisal reviewed for changed needs'),
  ('ISP Annual Review',                 'Resident appraisal reviewed for changed needs'),
  ('ISP Annual Review Completed',       'Resident appraisal reviewed for changed needs'),
  ('Food Handler Certification Current', 'Food Handler Certification Current');  -- same title twice: keeps one

do $$
declare m record; tgt uuid; old record;
begin
  for m in select * from t22_merge loop
    -- The row everything is kept on: the target title's oldest row.
    select id into tgt from public.checklist_items where title = m.target_title order by id limit 1;
    if tgt is null then continue; end if;
    for old in select id from public.checklist_items where title = m.old_title and id <> tgt loop
      -- Carry a tick across before dropping the facility's old copy.
      update public.compliance_tasks k set completed = true, completed_at = coalesce(k.completed_at, o.completed_at)
        from public.compliance_tasks o
       where k.checklist_item_id = tgt and o.checklist_item_id = old.id
         and o.facility_id = k.facility_id and o.completed and not k.completed;
      delete from public.compliance_tasks o
       where o.checklist_item_id = old.id
         and exists (select 1 from public.compliance_tasks k where k.checklist_item_id = tgt and k.facility_id = o.facility_id);
      update public.compliance_tasks o
         set checklist_item_id = tgt,
             title = (select title from public.checklist_items where id = tgt)
       where o.checklist_item_id = old.id;
      delete from public.checklist_items where id = old.id;
    end loop;
  end loop;
end $$;

-- The administrator certificate is listed twice under one title (annual and
-- biennial). The app looks this title up, so keep it and keep the biennial row.
do $$
declare keep uuid; old record;
begin
  select id into keep from public.checklist_items
   where title = 'RCFE Administrator Certificate Current' order by (frequency = 'biennial') desc, id limit 1;
  if keep is null then return; end if;
  for old in select id from public.checklist_items where title = 'RCFE Administrator Certificate Current' and id <> keep loop
    update public.compliance_tasks k set completed = true, completed_at = coalesce(k.completed_at, o.completed_at)
      from public.compliance_tasks o
     where k.checklist_item_id = keep and o.checklist_item_id = old.id
       and o.facility_id = k.facility_id and o.completed and not k.completed;
    delete from public.compliance_tasks o where o.checklist_item_id = old.id
       and exists (select 1 from public.compliance_tasks k where k.checklist_item_id = keep and k.facility_id = o.facility_id);
    update public.compliance_tasks set checklist_item_id = keep where checklist_item_id = old.id;
    delete from public.checklist_items where id = old.id;
  end loop;
end $$;


-- 2. Citations, and the titles that named the wrong form or rule ---------

drop table if exists t22_cite;
create temp table t22_cite (title text, new_title text, new_ref text);
insert into t22_cite values
  -- administrator
  ('RCFE Administrator Certificate Current', null, '§87405(a)'),
  ('Certificate Renewal Filed on Time', null, '§87407; HSC §1569.616'),
  ('Administrator Certificate Posted in Facility', null, null),          -- no posting rule for the certificate
  ('Admission Agreement Template Current', null, '§87507'),
  ('Admission Agreement Signed', null, '§87507'),
  ('DSS Inspection Log Maintained', null, null),                         -- §87506 is resident records
  ('Emergency Disaster Plan Current and Posted', 'Emergency disaster plan written, with exit plans and emergency numbers posted', '§87212(a), (c)'),
  ('Emergency Evacuation Drills Completed (2x/year)', 'Staff trained on the emergency and disaster plan (at hire and every year)', 'HSC §1569.695(b)'),
  ('Facility Liability Insurance Current', null, null),                  -- §87207 is False Claims
  ('Facility License Posted and Current', null, '§87113'),
  ('Grievance Procedure Posted', 'Complaint and emergency reporting information posted', '§87468(c)'),
  ('Resident Rights Posted in Common Area', null, '§87468(c)'),
  -- facility
  ('Carbon Monoxide Detectors Operational', null, null),                 -- not in Chapter 8; part of the fire clearance
  ('Smoke Detectors Tested and Operational', null, null),
  ('Emergency Exit Signs Illuminated', null, null),
  ('Fire Extinguishers Inspected and Tagged', null, null),
  ('Facility Maintenance Log Current', null, '§87303(a)'),
  ('Fire clearance current', null, '§87202'),
  ('First Aid Kit Stocked and Accessible', null, '§87465(a)(8)'),
  ('Food Handler Certification Current', null, null),                    -- not in Chapter 8
  ('Hazardous Materials Stored Safely', null, '§87309(a)'),
  ('Hot Water Temperature Within Safe Range (120F max)', 'Hot water for residents between 105°F and 120°F', '§87303(e)(2)'),
  ('Kitchen Sanitation Standards Met', null, '§87555(b)'),
  ('Pest Control — No Evidence of Infestation', null, '§87303(a); §87555(b)(27)'),
  ('Resident Bedrooms Meet Space Requirements', 'Resident bedrooms meet the requirements (no more than two residents, not a passageway)', '§87307(a)(2)'),
  ('Telephone Service Operational', null, '§87311'),
  ('Weekly Menu Posted', 'Menus written a week ahead (homes of 16 or more)', '§87555(b)(6)'),
  ('Unusual incidents reported to the licensing agency as required', null, '§87211'),
  -- medication (dormant in Lite)
  ('Controlled Substances Log Maintained', null, null),                  -- §87465(f) is emergency care
  ('Discontinued and expired medication disposed of and recorded', null, '§87465(i)'),
  ('MAR Current and Accurate', null, null),                              -- no MAR rule in §87465
  ('Medication Administration Record (MAR) Maintained', null, null),
  ('Medications stored locked, and only where they should be', null, '§87465(h)'),
  ('Over-the-Counter Medications Authorized in Writing', 'Written physician order on file for every PRN medication, prescription or over-the-counter', '§87465(e)'),
  ('Physician Orders on File for All Medications', null, null),
  ('Prescription Labels Current on All Medications', 'Centrally stored medications labeled, and labels altered only by the pharmacist', '§87465(h)(4)'),
  ('PRN Medication Protocol on File', null, '§87465(b)–(e)'),
  ('Centrally stored medication record kept current', null, '§87465(h)(6)'),
  -- residents (dormant in Lite)
  ('Advance Health Care Directive on File (if applicable)', 'Written information on advance health care directives given at admission', '§87468.2'),
  ('Emergency Contact Information Current', null, '§87506'),
  ('Monthly Weight Recorded', null, null),
  ('Pre-Admission Appraisal (LIC 601) on File', 'Pre-admission appraisal on file (LIC 603A)', '§87457'),
  ('Resident Rights Acknowledged and Signed', null, '§87468'),
  ('Self-Administration Assessment', null, null),
  -- staff
  ('Criminal record clearance before contact with residents', null, '§87355; §87411(g)'),
  ('Mandated Reporter Training Completed', null, null),                  -- §87411(e) is on-the-job training in homes of 16+
  ('Sufficient Staff Coverage All Shifts', null, '§87411(a)');

update public.checklist_items ci
   set title = coalesce(c.new_title, ci.title),
       regulation_reference = c.new_ref
  from t22_cite c
 where ci.title = c.title;

update public.compliance_tasks t
   set title = c.new_title
  from t22_cite c
 where t.title = c.title and c.new_title is not null;

-- The law says at hire and every year.
update public.checklist_items set frequency = 'annual'
 where title = 'Staff trained on the emergency and disaster plan (at hire and every year)' and frequency <> 'annual';


-- 3. Result: send this table back ------------------------------------------

select category, title, regulation_reference, frequency
  from public.checklist_items
 where regulation_reference is not null
 order by category, title;
