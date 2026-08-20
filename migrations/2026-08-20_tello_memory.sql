-- Tello remembers.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Safe to re-run.
--
-- One table holding the conversation itself. Deliberately not a table of
-- things Tello decided about you: what is stored is what was actually said,
-- by you and by her, verbatim. She cannot write a memory you did not give
-- her, and there is nothing in here she inferred.
--
-- Every row is owned by one user and readable only by that user. Tello
-- standalone has no facilities, no teams and no sharing — if this table ever
-- grows a way for one person to read another person's rows, that is the
-- moment the whole thing stops being trustworthy.

create table if not exists public.tello_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists tello_messages_user_time
  on public.tello_messages (user_id, created_at);

alter table public.tello_messages enable row level security;

-- Own rows only, on every verb. No update policy at all: a message that was
-- said cannot be rewritten later, only deleted.
do $$
begin
  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='tello_messages' and policyname='tello_messages_own_select') then
    create policy tello_messages_own_select on public.tello_messages
      for select to authenticated using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='tello_messages' and policyname='tello_messages_own_insert') then
    create policy tello_messages_own_insert on public.tello_messages
      for insert to authenticated with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
     where schemaname='public' and tablename='tello_messages' and policyname='tello_messages_own_delete') then
    create policy tello_messages_own_delete on public.tello_messages
      for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- After running this, Tello keeps the conversation between visits, and the
-- Memory button on her page lets anyone read back everything she holds and
-- delete all of it. Deleting is immediate and total — there is no archive.
