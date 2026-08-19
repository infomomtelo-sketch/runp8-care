-- Title22 trainer partner codes (Section: trainer program).
-- Additive and idempotent. Only touches new title22-owned objects and one
-- new namespaced column on profiles — never touches the shared columns
-- (plan, stripe_subscription_id, plan_expires_at, trial_ends_at,
-- access_granted).
--
-- Run in the Supabase SQL editor for project nwlhsshvqmbhemhxcran.

-- Flags the app owner(s) who can create trainer codes and see signup counts.
-- Namespaced (title22_*), so it's safe alongside the shared profiles table.
alter table public.profiles
  add column if not exists title22_is_partner_admin boolean not null default false;

comment on column public.profiles.title22_is_partner_admin is
  'Title22: can create/manage trainer partner codes and view the signups-per-trainer report. Set manually — see note at the bottom of this file.';

create table if not exists public.title22_trainers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  email text,
  commission_rate numeric not null default 0.20,
  trial_days integer not null default 90,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.title22_trainers enable row level security;

-- Trainer emails and commission rates aren't public. No direct table access
-- for anyone — all reads/writes go through the SECURITY DEFINER functions
-- below (or the Supabase dashboard, which uses the service role).
revoke all on public.title22_trainers from anon, authenticated;

-- Callable by anon (runs during signup, before the user has a session).
-- Returns nothing if the code doesn't exist or is inactive; the caller
-- should fall back to the default 14-day trial in that case.
create or replace function public.title22_check_trainer_code(p_code text)
returns table(trial_days integer)
language sql
security definer
set search_path = public
as $$
  select t.trial_days
  from public.title22_trainers t
  where t.code = lower(trim(p_code)) and t.active
  limit 1;
$$;

grant execute on function public.title22_check_trainer_code(text) to anon, authenticated;

-- Partner-admin only: create a new trainer code. Enforces the admin check
-- itself (SECURITY DEFINER + explicit auth.uid() check), so it's safe to
-- call from any authenticated client.
create or replace function public.title22_create_trainer(
  p_code text,
  p_name text,
  p_email text default null,
  p_commission_rate numeric default 0.20,
  p_trial_days integer default 90
)
returns public.title22_trainers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := lower(regexp_replace(trim(p_code), '[^a-zA-Z0-9\-]', '', 'g'));
  v_row public.title22_trainers;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  if v_code = '' then
    raise exception 'code must contain at least one letter, number, or hyphen';
  end if;
  insert into public.title22_trainers (code, name, email, commission_rate, trial_days)
  values (v_code, p_name, nullif(p_email, ''), p_commission_rate, p_trial_days)
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.title22_create_trainer(text, text, text, numeric, integer) to authenticated;

-- Partner-admin only: signups and conversions per trainer code, for manual
-- monthly payout. Joins on profiles.referred_by (already existed, captured
-- from ?ref= at signup) — no data migration needed for past signups whose
-- ref code happens to match a trainer created after the fact.
create or replace function public.title22_trainer_signups()
returns table(
  trainer_id uuid,
  code text,
  name text,
  commission_rate numeric,
  signup_count bigint,
  paid_count bigint,
  latest_signup timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    t.id,
    t.code,
    t.name,
    t.commission_rate,
    count(p.id) as signup_count,
    count(p.id) filter (where p.title22_plan is not null and p.title22_plan not in ('trial', 'free', 'edu')) as paid_count,
    max(p.created_at) as latest_signup
  from public.title22_trainers t
  left join public.profiles p on p.referred_by = t.code
  group by t.id, t.code, t.name, t.commission_rate
  order by signup_count desc, t.created_at desc;
end;
$$;

grant execute on function public.title22_trainer_signups() to authenticated;

-- After running this migration, make yourself a partner admin (once):
--   update public.profiles set title22_is_partner_admin = true where id = '<your auth user id>';
-- Find your user id in Supabase → Authentication → Users.
