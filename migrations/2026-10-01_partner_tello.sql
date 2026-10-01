-- Partner Tello (title22.app/meet): the tables and functions behind it.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive only: four new
-- tables and eight new functions, every name starting partner_tello. Nothing
-- existing is read, changed or dropped. Safe to re-run: tables are
-- "if not exists", functions are "create or replace", and the secret and the
-- test row are only created when missing.
--
-- How it is kept apart from everything else in this database:
--
--   The partner-tello Worker holds NO service key. It calls these functions
--   with the public anon key, and every function first checks p_secret against
--   partner_tello_config.secret, a random value this file generates in the
--   database. Without that value a caller gets "forbidden" and nothing else.
--   With it, a caller can still only reach the four partner_tello tables:
--   there is no function here that reads a facility, a staff record, a profile
--   or any other app table. So the Worker never sees facility, staff or user
--   data, and a leaked Worker secret exposes Partner Tello's own messages and
--   nothing more.
--
--   The tables have RLS on with no policies, and anon/authenticated have no
--   grants on them, so the anon key cannot read them directly either.
--
-- AFTER RUNNING, two things the owner does by hand (the values never go in git):
--
--   1. Copy the Worker secret into Cloudflare as PARTNER_TELLO_DB_SECRET:
--        select secret from public.partner_tello_config;
--
--   2. Set where the emails go and who they come from (EMAIL_FROM must be a
--      sender on a domain verified in Resend, the same one title22-email uses):
--        update public.partner_tello_config
--           set notify_to = '<the owner''s address>',
--               email_from = 'Title22 Partner Tello <noreply@your-verified-domain>';
--      They live here, not in wrangler.toml, because this repository is
--      public and the owner's address must not be in it.
--
-- The test link (the only row this file creates; no real person):
--        select key from public.partner_tello_links where name = 'Test Partner';
--   title22.app/meet?k=<that key>. The same key is the GitHub secret
--   PARTNER_TELLO_TEST_KEY that the live-test workflow uses.
--
-- A real partner's link, when the owner decides to send one:
--        insert into public.partner_tello_links (name, org, email, brief)
--        values ('<name>', '<organisation>', '<email>', '<what they want>')
--        returning key;
--   Turn one off:  update public.partner_tello_links set active = false where key = '<key>';

-- ---------------------------------------------------------------- tables --

create table if not exists public.partner_tello_config (
  id         boolean primary key default true check (id),   -- exactly one row
  secret     text not null,
  notify_to  text,
  email_from text,
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_tello_links (
  key        text primary key
             default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
             check (length(key) >= 24),
  name       text not null,
  org        text,
  email      text,
  brief      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- role: 'user' (the partner), 'tello' (her reply), 'direct' ("Message the team
-- directly"). The email columns sit on the row that STARTED an exchange: the
-- partner's message or a direct message. Tello's reply rides in that email.
create table if not exists public.partner_tello_messages (
  id              bigint generated always as identity primary key,
  link_key        text not null references public.partner_tello_links(key),
  conversation_id uuid not null,
  role            text not null check (role in ('user', 'tello', 'direct')),
  text            text not null check (length(text) <= 4000),
  created_at      timestamptz not null default now(),
  email_status    text check (email_status in ('pending', 'sent', 'failed')),
  email_attempts  int not null default 0,
  email_error     text,
  emailed_at      timestamptz
);
create index if not exists partner_tello_messages_conv
  on public.partner_tello_messages (link_key, conversation_id, id);
create index if not exists partner_tello_messages_unsent
  on public.partner_tello_messages (id) where email_status in ('pending', 'failed');

-- Messages per key per hour, for the 30-an-hour limit.
create table if not exists public.partner_tello_usage (
  link_key text not null,
  hour     timestamptz not null,
  n        int not null default 0,
  primary key (link_key, hour)
);

alter table public.partner_tello_config   enable row level security;
alter table public.partner_tello_links    enable row level security;
alter table public.partner_tello_messages enable row level security;
alter table public.partner_tello_usage    enable row level security;
revoke all on public.partner_tello_config, public.partner_tello_links,
              public.partner_tello_messages, public.partner_tello_usage
  from anon, authenticated;

-- The Worker's secret: 64 hex characters from two random UUIDs. Generated
-- here, never written in any file.
insert into public.partner_tello_config (id, secret)
select true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where not exists (select 1 from public.partner_tello_config);

-- The one test row. Invented: no real person, no real company.
insert into public.partner_tello_links (name, org, email, brief)
select 'Test Partner', 'Sample Training Co.', null,
       'Sample row for testing. A training company that teaches new RCFE caregivers and wants to know how the trainer program works and whether courses can run inside Title22.'
where not exists (select 1 from public.partner_tello_links where name = 'Test Partner');

-- ------------------------------------------------------------- functions --
-- All: security definer, search_path pinned to '' and every name qualified,
-- callable by anon (the Worker), refused without the secret.

create or replace function public.partner_tello_check(p_secret text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_secret is null or length(p_secret) < 32 or not exists (
    select 1 from public.partner_tello_config c where c.secret = p_secret
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- The link: who it is for, or nothing at all if it is unknown or turned off.
create or replace function public.partner_tello_open(p_secret text, p_key text)
returns table(name text, org text, brief text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.partner_tello_check(p_secret);
  return query
    select l.name, l.org, l.brief
      from public.partner_tello_links l
     where l.key = p_key and l.active;
end $$;

-- Counts one message against the hour. Returns how many are left (negative =
-- over the limit), or null when the key is not an active link.
create or replace function public.partner_tello_take(p_secret text, p_key text, p_limit int)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform public.partner_tello_check(p_secret);
  if not exists (select 1 from public.partner_tello_links l where l.key = p_key and l.active) then
    return null;
  end if;
  insert into public.partner_tello_usage as u (link_key, hour, n)
  values (p_key, date_trunc('hour', now()), 1)
  on conflict (link_key, hour) do update set n = u.n + 1
  returning u.n into v_n;
  delete from public.partner_tello_usage where hour < now() - interval '2 days';
  return p_limit - v_n;
end $$;

-- Stores one message. Returns its id. A 'user' or 'direct' row starts as
-- email_status 'pending'; a 'tello' row has no email status of its own.
create or replace function public.partner_tello_log(
  p_secret text, p_key text, p_conversation_id uuid, p_role text, p_text text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform public.partner_tello_check(p_secret);
  if not exists (select 1 from public.partner_tello_links l where l.key = p_key and l.active) then
    raise exception 'inactive link' using errcode = '42501';
  end if;
  insert into public.partner_tello_messages (link_key, conversation_id, role, text, email_status)
  values (p_key, p_conversation_id, p_role, left(p_text, 4000),
          case when p_role in ('user', 'direct') then 'pending' end)
  returning id into v_id;
  return v_id;
end $$;

-- One conversation, oldest first, up to and including p_upto (all of it when
-- null). Used for Tello's context and for each email.
create or replace function public.partner_tello_history(
  p_secret text, p_key text, p_conversation_id uuid, p_upto bigint default null)
returns table(id bigint, role text, text text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.partner_tello_check(p_secret);
  return query
    select m.id, m.role, m.text, m.created_at
      from public.partner_tello_messages m
     where m.link_key = p_key and m.conversation_id = p_conversation_id
       and (p_upto is null or m.id <= p_upto
            -- Tello's reply to p_upto belongs in that exchange's email
            or (m.role = 'tello' and m.id = (select min(x.id) from public.partner_tello_messages x
                                              where x.link_key = p_key and x.conversation_id = p_conversation_id
                                                and x.id > p_upto)))
     order by m.id
     limit 200;
end $$;

-- Records one send attempt.
create or replace function public.partner_tello_mark_email(
  p_secret text, p_id bigint, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.partner_tello_check(p_secret);
  update public.partner_tello_messages
     set email_attempts = email_attempts + 1,
         email_status   = case when p_ok then 'sent' else 'failed' end,
         email_error    = case when p_ok then null else left(p_error, 500) end,
         emailed_at     = case when p_ok then now() else emailed_at end
   where id = p_id;
end $$;

-- Emails still owed, for the Worker's retry run: older than two minutes (the
-- first try is still in flight before that), fewer than 8 tries.
create or replace function public.partner_tello_unsent(p_secret text)
returns table(id bigint, link_key text, conversation_id uuid, role text, text text,
              name text, org text, email_attempts int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.partner_tello_check(p_secret);
  return query
    select m.id, m.link_key, m.conversation_id, m.role, m.text, l.name, l.org, m.email_attempts
      from public.partner_tello_messages m
      join public.partner_tello_links l on l.key = m.link_key
     where m.email_status in ('pending', 'failed')
       and m.email_attempts < 8
       and m.created_at < now() - interval '2 minutes'
     order by m.id
     limit 20;
end $$;

-- Where the emails go. Read by the Worker only.
create or replace function public.partner_tello_mail_config(p_secret text)
returns table(notify_to text, email_from text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.partner_tello_check(p_secret);
  return query select c.notify_to, c.email_from from public.partner_tello_config c;
end $$;

-- Functions are executable by PUBLIC by default; be explicit about who.
revoke all on function public.partner_tello_check(text) from public;
revoke all on function public.partner_tello_open(text, text) from public;
revoke all on function public.partner_tello_take(text, text, int) from public;
revoke all on function public.partner_tello_log(text, text, uuid, text, text) from public;
revoke all on function public.partner_tello_history(text, text, uuid, bigint) from public;
revoke all on function public.partner_tello_mark_email(text, bigint, boolean, text) from public;
revoke all on function public.partner_tello_unsent(text) from public;
revoke all on function public.partner_tello_mail_config(text) from public;
grant execute on function public.partner_tello_open(text, text) to anon;
grant execute on function public.partner_tello_take(text, text, int) to anon;
grant execute on function public.partner_tello_log(text, text, uuid, text, text) to anon;
grant execute on function public.partner_tello_history(text, text, uuid, bigint) to anon;
grant execute on function public.partner_tello_mark_email(text, bigint, boolean, text) to anon;
grant execute on function public.partner_tello_unsent(text) to anon;
grant execute on function public.partner_tello_mail_config(text) to anon;

-- Check (read-only), after running the above. Expect: 4, 8, 1, 1, true.
-- select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'partner_tello%') as tables,
--        (select count(*) from pg_proc where proname like 'partner_tello%') as functions,
--        (select count(*) from public.partner_tello_config) as config_rows,
--        (select count(*) from public.partner_tello_links) as links,
--        (select length(secret) = 64 from public.partner_tello_config) as secret_ok;
