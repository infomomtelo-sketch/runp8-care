-- Tello partner mode: notes ("Remember this").
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Safe to re-run.
-- Run AFTER 2026-09-27_tello_partner.sql.
--
-- A note is a row in tello_founder_messages with kind = 'note': something the
-- owner asked Tello to remember, in his words. Only the Worker writes them
-- (no insert grant for signed-in users, as before); the owner reads and
-- deletes his own under the existing policies. This only widens the list of
-- allowed kinds. Until it runs, "Remember this" says notes are not switched
-- on yet, and everything else works.

alter table public.tello_founder_messages
  drop constraint if exists tello_founder_messages_kind_check;
alter table public.tello_founder_messages
  add constraint tello_founder_messages_kind_check
  check (kind in ('chat','today','weekly','marker','note'));

-- Expect one row: the constraint, with 'note' in it.
select conname, pg_get_constraintdef(oid) as rule
  from pg_constraint
 where conname = 'tello_founder_messages_kind_check';
