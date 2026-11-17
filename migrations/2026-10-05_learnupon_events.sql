-- LearnUpon webhook log, for testing a training partner's course completions. 2026-10-05.
--
-- Written only by the title22-learnupon Worker (service role). One row per
-- webhook event from the partner's LearnUpon SANDBOX portal: test learners only, no
-- resident information, ever. This is a log to see what LearnUpon sends; it is
-- not training hours. Nothing in the app reads it. Since
-- 2026-10-06_learnupon_training_hours.sql the Worker also turns a course
-- completion into staff_trainings rows, and says on each row whether it did.
--
-- RLS on with no policies: the browser cannot read or write it. Safe to run
-- twice. When testing ends: `drop table public.learnupon_events;`

create table if not exists public.learnupon_events (
  id                    bigint generated always as identity primary key,
  received_at           timestamptz not null default now(),
  delivery_id           text,
  webhook_version       smallint not null,
  webhook_type          text,
  enrollment_id         bigint,
  course_id             bigint,
  course_name           text,
  course_reference_code text,
  learner_id            bigint,
  learner_username      text,
  learner_email         text,
  status                text,
  percentage            numeric,
  credit_hours          numeric,
  completed_at          timestamptz,
  payload               jsonb not null
);

-- LearnUpon retries a delivery it thinks failed; the Worker inserts with
-- on_conflict on these three and ignores the duplicate.
create unique index if not exists learnupon_events_dedupe
  on public.learnupon_events (enrollment_id, completed_at, webhook_type);

alter table public.learnupon_events enable row level security;
revoke all on public.learnupon_events from anon, authenticated;
