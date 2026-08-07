-- Title22 product usage events: lightweight analytics so we can see real
-- usage instead of guessing. Additive and idempotent — creates a new table
-- with its own policies and does not touch any existing RLS policy.
--
-- Write model: clients INSERT their own rows only (user_id must equal
-- auth.uid()). Rows are never updated or deleted by clients. Reads are
-- limited to partner admins; the Supabase dashboard uses the service role
-- and bypasses RLS, so events are visible there regardless.

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  facility_id uuid,
  role        text,
  event_name  text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_created_idx
  on public.events (created_at desc);
create index if not exists events_name_created_idx
  on public.events (event_name, created_at desc);
create index if not exists events_user_created_idx
  on public.events (user_id, created_at desc);

alter table public.events enable row level security;

-- Callers may only write rows attributed to themselves.
drop policy if exists events_self_insert on public.events;
create policy events_self_insert on public.events
  for insert to authenticated
  with check (user_id = auth.uid());

-- App-owner analytics read (same partner-admin flag used elsewhere).
drop policy if exists events_partner_admin_read on public.events;
create policy events_partner_admin_read on public.events
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.title22_is_partner_admin
  ));

revoke all on public.events from anon, authenticated;
grant insert, select on public.events to authenticated;
