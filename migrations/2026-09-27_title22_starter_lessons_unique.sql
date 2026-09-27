-- Remove duplicate starter lessons, and stop them ever going in twice again.
--
-- Why there are duplicates: loadStarterLesson() (index.html) inserted all ten
-- LESSON_STARTERS with no guard. The "Load starter lessons" button stayed live
-- for the whole insert loop and nothing checked which titles were already
-- there, so a second tap -- or a second device -- copied the set again.
-- The app side is fixed in the same change: the button disables itself, a
-- second call is refused, and titles already present are skipped.
--
-- WHAT THIS TOUCHES
--   YES  public.title22_lessons rows whose title is one of the ten starter
--        titles below AND that are a second (or later) copy in the same
--        facility. The OLDEST copy per (facility_id, title) is kept.
--        Their questions go with them (on delete cascade).
--   NO   any lesson a trainer wrote themselves -- anything not titled
--        exactly like a starter is never read, let alone deleted.
--   NO   a duplicate that has student attempts. Deleting it would cascade
--        those attempts away. Step 1 lists them with attempts > 0; they are
--        left in place for a person to decide.
--   NO   residents, medications, MAR, or any PHI table.
--
-- HOW TO RUN, in the Supabase SQL editor, one step at a time:
--   Step 1  PREVIEW  read-only. Read it.
--   Step 2  DELETE   the duplicates step 1 marked 'delete'.
--   Step 3  SCHEMA   adds lessons.starter and the unique index. Fails if a
--                    duplicate starter survives step 2 (one with attempts);
--                    step 1 tells you whether that will happen.
--   Step 4  OPTIONAL rewrites two quiz questions in facilities that loaded
--                    the starters before 2026-09-27 (see the note there).
--
-- Verified 2026-09-27 on Postgres 16 against 2026-09-02_title22_lessons.sql:
-- duplicate copies deleted with their questions, the oldest kept and flagged
-- starter, a trainer's own two same-titled lessons untouched, a duplicate
-- with an attempt listed as 'KEEP - has attempts' and not deleted, a second
-- starter insert refused (23505), both old quiz rows rewritten, and a full
-- re-run of steps 2-4 raising no error.
--
-- Re-running: step 2 is a no-op once duplicates are gone; step 3 uses
-- "if not exists"; step 4 matches only the old wording, so a second run
-- changes nothing.

-- ------------------------------------------------------------------ titles --
-- Byte-for-byte the titles in LESSON_STARTERS. The admission-file title uses a
-- real em dash (U+2014), as the app writes it.
create temporary table if not exists t22_starter_titles(title text primary key);
insert into t22_starter_titles(title) values
  ('Recording what you did, so it still counts in six months'),
  ('Hiring and onboarding a new caregiver'),
  ('Preparing for your first inspection'),
  ('The admission file — what you can practise here, and what you cannot'),
  ('Find the gaps in Sunrise Demo Home'),
  ('Logging a session for a whole shift at once'),
  ('Completing the compliance checklist honestly'),
  ('Asking Tello, and what she will not tell you'),
  ('Finding every document the app asks for, and getting it on file'),
  ('What you keep after graduation')
on conflict do nothing;

-- ---------------------------------------------------------- 1. PREVIEW --
-- One row per copy of a starter lesson that exists more than once in a
-- facility. action = 'keep' (oldest), 'delete', or 'KEEP - has attempts'.
with ranked as (
  select l.id, l.facility_id, l.title, l.created_at,
         row_number() over (partition by l.facility_id, l.title
                            order by l.created_at, l.id) as n,
         count(*)    over (partition by l.facility_id, l.title) as copies,
         (select count(*) from public.title22_lesson_attempts a
           where a.lesson_id = l.id) as attempts
  from public.title22_lessons l
  join t22_starter_titles s on s.title = l.title
)
select facility_id, title, id, created_at, attempts,
       case when n = 1 then 'keep'
            when attempts > 0 then 'KEEP - has attempts'
            else 'delete' end as action
from ranked
where copies > 1
order by facility_id, title, n;

-- ----------------------------------------------------------- 2. DELETE --
-- with ranked as (
--   select l.id,
--          row_number() over (partition by l.facility_id, l.title
--                             order by l.created_at, l.id) as n
--   from public.title22_lessons l
--   join t22_starter_titles s on s.title = l.title
-- )
-- delete from public.title22_lessons l
-- using ranked r
-- where l.id = r.id
--   and r.n > 1
--   and not exists (select 1 from public.title22_lesson_attempts a
--                   where a.lesson_id = l.id)
-- returning l.facility_id, l.title, l.id;

-- ----------------------------------------------------------- 3. SCHEMA --
--  starter = true marks a row the app inserted from LESSON_STARTERS. The
--  index is partial, so a trainer can still write two lessons of their own
--  with the same title; only a second COPY OF A STARTER is refused.
--
-- alter table public.title22_lessons
--   add column if not exists starter boolean not null default false;
--
-- update public.title22_lessons l
--    set starter = true
--   from t22_starter_titles s
-- where s.title = l.title
--    and not l.starter
--    and l.id = (select l2.id from public.title22_lessons l2
--                 where l2.facility_id = l.facility_id and l2.title = l.title
--                 order by l2.created_at, l2.id limit 1);
--
-- create unique index if not exists title22_lessons_starter_once
--   on public.title22_lessons (facility_id, title) where starter;

-- --------------------------------------------------- 4. OPTIONAL: quiz --
--  Two starter questions offered wrong answers that described things Title22
--  does not hold ("On a resident record", "The MAR", "Resident medication
--  records", "A resident's diagnosis"). The app's LESSON_STARTERS is fixed,
--  but facilities that already loaded the starters keep the old copy in
--  title22_lesson_questions. This rewrites only rows whose choices are
--  EXACTLY the old ones, and the correct answer stays at the same index, so
--  past attempts still score the same.
--
-- update public.title22_lesson_questions
--    set choices = '["On that staff member’s record","In an incident report","On the compliance checklist","In Start Your Home"]'::jsonb
-- where choices = '["On that staff member’s record","In the daily log","On a resident record","In an incident report"]'::jsonb
--    and correct_index = 0;
--
-- update public.title22_lesson_questions
--    set choices = '["Your card and billing details","Staff certificates and their expiry dates","Who changed what in the audit log","Your account password"]'::jsonb
-- where choices = '["Resident medication records","Staff certificates and their expiry dates","A resident’s diagnosis","The MAR"]'::jsonb
--    and correct_index = 1;
