-- Charrise: "talk to my assistant" at title22.app/meet (2026-09-29).
--
-- Visitors talk to Charrise without an account, so everything the public can
-- reach is on the title22-ai Worker, which uses the service role. Nothing in
-- this file is readable by anon or by a signed-in customer.
--
--   1. assistant_leads      what a visitor sends with "Send to Eli": a name,
--                           how to reach them, what they need, and a short
--                           summary of the chat. The chat itself is not kept.
--   2. assistant_usage      a counter per day per key (a hashed visitor, or the
--                           whole assistant), so strangers cannot run up the
--                           model bill. No IP address is stored, only a hash.
--   3. assistant_take()     counts one use and says whether it is allowed.
--                           Service role only.
--   4. title22_assistant_leads() / title22_assistant_lead_status()
--                           the owner's list in Tello's Cabinet. Partner-admin
--                           only, like 2026-09-28's functions.
--
-- Additive and safe to run twice.

create table if not exists public.assistant_leads (
  id uuid primary key default gen_random_uuid(),
  assistant text not null,
  kind text not null default 'follow-up' check (kind in ('follow-up','wants-own')),
  name text not null check (char_length(name) between 1 and 120),
  contact text not null check (char_length(contact) between 3 and 200),
  business text check (business is null or char_length(business) <= 200),
  message text check (message is null or char_length(message) <= 2000),
  summary text check (summary is null or char_length(summary) <= 2000),
  language text check (language is null or char_length(language) <= 20),
  status text not null default 'new' check (status in ('new','done')),
  created_at timestamptz not null default now()
);
alter table public.assistant_leads enable row level security;
revoke all on public.assistant_leads from anon, authenticated;

create table if not exists public.assistant_usage (
  day date not null,
  key text not null,
  count integer not null default 0,
  primary key (day, key)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

-- Returns how many uses are left today after this one, or -1 if this one is
-- over the limit (and so refused).
create or replace function public.assistant_take(p_key text, p_limit integer)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.assistant_usage (day, key, count)
  values ((now() at time zone 'America/Los_Angeles')::date, p_key, 1)
  on conflict (day, key) do update set count = public.assistant_usage.count + 1
  returning case when count <= p_limit then p_limit - count else -1 end;
$$;
revoke all on function public.assistant_take(text, integer) from public, anon, authenticated;
grant execute on function public.assistant_take(text, integer) to service_role;

create or replace function public.title22_assistant_leads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(l) order by l.status = 'done', l.created_at desc)
      from (select id, assistant, kind, name, contact, business, message, summary, language, status, created_at
              from public.assistant_leads
             order by created_at desc limit 100) l), '[]'::jsonb);
end;
$$;
revoke all on function public.title22_assistant_leads() from public, anon;
grant execute on function public.title22_assistant_leads() to authenticated;

create or replace function public.title22_assistant_lead_status(p_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  if p_status not in ('new','done') then
    raise exception 'status must be new or done';
  end if;
  update public.assistant_leads set status = p_status where id = p_id;
  return found;
end;
$$;
revoke all on function public.title22_assistant_lead_status(uuid, text) from public, anon;
grant execute on function public.title22_assistant_lead_status(uuid, text) to authenticated;

-- Check it worked (read-only):
--   select (select count(*) from information_schema.tables where table_name = 'assistant_leads') as leads_table,
--          (select count(*) from pg_proc where proname = 'assistant_take') as counter;
--   Both should be 1.
