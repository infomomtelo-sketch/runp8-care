-- Initial training phases, required topics, medication training and a course
-- catalog (2026-09-30). Run after 2026-09-29_title22_training_requirements.sql.
--
-- Supabase SQL editor. Run it whole. Safe to run twice.
-- Verified on a local Postgres 16 stand-in before it was committed.
--
-- Every rule below was checked against the CDSS "Reference Guide to RCFE
-- Administrator, Staff, and Volunteer Training Requirements" (January 2025)
-- and the current text of 22 CCR §87411. The same numbers are in
-- training-rules.js; tests/training-rules.test.mjs fails if they disagree.
--
-- WHAT IT DOES
--   1. staff_trainings: phase ('phase1' / 'phase2'), supervisor (who confirmed
--      a hands-on entry), course_id.
--   2. staff: assists_with_medication.
--   3. public.title22_course_catalog: a course's credit hours and topic split,
--      as data, so a training partner's courses can be mapped later. Read-only
--      to signed-in users; written by the service role only. No SCORM yet.
--   4. title22_training_requirements: the phases and required topics on the
--      initial rule; medication and elder-abuse rules added.
--   5. The public demo sandbox (is_demo): its night caregiver becomes a
--      week-2 new hire with invented, phase-tagged hours. Nothing is a real
--      person.

-- 1. staff_trainings -------------------------------------------------------
alter table public.staff_trainings add column if not exists phase text;
alter table public.staff_trainings add column if not exists supervisor text;
alter table public.staff_trainings add column if not exists course_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_trainings_phase_check') then
    alter table public.staff_trainings add constraint staff_trainings_phase_check
      check (phase is null or phase in ('phase1','phase2'));
  end if;
end $$;
comment on column public.staff_trainings.phase is 'Initial training phase: phase1 (20 h before working alone) or phase2 (the rest, within 4 weeks). Null = worked out from the date.';
comment on column public.staff_trainings.supervisor is 'For a hands-on entry: the supervisor who confirmed it.';

-- 2. staff -----------------------------------------------------------------
alter table public.staff add column if not exists assists_with_medication boolean not null default false;
comment on column public.staff.assists_with_medication is 'Assists residents with self-administration of medication: HSC §1569.69 training applies.';

-- 3. Course catalog --------------------------------------------------------
create table if not exists public.title22_course_catalog (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  title             text not null,
  credit_hours      numeric(5,2) not null check (credit_hours > 0),
  topic_hours       jsonb not null default '{}'::jsonb,   -- {"dementia": 4, "postural_hospice": 2}
  hands_on_hours    numeric(5,2) not null default 0,
  phase             text check (phase is null or phase in ('phase1','phase2')),
  delivery          text check (delivery is null or delivery in ('live','self_paced')),
  counts_toward     text not null default 'direct_care' check (counts_toward in ('direct_care','admin_ce')),
  external_ref      text,          -- the partner's own course id
  scorm_package_url text,          -- reserved; nothing reads it yet
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table public.title22_course_catalog enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='title22_course_catalog' and policyname='t22_course_catalog_read') then
    create policy t22_course_catalog_read on public.title22_course_catalog for select to authenticated using (active);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_trainings_course_fk') then
    alter table public.staff_trainings add constraint staff_trainings_course_fk
      foreign key (course_id) references public.title22_course_catalog(id) on delete set null;
  end if;
end $$;

-- 4. Requirements as data --------------------------------------------------
update public.title22_training_requirements
   set rule_json = rule_json
     || '{"phases":{"phase1":{"hours":20,"minimums":{"dementia":6,"postural_hospice":4}},"phase2":{"hours":20,"minimums":{"dementia":6}}},"required_topics":["aging","personal_care","infection_control","residents_rights","medication","psychosocial","emergency","lgbt_cultural","first_aid"]}'::jsonb,
       checked_on = date '2026-09-30'
 where code = 'rcfe_dcs_initial';

insert into public.title22_training_requirements (code, facility_types, label, rule_json, citation, checked_on, checked_against)
values
  ('rcfe_dcs_medication', array['rcfe','cbrc'],
   'Direct care staff who assist with medication: initial and annual training',
   '{"small":{"max_capacity":15,"total_hours":10,"hands_on":6,"other":4,"other_within_days":14},"large":{"min_capacity":16,"total_hours":24,"hands_on":16,"other":8,"other_within_days":28},"annual_hours":8}'::jsonb,
   'HSC §1569.69(a), (b); 22 CCR §87411(c)(3)(D)', date '2026-09-30',
   'CDSS RCFE training reference guide (Jan 2025)'),
  ('elder_abuse_training', array['rcfe','cbrc','arf'],
   'All staff: recognizing and reporting elder and dependent adult abuse',
   '{"within_days_of_hire":60}'::jsonb,
   'WIC §15655(a)', date '2026-09-30',
   'CDSS RCFE training reference guide (Jan 2025)')
on conflict (code) do update
  set label = excluded.label, rule_json = excluded.rule_json, citation = excluded.citation,
      checked_on = excluded.checked_on, checked_against = excluded.checked_against;

-- 5. The demo sandbox: a week-2 new hire -----------------------------------
-- Only the flagged sandbox, only its invented night caregiver.
do $$
declare s record; sup text;
begin
  for s in select st.id, st.facility_id from public.staff st
             join public.facilities f on f.id = st.facility_id and f.is_demo is true
            where st.name = 'Sofia Ivanova' loop
    select name into sup from public.staff where facility_id = s.facility_id and role = 'administrator' order by name limit 1;
    sup := coalesce(sup, 'The administrator');
    update public.staff set hire_date = current_date - 11, initial_training_complete = false where id = s.id;
    delete from public.staff_trainings where staff_id = s.id;
    insert into public.staff_trainings (facility_id, staff_id, topic, hours, training_date, topic_area, hands_on, delivery, counts_toward, phase, supervisor)
    select s.facility_id, s.id, v.topic, v.hours, current_date - v.days_ago, v.area, v.hands_on, 'live', 'direct_care', v.phase,
           case when v.hands_on then sup end
      from (values
        ('Dementia care: the basics', 6.0, 12, 'dementia', false, 'phase1'),
        ('Postural supports, restricted health conditions and hospice', 4.0, 12, 'postural_hospice', false, 'phase1'),
        ('Caring for LGBT elders', 1.0, 11, 'lgbt_cultural', false, 'phase1'),
        ('Bathing, dressing and transfers, with a supervisor', 5.0, 10, 'personal_care', true, 'phase1'),
        ('Physical limitations and needs of the elderly', 2.0, 9, 'aging', false, 'phase1'),
        ('Residents'' rights', 2.0, 9, 'residents_rights', false, 'phase1'),
        ('Dementia care: behaviors and communication', 3.0, 4, 'dementia', false, 'phase2'),
        ('Hand hygiene, PPE and cleaning supplies', 2.0, 3, 'infection_control', true, 'phase2'),
        ('Shut-off valves, fire extinguishers and exits walk-through', 1.0, 2, 'emergency', true, 'phase2'),
        ('Activities and companionship', 1.0, 2, 'psychosocial', false, 'phase2')
      ) as v(topic, hours, days_ago, area, hands_on, phase);
  end loop;
end $$;

-- Result
select code, citation, rule_json from public.title22_training_requirements order by code;
