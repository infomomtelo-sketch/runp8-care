-- ARF checklists (2026-09-30).
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Run it whole. Safe to run
-- twice: every step is guarded and a second run changes nothing. Additive: no
-- row is deleted and no facility's existing tasks are touched.
--
-- WHY
--
-- Adult Residential Facilities (ARFs, adults 18 to 59) follow 22 CCR §80000
-- (general licensing) and §85000 (ARF), not the RCFE rules in §87100. Until
-- now every facility was seeded from one list written for RCFEs, so an ARF
-- home was handed RCFE items (§87xxx citations, RCFE administrator certificate,
-- resident forms). This file gives ARF its own list and marks the old list as
-- RCFE's.
--
-- WHERE EVERY ITEM COMES FROM (checked 2026-09-30)
--
--   - CDSS, "Reference Guide to Adult Residential Facilities Administrator,
--     Staff, and Volunteer Training Requirements", December 2025 (PIN 25-11-ASC).
--   - CDSS Administrator Certification FAQ (ARF: 35-hour initial program, in
--     person or live-stream; renewal 40 hours, 4 on laws and regulations, at
--     least 20 live, 20 may be self-paced).
--   - Current regulation text from CDSS's own files: arfman.docx (22 CCR
--     §85000) and genman1-4.docx (22 CCR §80000).
-- Nothing here is about a resident. There are no resident items and no
-- medication items: Title22 holds no resident records, and a tick-box for a
-- resident document is not needed for anything below.
--
-- WHAT IT DOES
--   1. public.title22_training_requirements: the four ARF tracked rules.
--   2. checklist_items.checked_on: the date an item was verified.
--   3. Every existing item with no facility_types is marked RCFE (and CBRC):
--      every one of them was written for an RCFE. PREVIEW the count first.
--   4. The ARF items, facility_types {arf}.
--   5. A read-only report.
--
-- Existing ARF facilities are handled by the app, not here: it hides tasks
-- whose item is not for ARF (nothing is deleted) and, when an ARF home has no
-- ARF tasks yet, adds them once.


-- 1. The tracked rules, as data ---------------------------------------------
-- The same numbers are in training-rules.js; tests/training-rules.test.mjs
-- fails if the two disagree.

insert into public.title22_training_requirements
  (code, facility_types, label, rule_json, citation, checked_on, checked_against)
values
  ('arf_admin_ce', array['arf'],
   'ARF administrator certificate renewal: continuing education',
   '{"total_hours":40,"period_months":24,"due":"certificate_expiry","minimums":{"laws_regs":4},"max_self_paced_hours":20,"min_live_hours":20,"initial_certification":{"hours":35,"live_only":true,"exam_within_days":60}}'::jsonb,
   'HSC §1562.3(c), (f)(1); 22 CCR §§85064.2, 85064.3', date '2026-09-30',
   'CDSS ARF training reference guide (Dec 2025); CDSS Administrator Certification FAQ; 22 CCR §§85064.2, 85064.3'),
  ('arf_admin_hiv_tb', array['arf'],
   'ARF administrator: HIV and TB training',
   '{"hours":{"hiv":3,"tb":1},"within_months":6,"update_every_months":24}'::jsonb,
   'HSC §1562.5(a); 22 CCR §85064(k)', date '2026-09-30',
   'CDSS ARF training reference guide (Dec 2025); 22 CCR §85064(k)'),
  ('arf_infection_control', array['arf'],
   'ARF staff: Infection Control Plan training',
   '{"within_days_of_hire":10,"topic":"infection_control"}'::jsonb,
   '22 CCR §85095.5(c)(1)(C)', date '2026-09-30',
   'CDSS ARF training reference guide (Dec 2025); 22 CCR §85095.5'),
  ('arf_emergency_plan', array['arf'],
   'ARF staff: Emergency and Disaster Plan training',
   '{"on_hire":true,"period_months":12,"topic":"emergency"}'::jsonb,
   'HSC §1565(b)', date '2026-09-30',
   'CDSS ARF training reference guide (Dec 2025)')
on conflict (code) do update
  set facility_types = excluded.facility_types, label = excluded.label,
      rule_json = excluded.rule_json, citation = excluded.citation,
      checked_on = excluded.checked_on, checked_against = excluded.checked_against;


-- 2. When an item was verified ----------------------------------------------

alter table public.checklist_items add column if not exists checked_on date;
comment on column public.checklist_items.checked_on is
  'Date the requirement and citation were last checked against an official source. Null = not recorded.';


-- 3. The existing list is RCFE's --------------------------------------------
-- PREVIEW: how many items are untagged now, and a sample. Every one of these
-- was written for an RCFE (the 2026-08-20, 09-07, 09-08 and 09-29 migrations,
-- plus rows added by hand). If you see an item here that is not about an RCFE,
-- stop and ask before running the update.

select count(*) as untagged_items_now from public.checklist_items where facility_types is null;
select category, title, regulation_reference
  from public.checklist_items where facility_types is null
 order by category, title limit 200;

update public.checklist_items
   set facility_types = array['rcfe','cbrc']
 where facility_types is null;


-- 4. The ARF items ----------------------------------------------------------
-- PPE training (§85095.5(b)(2)(C)) is NOT listed: in the regulation it applies
-- only when a client has a contagious disease. Removed 2026-09-30 on review;
-- 2026-09-30c removes it from the live database.
-- Frequency is shown on screen ("Every 2 years", "Before first shift"), so it
-- is set only where the law sets that interval. Null = no fixed interval.

insert into public.checklist_items
  (title, category, frequency, regulation_reference, requirement_code, facility_types, checked_on)
select v.title, v.category, v.frequency, v.ref, v.code, array['arf'], date '2026-09-30'
  from (values
-- ARF ITEMS BEGIN
    -- administrator
    ('ARF administrator certificate current, with a copy kept at the home (35-hour initial program and the state exam; renewed every 2 years)', 'administrator', 'biennial', 'HSC §1562.3; 22 CCR §§85064.2, 85066(c)', 'arf_admin_cert'),
    ('Administrator certificate renewal: 40 hours of continuing education in each 2-year period (4 on laws and regulations; at least 20 live, in person or live-stream; no more than 20 self-paced)', 'administrator', 'biennial', 'HSC §1562.3(f)(1); 22 CCR §85064.3', 'arf_admin_ce'),
    ('Administrator: 4 hours of HIV and TB training (3 on HIV, 1 on TB) within 6 months of becoming administrator, then an update every 2 years', 'administrator', 'biennial', 'HSC §1562.5(a); 22 CCR §85064(k)', 'arf_admin_hiv_tb'),
    ('A designated substitute who meets the staff requirements covers whenever the administrator is away', 'administrator', null, '22 CCR §§80064(b), 85064(f)', null),
    -- staff
    ('Criminal record clearance or exemption (or an approved transfer) for each employee and volunteer before they start or are present in the home', 'staff', 'on_hire', '22 CCR §§80019, 80065(i)', null),
    ('Health screening, including a TB test, for each staff member, the licensee and the administrator, done no more than 1 year before or 7 days after starting', 'staff', null, '22 CCR §80065(g)', null),
    ('Volunteers: a signed statement of good health and a TB test, no more than 1 year before or 7 days after first being in the home', 'staff', null, '22 CCR §80065(g)(3)', null),
    ('Direct care staff: first aid training from a qualified provider, such as the American Red Cross', 'staff', null, '22 CCR §80075(f)', 'arf_first_aid'),
    ('Night staff (10 p.m. to 7 a.m.): trained in the home''s emergency procedures and in first aid', 'staff', null, '22 CCR §85065.6(b)', null),
    ('On-the-job training or related experience for each person''s job: food and nutrition, housekeeping and sanitation, care and supervision, assisting with self-administered medication, early signs of illness, community resources', 'staff', null, '22 CCR §80065(f)', null),
    ('All staff: training on the Emergency and Disaster Plan when hired, and every year', 'staff', 'annual', 'HSC §1565(b)', 'arf_emergency_plan'),
    ('All staff: Infection Control Plan training from the Infection Control Lead within 10 calendar days of starting', 'staff', null, '22 CCR §85095.5(c)(1)(C)', 'arf_infection_control'),
    ('All staff: training in recognizing and reporting elder and dependent adult abuse within 60 days of starting', 'staff', null, 'WIC §15655(a)', 'elder_abuse_training'),
    ('All staff instructed to report any violation of clients'' personal rights', 'staff', null, '22 CCR §80065(m)', null),
    ('A personnel record for the licensee, the administrator and every employee, holding what §80066(a) lists', 'staff', null, '22 CCR §80066(a)', null),
    ('Personnel records for every volunteer: health statement, TB test, and criminal record documents where required', 'staff', null, '22 CCR §80066(b)', null),
    ('Personnel records kept at the home (or readily available there) for at least 3 years after employment ends', 'staff', null, '22 CCR §80066(d), (e)', null),
    ('Personnel records show the hours actually worked', 'staff', null, '22 CCR §80066(f)', null),
    ('A dated staff schedule for each month, posted where staff can see it: name, job title, hours and days off', 'staff', 'monthly', '22 CCR §85066(b)', null),
    -- facility
    ('Night supervision (10 p.m. to 7 a.m.) meets §85065.6 for the number of clients in care', 'facility', null, '22 CCR §85065.6', null),
    ('Written disaster and mass casualty plan on file and current', 'facility', null, '22 CCR §80023(a), (b)', null),
    ('Disaster drills at least every 6 months, documented, with the records kept for 1 year', 'facility', 'semiannual', '22 CCR §80023(d)', null),
    ('Infection Control Plan in the Plan of Operation, naming an Infection Control Lead', 'facility', null, '22 CCR §85095.5(c)', null),
    ('Infection control procedures reviewed at least once a year', 'facility', 'annual', '22 CCR §85095.5(c)(1)(D)', null),
    ('First aid supplies and a current first aid manual kept in a central place', 'facility', null, '22 CCR §80075(g)', null)
-- ARF ITEMS END
  ) as v(title, category, frequency, ref, code)
 where not exists (select 1 from public.checklist_items c
                    where c.title = v.title and c.facility_types = array['arf']);


-- 5. Report (read-only) -----------------------------------------------------

select coalesce(array_to_string(facility_types, ','), '(none)') as facility_types,
       count(*) as items
  from public.checklist_items group by 1 order by 1;

select count(*) filter (where facility_type = 'arf') as arf_homes,
       count(*) filter (where coalesce(facility_type,'rcfe') in ('rcfe','cbrc')) as rcfe_or_cbrc_homes
  from public.facilities;
