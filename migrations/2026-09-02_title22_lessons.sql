-- Title22 — classroom lessons and knowledge checks
-- Trainer-authored reading + light multiple-choice, used for participation in
-- class. Deliberately NOT connected to staff_trainings: a quiz result is a
-- quiz result, never a training record an inspector would read. Certification
-- comes from the state exam, not from anything in here.

-- ---------------------------------------------------------------- lessons --
create table if not exists public.title22_lessons (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  created_by   uuid not null references auth.users(id),
  title        text not null,
  body         text,                        -- the reading itself
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists title22_lessons_facility_idx
  on public.title22_lessons (facility_id, sort_order);

-- -------------------------------------------------------------- questions --
create table if not exists public.title22_lesson_questions (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.title22_lessons(id) on delete cascade,
  prompt       text not null,
  choices      jsonb not null,              -- ["A","B","C","D"]
  correct_index int not null,
  sort_order   int not null default 0,
  constraint title22_lesson_questions_choices_is_array
    check (jsonb_typeof(choices) = 'array'),
  constraint title22_lesson_questions_correct_in_range
    check (correct_index >= 0 and correct_index < jsonb_array_length(choices))
);

create index if not exists title22_lesson_questions_lesson_idx
  on public.title22_lesson_questions (lesson_id, sort_order);

-- --------------------------------------------------------------- attempts --
-- One row per submission. Retakes add rows; nothing is overwritten.
create table if not exists public.title22_lesson_attempts (
  id             uuid primary key default gen_random_uuid(),
  lesson_id      uuid not null references public.title22_lessons(id) on delete cascade,
  facility_id    uuid not null references public.facilities(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  answers        jsonb not null default '[]'::jsonb,
  score          int  not null default 0,   -- questions answered correctly
  total          int  not null default 0,   -- questions on the lesson
  submitted_at   timestamptz not null default now()
);

create index if not exists title22_lesson_attempts_lesson_idx
  on public.title22_lesson_attempts (lesson_id, submitted_at desc);
create index if not exists title22_lesson_attempts_user_idx
  on public.title22_lesson_attempts (user_id, submitted_at desc);

-- ------------------------------------------------------------------- RLS --
alter table public.title22_lessons           enable row level security;
alter table public.title22_lesson_questions  enable row level security;
alter table public.title22_lesson_attempts   enable row level security;

-- A member of the facility can read its lessons; only the facility owner
-- writes them. Same shape as the rest of the schema: scoped by facility.
drop policy if exists title22_lessons_read on public.title22_lessons;
create policy title22_lessons_read on public.title22_lessons
  for select using (
    facility_id in (
      select f.id from public.facilities f where f.user_id = auth.uid()
      union
      select m.facility_id from public.facility_members m where m.user_id = auth.uid()
    )
  );

drop policy if exists title22_lessons_write on public.title22_lessons;
create policy title22_lessons_write on public.title22_lessons
  for all using (
    facility_id in (select f.id from public.facilities f where f.user_id = auth.uid())
  ) with check (
    facility_id in (select f.id from public.facilities f where f.user_id = auth.uid())
  );

drop policy if exists title22_lesson_questions_read on public.title22_lesson_questions;
create policy title22_lesson_questions_read on public.title22_lesson_questions
  for select using (
    lesson_id in (select l.id from public.title22_lessons l)
  );

drop policy if exists title22_lesson_questions_write on public.title22_lesson_questions;
create policy title22_lesson_questions_write on public.title22_lesson_questions
  for all using (
    lesson_id in (
      select l.id from public.title22_lessons l
      join public.facilities f on f.id = l.facility_id
      where f.user_id = auth.uid()
    )
  ) with check (
    lesson_id in (
      select l.id from public.title22_lessons l
      join public.facilities f on f.id = l.facility_id
      where f.user_id = auth.uid()
    )
  );

-- A student sees only their own attempts. The facility owner sees all of them,
-- which is how a trainer checks who took part.
drop policy if exists title22_lesson_attempts_read on public.title22_lesson_attempts;
create policy title22_lesson_attempts_read on public.title22_lesson_attempts
  for select using (
    user_id = auth.uid()
    or facility_id in (select f.id from public.facilities f where f.user_id = auth.uid())
  );

drop policy if exists title22_lesson_attempts_insert on public.title22_lesson_attempts;
create policy title22_lesson_attempts_insert on public.title22_lesson_attempts
  for insert with check (
    user_id = auth.uid()
    and facility_id in (
      select f.id from public.facilities f where f.user_id = auth.uid()
      union
      select m.facility_id from public.facility_members m where m.user_id = auth.uid()
    )
  );
