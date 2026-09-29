-- Training requirements, corrected (2026-09-29).
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Run it whole. It is safe
-- to run twice: every step is guarded, and a second run changes nothing.
-- Verified on a local Postgres 16 stand-in before it was committed.
--
-- WHY
--
-- A training company reviewing the demo found this checklist item:
--   "Continuing Education (20 hrs / 2 years)  CCR Title 22 §87405  Every 2 years"
-- Wrong three ways. An RCFE administrator renews with 40 hours every two years,
-- not 20; §87405 is the administrator's qualifications, not recertification
-- (that is §87407, with the hours in HSC §1569.616(f)); and it said nothing of
-- the dementia and laws-and-regulations hours inside the 40. The row is not in
-- any migration in this repo: it was put into the database by hand, so it is
-- found below by what it says, not by an exact title.
--
-- The same review of every cited item found more; they are fixed in step 6.
-- The full audit table is in docs/citation-audit-2026-09-29.md.
--
-- WHERE THE NUMBERS COME FROM
--
-- CDSS "Reference Guide to RCFE Administrator, Staff, and Volunteer Training
-- Requirements" (updated January 2025), the CDSS administrator renewal page,
-- PIN 23-14-CCLD, and the current text of 22 CCR §§87407 and 87411. The same
-- figures are in training-rules.js; tests/training-rules.test.mjs fails if the
-- two disagree.
--
-- WHAT IT DOES
--   1. public.title22_training_requirements: the three requirements, as data.
--   2. staff_trainings: topic_area, hands_on, delivery, counts_toward.
--      staff: admin_cert_expiry.
--   3. checklist_items: requirement_code and facility_types, and the three new
--      items, RCFE (and CBRC) only.
--   4. Replaces the wrong administrator item, and the older 40-hour and
--      20-hour items, with the new ones in every facility's checklist,
--      including the demo sandbox. Replaced tasks are reset to not done: what
--      was ticked was a different (and in one case wrong) statement.
--      ARF facilities lose the old items and do not get the new ones: these
--      are RCFE requirements.
--   5. training_courses (the table behind training.html), if it exists.
--   6. The other citations the audit found wrong.
--   7. A read-only report of every cited row still in the database, for the
--      ones this file could not see.


-- 1. The requirements, as data ---------------------------------------------

create table if not exists public.title22_training_requirements (
  code            text primary key,
  facility_types  text[] not null,
  label           text not null,
  rule_json       jsonb not null,
  citation        text not null,
  checked_on      date not null,
  checked_against text not null
);

alter table public.title22_training_requirements enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='title22_training_requirements' and policyname='t22_training_requirements_read') then
    create policy t22_training_requirements_read on public.title22_training_requirements
      for select to anon, authenticated using (true);
  end if;
end $$;

insert into public.title22_training_requirements
  (code, facility_types, label, rule_json, citation, checked_on, checked_against)
values
  ('rcfe_admin_ce', array['rcfe','cbrc'],
   'Administrator certificate renewal: continuing education',
   '{"total_hours":40,"period_months":24,"due":"certificate_expiry","minimums":{"dementia":8,"laws_regs":4},"max_self_paced_hours":20,"min_live_hours":20}'::jsonb,
   'HSC §1569.616(f); 22 CCR §87407', date '2026-09-29',
   'CDSS RCFE training reference guide (Jan 2025); CDSS administrator renewal page; PIN 23-14-CCLD; 22 CCR §87407'),
  ('rcfe_dcs_initial', array['rcfe','cbrc'],
   'Direct care staff: initial training',
   '{"total_hours":40,"before_independent":{"hours":20,"dementia":6,"postural_hospice":4},"within_days_of_hire":28,"minimums":{"hands_on":16,"dementia":12,"postural_hospice":4}}'::jsonb,
   'HSC §§1569.625, 1569.626, 1569.696; 22 CCR §87411(c)', date '2026-09-29',
   'CDSS RCFE training reference guide (Jan 2025); 22 CCR §87411(c)'),
  ('rcfe_dcs_annual', array['rcfe','cbrc'],
   'Direct care staff: annual training',
   '{"total_hours":20,"period_months":12,"due":"hire_anniversary","minimums":{"dementia":8,"postural_hospice":4}}'::jsonb,
   'HSC §§1569.625, 1569.626, 1569.696; 22 CCR §87411(c)', date '2026-09-29',
   'CDSS RCFE training reference guide (Jan 2025); 22 CCR §87411(c)')
on conflict (code) do update
  set facility_types = excluded.facility_types, label = excluded.label,
      rule_json = excluded.rule_json, citation = excluded.citation,
      checked_on = excluded.checked_on, checked_against = excluded.checked_against;


-- 2. Per-entry and per-person fields ---------------------------------------

alter table public.staff_trainings add column if not exists topic_area    text;
alter table public.staff_trainings add column if not exists hands_on      boolean not null default false;
alter table public.staff_trainings add column if not exists delivery      text;
alter table public.staff_trainings add column if not exists counts_toward text not null default 'direct_care';

comment on column public.staff_trainings.topic_area is
  'aging, personal_care, residents_rights, medication, psychosocial, dementia, postural_hospice, emergency, lgbt_cultural, laws_regs, other (training-rules.js TOPICS)';
comment on column public.staff_trainings.hands_on is 'Hands-on hours count toward the 16 of the 40 initial hours.';
comment on column public.staff_trainings.delivery is 'live (in person or live-stream) or self_paced. Administrator renewal allows at most 20 self-paced hours.';
comment on column public.staff_trainings.counts_toward is 'direct_care (initial / annual) or admin_ce (administrator certificate renewal).';

-- Carry the old single "category" across. Only where the new field is empty,
-- so a second run, or an entry edited since, is left alone. 'general' becomes
-- 'other': there is no general minimum in the law.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='staff_trainings' and column_name='category') then
    update public.staff_trainings set topic_area = case category
             when 'dementia' then 'dementia'
             when 'special_care' then 'postural_hospice'
             when 'general' then 'other' end
     where topic_area is null and category in ('dementia','special_care','general');
    update public.staff_trainings set hands_on = true
     where category = 'hands_on' and hands_on = false;
  end if;
end $$;

alter table public.staff add column if not exists admin_cert_expiry date;
comment on column public.staff.admin_cert_expiry is
  'For a staff member who holds an RCFE administrator certificate: its expiry date. Renewal hours are tracked over the 2 years before it.';


-- 3. The new checklist items ------------------------------------------------

alter table public.checklist_items add column if not exists requirement_code text;
alter table public.checklist_items add column if not exists facility_types  text[];
comment on column public.checklist_items.facility_types is
  'Facility types this item applies to. Null = every type. seedComplianceTasks filters on it.';

insert into public.checklist_items (title, category, frequency, regulation_reference, requirement_code, facility_types)
select v.title, v.category, v.frequency, v.ref, v.code, array['rcfe','cbrc']
  from (values
    ('Administrator certificate renewal: 40 hours of continuing education in the 2 years before it expires (8 on dementia, 4 on laws and regulations, at least 20 live)',
     'administrator', 'biennial', 'HSC §1569.616(f); 22 CCR §87407', 'rcfe_admin_ce'),
    ('Direct care staff: 40 hours of initial training (20 before working on their own, the rest within 4 weeks; 16 hands-on, 12 on dementia)',
     'staff', 'on_hire', 'HSC §§1569.625, 1569.626, 1569.696', 'rcfe_dcs_initial'),
    ('Direct care staff: 20 hours of training every year from the hire date (8 on dementia, 4 on postural supports, restricted health conditions and hospice)',
     'staff', 'annual', 'HSC §§1569.625, 1569.626, 1569.696', 'rcfe_dcs_annual')
  ) as v(title, category, frequency, ref, code)
 where not exists (select 1 from public.checklist_items c where c.requirement_code = v.code);


-- 4. Replace the old items in every checklist -------------------------------
--
-- Which old rows are replaced, and by which new one. Matched on what they say,
-- because the wrong administrator row was added by hand and its exact wording
-- is not in this repo. PREVIEW this select before running the rest — if it
-- lists something that is not an administrator CE, 40-hour initial or 20-hour
-- annual item, stop.

drop table if exists t22_replace;
create temp table t22_replace as
select ci.id as old_id, ci.title as old_title, ci.regulation_reference as old_ref,
       case
         when ci.title ~* 'continuing education' or (ci.regulation_reference ~ '87405' and ci.title ~* 'hour|education')
           then 'rcfe_admin_ce'
         when ci.title ~* '40[ -]?hours?' and ci.title ~* 'initial'
           then 'rcfe_dcs_initial'
         when (ci.title ~* '20[ -]?hours?' and ci.title ~* 'annual|in-?service')
           or ci.title ~* 'continuing training hours are logged'
           then 'rcfe_dcs_annual'
       end as code
  from public.checklist_items ci
 where ci.requirement_code is null
   and (ci.title ~* 'continuing education|continuing training hours'
        or (ci.regulation_reference ~ '87405' and ci.title ~* 'hour|education')
        or (ci.title ~* '40[ -]?hours?' and ci.title ~* 'initial')
        or (ci.title ~* '20[ -]?hours?' and ci.title ~* 'annual|in-?service'));

select old_title, old_ref, code as replaced_by from t22_replace order by code, old_title;

-- 4a. ARF facilities: drop the old tasks. These are RCFE requirements.
delete from public.compliance_tasks t
 using t22_replace r, public.facilities f
 where t.checklist_item_id = r.old_id
   and f.id = t.facility_id
   and coalesce(f.facility_type, 'rcfe') not in ('rcfe','cbrc');

-- 4b. RCFE facilities that already have the new task: the old one goes.
delete from public.compliance_tasks t
 using t22_replace r, public.checklist_items n
 where t.checklist_item_id = r.old_id
   and n.requirement_code = r.code
   and exists (select 1 from public.compliance_tasks x
                where x.facility_id = t.facility_id and x.checklist_item_id = n.id);

-- 4c. Two old rows can map to the same new item for one facility (the wrong
-- CE row and the older "Administrator continuing education hours completed").
-- Keep one task per facility per new item: delete all but the earliest.
delete from public.compliance_tasks t
 using t22_replace r
 where t.checklist_item_id = r.old_id
   and exists (
     select 1 from public.compliance_tasks y join t22_replace ry on ry.old_id = y.checklist_item_id
      where y.facility_id = t.facility_id and ry.code = r.code
        and y.id < t.id);

-- 4d. Everything left points at the new item, reset to not done.
update public.compliance_tasks t
   set checklist_item_id = n.id,
       title = n.title,
       category = n.category,
       completed = false,
       completed_at = null,
       priority = case when n.frequency in ('daily','on_hire','on_admission') then 'high' else 'medium' end,
       due_date = coalesce(t.due_date, current_date + interval '30 days')::date
  from t22_replace r, public.checklist_items n
 where t.checklist_item_id = r.old_id
   and n.requirement_code = r.code;

-- 4e. The demo sandbox shows all three new items, whatever it had before.
insert into public.compliance_tasks (facility_id, checklist_item_id, title, category, completed, priority, due_date)
select f.id, n.id, n.title, n.category, false,
       case when n.frequency in ('daily','on_hire','on_admission') then 'high' else 'medium' end,
       (current_date + interval '30 days')::date
  from public.facilities f
  join public.checklist_items n on n.requirement_code in ('rcfe_admin_ce','rcfe_dcs_initial','rcfe_dcs_annual')
 where f.is_demo is true
   and not exists (select 1 from public.compliance_tasks x
                    where x.facility_id = f.id and x.checklist_item_id = n.id);

-- 4g. The demo sandbox's Training tab: invented entries for its invented
-- staff, only if it has none. Chosen so the page shows what it is for — a
-- caregiver short on dementia hours, and an administrator over the
-- self-paced limit. Nothing here is a real person.
insert into public.staff_trainings (facility_id, staff_id, topic, hours, training_date, topic_area, hands_on, delivery, counts_toward)
select s.facility_id, s.id, v.topic, v.hours, current_date - v.days_ago, v.area, v.hands_on, v.delivery, v.counts
  from public.staff s
  join public.facilities f on f.id = s.facility_id and f.is_demo is true
  cross join lateral (values
    ('Understanding dementia, part 1', 5.0, 40, 'dementia', false, 'live', 'direct_care'),
    ('Postural supports and hospice basics', 4.0, 30, 'postural_hospice', false, 'live', 'direct_care'),
    ('Residents'' rights refresher', 6.0, 20, 'residents_rights', false, 'self_paced', 'direct_care')
  ) as v(topic, hours, days_ago, area, hands_on, delivery, counts)
 where coalesce(s.role, '') <> 'administrator'
   and not exists (select 1 from public.staff_trainings x where x.facility_id = f.id);

insert into public.staff_trainings (facility_id, staff_id, topic, hours, training_date, topic_area, hands_on, delivery, counts_toward)
select s.facility_id, s.id, v.topic, v.hours, current_date - v.days_ago, v.area, false, v.delivery, 'admin_ce'
  from public.staff s
  join public.facilities f on f.id = s.facility_id and f.is_demo is true
  cross join lateral (values
    ('Dementia care for administrators', 8.0, 200, 'dementia', 'live'),
    ('RCFE regulations update', 4.0, 150, 'laws_regs', 'live'),
    ('Online management modules', 24.0, 90, 'other', 'self_paced')
  ) as v(topic, hours, days_ago, area, delivery)
 where s.role = 'administrator'
   and not exists (select 1 from public.staff_trainings x where x.facility_id = f.id and x.counts_toward = 'admin_ce');

-- 4f. The old rows, now that nothing points at them.
delete from public.checklist_items ci
 using t22_replace r
 where ci.id = r.old_id
   and not exists (select 1 from public.compliance_tasks t where t.checklist_item_id = ci.id);


-- 5. training_courses (training.html) --------------------------------------
--
-- Created outside this repo, so its columns are checked before use. Fixes the
-- same wrong administrator row if it is here too. training.html itself no
-- longer reads this table (it now sends people to the app's Training tab).

do $$
declare has_hours boolean; has_ref boolean;
begin
  if to_regclass('public.training_courses') is null then return; end if;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='training_courses' and column_name='hours_required') into has_hours;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='training_courses' and column_name='regulation_reference') into has_ref;
  if has_hours and has_ref then
    update public.training_courses
       set hours_required = 40,
           regulation_reference = 'HSC §1569.616(f); 22 CCR §87407'
     where title ~* 'continuing education'
       and (hours_required = 20 or regulation_reference ~ '87405');
  end if;
end $$;


-- 6. The other citations the audit found wrong ------------------------------
--
-- Each is matched on its exact title and changes only what the audit says is
-- wrong. The task copies in compliance_tasks follow any title change.

drop table if exists t22_fix;
create temp table t22_fix (old_title text, new_title text, new_ref text, clear_ref boolean, new_freq text);
insert into t22_fix values
  -- §87411(e) is on-the-job training in homes of 16+. CPR on duty is HSC
  -- §1569.618(c)(3); first aid training is §87411(c)(1).
  ('CPR certification current', null, 'HSC §1569.618(c)(3)', false, null),
  ('First aid certification current', null, '§87411(c)(1)', false, null),
  ('No staff member is working with an expired CPR or First Aid card', null, 'HSC §1569.618(c)(3); §87411(c)(1)', false, null),
  -- §87411(f): screening from 6 months before to 7 days after starting, not
  -- "before first shift", and nothing there requires an annual TB renewal.
  ('Health screening and TB clearance before first shift',
   'Health screening, including a TB test, on file for every employee (done from 6 months before to 7 days after starting)', '§87411(f)', false, null),
  ('TB test renewed', null, null, true, null),
  ('Every staff member''s TB clearance is on file', null, '§87411(f)', false, null),
  -- Fire clearance is §87202. §87212 is the emergency disaster plan.
  ('Fire clearance current', null, '§87202', false, null),
  ('Your fire clearance is current and the drill log is up to date', 'Your fire clearance is current', '§87202', false, null),
  -- §87465 requires a record of centrally stored medication and of each PRN
  -- dose, not of every dose; nothing in it about initials or monthly
  -- reconciliation of orders.
  ('Centrally stored medication record complete for every dose',
   'Centrally stored medication record kept current', '§87465', false, null),
  ('Every medication entry identifies the individual who administered it — no shared logins or initials you cannot attribute', null, null, true, null),
  ('Physician orders reconciled against the MAR', null, null, true, null),
  -- Reappraisal is §87463: as needed or at least every 12 months.
  ('Resident appraisal reviewed for changed needs', null, '§87463', false, null),
  ('Individual Service Plan completed', null, null, true, null),
  ('Individual Service Plan reviewed and updated', null, null, true, 'annual'),
  -- §87458: the medical assessment is made within the year BEFORE admission,
  -- then updated when the Department requires it — not every year.
  ('Every current resident has a LIC 602A (Medical Assessment) on file, dated within the last year',
   'Every resident has a LIC 602A (Medical Assessment) on file, made within the year before admission', '§87458', false, 'on_admission');

update public.checklist_items ci
   set title = coalesce(f.new_title, ci.title),
       regulation_reference = case when f.clear_ref then null else coalesce(f.new_ref, ci.regulation_reference) end,
       frequency = coalesce(f.new_freq, ci.frequency)
  from t22_fix f
 where ci.title = f.old_title;

update public.compliance_tasks t
   set title = f.new_title
  from t22_fix f
 where t.title = f.old_title and f.new_title is not null;

-- LIC 602 is the Physician's Report for other facility types; an RCFE's is the
-- LIC 602A, which has its own item. Move any task to the 602A item, then drop
-- the 602 row. (Skipped entirely if the 602A item is not there.)
do $$
declare old_id uuid; new_id uuid;
begin
  select id into old_id from public.checklist_items where title = 'LIC 602 — Physician''s Report on file';
  select id into new_id from public.checklist_items where title like 'Every resident has a LIC 602A (Medical Assessment) on file%' limit 1;
  if old_id is null or new_id is null then return; end if;
  delete from public.compliance_tasks t where t.checklist_item_id = old_id
     and exists (select 1 from public.compliance_tasks x where x.facility_id = t.facility_id and x.checklist_item_id = new_id);
  update public.compliance_tasks t set checklist_item_id = new_id,
         title = (select title from public.checklist_items where id = new_id)
   where t.checklist_item_id = old_id;
  delete from public.checklist_items where id = old_id;
end $$;


-- 7. Report: every cited row still in the database -------------------------
--
-- Read-only. Paste the result back: rows this file could not see are audited
-- from it.

select 'checklist_items' as source, category, title, regulation_reference, frequency, requirement_code
  from public.checklist_items
 where regulation_reference is not null
 order by category, title;
