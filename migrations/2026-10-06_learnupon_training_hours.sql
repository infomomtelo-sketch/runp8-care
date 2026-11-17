-- A partner course completion becomes training hours on a staff member. 2026-10-06.
--
-- Before this, public.learnupon_events was only a log. After it, the
-- title22-learnupon Worker turns a course completion into staff_trainings rows,
-- when it can say WHO and HOW MANY HOURS without guessing:
--
--   who        public.learnupon_learner_links: written by the Worker at sign-on,
--              when someone taps "Open partner courses" for a chosen staff
--              member. The LearnUpon learner is the signed-in account's email,
--              so the latest link for that email made before the completion
--              names the staff member.
--   how many   public.title22_course_catalog, matched on external_ref = the
--              LearnUpon course id. Hours and topic split come from the
--              catalog only, never from the payload: a course with no catalog
--              row records nothing and says so.
--
-- Every completion row gets training_status: recorded / no_staff_link /
-- no_course_hours / not_completed, with a note. Nothing is silent.
--
-- Additive and safe to run twice. Run BEFORE deploying the Worker change: until
-- it has run, the Worker still logs completions and marks them failed.
--
-- Undo for the sandbox test, once done (deletes only rows the test made):
--   delete from public.staff_trainings where source_ref like 'learnupon:%';
--   delete from public.title22_course_catalog where provider = 'Training partner (sandbox test)';
--   delete from public.learnupon_learner_links;

-- 1. What happened to each completion --------------------------------------
alter table public.learnupon_events add column if not exists training_status text;
alter table public.learnupon_events add column if not exists training_note   text;
comment on column public.learnupon_events.training_status is
  'recorded, no_staff_link, no_course_hours, not_completed, or failed. Null for events that are not course completions.';

-- 2. Who a LearnUpon learner is --------------------------------------------
create table if not exists public.learnupon_learner_links (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  learner_email text not null,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  linked_by     uuid not null
);
create index if not exists learnupon_learner_links_email
  on public.learnupon_learner_links (learner_email, created_at desc);
-- Worker only (service role). The browser cannot read or write it.
alter table public.learnupon_learner_links enable row level security;
revoke all on public.learnupon_learner_links from anon, authenticated;

-- 3. One completion is logged once -----------------------------------------
-- source_ref = 'learnupon:<enrollment id>'. Unique with topic_area because one
-- course can split into several topic rows. Existing rows have a null
-- source_ref, and nulls never collide.
alter table public.staff_trainings add column if not exists source_ref text;
create unique index if not exists staff_trainings_source_ref_uq
  on public.staff_trainings (source_ref, topic_area);

-- 4. The sandbox test course -------------------------------------------------
-- The partner's sandbox course used for testing, from the completion already
-- logged on 2026-10-06. 1 hour, topic "other", self-paced, and INACTIVE so the
-- app never offers it. These hours are invented for the test; a real course
-- gets its hours from the partner, not from here.
insert into public.title22_course_catalog
  (provider, title, credit_hours, topic_hours, delivery, counts_toward, external_ref, active)
select 'Training partner (sandbox test)', 'Sandbox test course: ' || e.course_name, 1, '{}'::jsonb,
       'self_paced', 'direct_care', e.course_id::text, false
  from (select distinct on (course_id) course_id, course_name
          from public.learnupon_events
         where course_id is not null and course_name = 'Eval'
         order by course_id, received_at desc) e
 where not exists (select 1 from public.title22_course_catalog c where c.external_ref = e.course_id::text);

-- Check: expect one row.
select provider, title, credit_hours, external_ref, active
  from public.title22_course_catalog where provider = 'Training partner (sandbox test)';
