-- A staff member trains from their own phone. 2026-10-06.
--
-- The owner's ask: staff who work somewhere else cannot be handed the owner's
-- computer. So the owner makes a link for one staff member and texts it. The
-- staff member opens it on their own phone and lands in the partner's course
-- portal, signed in as their own learner, with no password and no email.
--
--   title22.app/train/<token>  ->  title22-learnupon Worker /t/<token>
--                              ->  the partner portal's SQSSO sign-on
--
-- Staff records have no email, so the learner is given a made-up address that
-- names the staff record and no one: staff-<staff id>@learners.title22.app.
-- The Worker writes a learnupon_learner_links row for that address when the
-- link is made, so a completion by that learner lands on that staff member
-- with no further step.
--
-- Only a SHA-256 of the token is stored: a copy of this table cannot be used
-- to sign anyone in. Making a new link for a staff member switches their old
-- one off. Links expire after 30 days.
--
-- Additive and safe to run twice. Needs 2026-10-06_learnupon_training_hours.sql.
--
-- Undo for the sandbox test:
--   drop table if exists public.learnupon_staff_invites;

create table if not exists public.learnupon_staff_invites (
  token_hash    text primary key,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  use_count     integer not null default 0,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  learner_email text not null,
  first_name    text,
  last_name     text,
  created_by    uuid not null
);
create index if not exists learnupon_staff_invites_staff
  on public.learnupon_staff_invites (staff_id, created_at desc);

-- Worker only (service role). The browser cannot read or write it.
alter table public.learnupon_staff_invites enable row level security;
revoke all on public.learnupon_staff_invites from anon, authenticated;

-- Check: expect true.
select to_regclass('public.learnupon_staff_invites') is not null as staff_links_ready;
