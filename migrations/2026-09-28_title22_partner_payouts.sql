-- Title22 partners: types, a payout record, and one report for the owner.
-- 2026-09-28. For the Partners drawer in Tello's Cabinet (tello.html).
--
-- What it adds, all additive and safe to run twice:
--   1. title22_trainers.kind      trainer | affiliate | graduate (default trainer)
--   2. title22_partner_payouts    one row per partner per month you paid them
--   3. title22_partner_report()   every code: signups, trials, paying, what
--                                 this month's commission comes to at list
--                                 price, what has been paid; plus codes
--                                 people used that are not registered yet
--   4. title22_update_partner()   pause/resume a code, change type, rate, trial
--   5. title22_record_payout()    record that you paid someone for a month
--   6. title22_delete_payout()    remove a payout recorded by mistake
--
-- Every function checks profiles.title22_is_partner_admin itself, like the
-- 2026-08-03 functions. Nothing here moves money: you pay the partner (Zelle,
-- PayPal, a cheque) and record it here. The commission figure is list price
-- times the rate on subscriptions active in OUR table, not Stripe invoices:
-- check Stripe before you pay.
--
-- Students are never named: the report gives each signup's date and status
-- only (no email, no name), which is all a payout needs.
--
-- Needs 2026-08-03_title22_trainers.sql (title22_trainers) and
-- public.subscriptions, both already in the live database.

-- 1. Partner type ------------------------------------------------------------
alter table public.title22_trainers
  add column if not exists kind text not null default 'trainer';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'title22_trainers_kind_check') then
    alter table public.title22_trainers
      add constraint title22_trainers_kind_check check (kind in ('trainer','affiliate','graduate'));
  end if;
end $$;

-- 2. Payouts -----------------------------------------------------------------
create table if not exists public.title22_partner_payouts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.title22_trainers(id) on delete restrict,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_cents integer not null check (amount_cents >= 0 and amount_cents <= 10000000),
  method text,
  note text,
  paid_at timestamptz not null default now(),
  recorded_by uuid,
  -- One payment per partner per month, so the same month cannot be paid twice
  -- by a second tap. A correction is delete-then-record.
  unique (trainer_id, period)
);

alter table public.title22_partner_payouts enable row level security;
revoke all on public.title22_partner_payouts from anon, authenticated;

-- 3. The report ---------------------------------------------------------------
create or replace function public.title22_partner_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  this_month text := to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;

  with
  subs as (
    select distinct on (s.user_id, s.stripe_subscription_id)
           s.user_id, s.status,
           case
             when lower(replace(replace(trim(s.plan),'_','-'),' ','-')) in ('multi','multi-home','multihome') then 'multi'
             else lower(trim(s.plan))
           end as plan
      from public.subscriptions s
  ),
  -- One paying plan per account: the dearest active one, so two rows for the
  -- same person are never counted twice.
  paying as (
    select distinct on (user_id) user_id, plan,
           case plan when 'lite' then 29 when 'multi' then 79 when 'starter' then 49
                     when 'pro' then 79 when 'specialist' then 149 end as list_usd
      from subs
     where status = 'active'
       and plan in ('lite','multi','starter','pro','specialist','agency')
     order by user_id,
              case plan when 'specialist' then 149 when 'multi' then 79 when 'pro' then 79
                        when 'starter' then 49 when 'lite' then 29 else 0 end desc
  ),
  referred as (
    select p.id, p.created_at, p.title22_plan, p.title22_trial_ends_at, p.referred_by,
           pay.plan as paid_plan, pay.list_usd,
           case
             when pay.user_id is not null then 'paying'
             when p.title22_plan = 'edu' then 'classroom'
             when p.title22_plan = 'trial' and p.title22_trial_ends_at > now() then 'trial'
             when p.title22_plan = 'trial' then 'trial ended'
             else 'signed up'
           end as status
      from public.profiles p
      left join paying pay on pay.user_id = p.id
     where p.referred_by is not null and p.referred_by <> ''
  ),
  per as (
    select t.id, t.code, t.name, t.email, t.kind, t.active, t.commission_rate, t.trial_days, t.created_at,
           (select count(*) from referred r where r.referred_by = t.code)                          as signups,
           (select count(*) from referred r where r.referred_by = t.code and r.status = 'trial')   as trials,
           (select count(*) from referred r where r.referred_by = t.code and r.status = 'paying')  as paying,
           (select count(*) from referred r where r.referred_by = t.code and r.status = 'paying'
                                             and r.list_usd is null)                                as unpriced,
           (select coalesce(sum(r.list_usd), 0) from referred r
             where r.referred_by = t.code and r.status = 'paying')                                  as list_usd,
           (select coalesce(sum(x.amount_cents), 0) from public.title22_partner_payouts x
             where x.trainer_id = t.id)                                                             as paid_cents,
           (select max(x.period) from public.title22_partner_payouts x where x.trainer_id = t.id)   as last_period,
           exists (select 1 from public.title22_partner_payouts x
                    where x.trainer_id = t.id and x.period = this_month)                            as paid_this_month
      from public.title22_trainers t
  )
  select jsonb_build_object(
    'as_of', now(),
    'this_month', this_month,
    'note', 'Commission is list price x the partner''s rate, on subscriptions active in our own table right now. It is not Stripe. Check Stripe before paying.',
    'partners', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', per.id, 'code', per.code, 'name', per.name, 'email', per.email,
               'kind', per.kind, 'active', per.active,
               'commission_rate', per.commission_rate, 'trial_days', per.trial_days,
               'created_at', per.created_at,
               'signups', per.signups, 'trials', per.trials, 'paying', per.paying,
               'unpriced', per.unpriced,
               'monthly_list_usd', per.list_usd,
               'commission_month_usd', round(per.list_usd * per.commission_rate, 2),
               'paid_out_usd', round(per.paid_cents / 100.0, 2),
               'last_paid_period', per.last_period,
               'paid_this_month', per.paid_this_month,
               'students', coalesce((
                  select jsonb_agg(jsonb_build_object('signed_up', r.created_at, 'status', r.status, 'plan', r.paid_plan)
                                   order by r.created_at desc)
                    from (select * from referred r where r.referred_by = per.code
                          order by r.created_at desc limit 50) r), '[]'::jsonb),
               'payouts', coalesce((
                  select jsonb_agg(jsonb_build_object('id', x.id, 'period', x.period,
                                   'amount_usd', round(x.amount_cents / 100.0, 2),
                                   'method', x.method, 'note', x.note, 'paid_at', x.paid_at)
                                   order by x.period desc)
                    from (select * from public.title22_partner_payouts x where x.trainer_id = per.id
                          order by x.period desc limit 24) x), '[]'::jsonb)
             ) order by per.active desc, per.signups desc, per.created_at desc)
        from per), '[]'::jsonb),
    -- Codes people signed up with that nobody has registered yet. They still
    -- count once registered: the report joins at read time.
    'unregistered_codes', coalesce((
      select jsonb_agg(jsonb_build_object('code', q.referred_by, 'signups', q.n) order by q.n desc)
        from (select r.referred_by, count(*) as n from referred r
               where not exists (select 1 from public.title22_trainers t where t.code = r.referred_by)
               group by r.referred_by order by count(*) desc limit 25) q), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.title22_partner_report() from public, anon;
grant execute on function public.title22_partner_report() to authenticated;

-- 4. Change a partner ---------------------------------------------------------
-- Null leaves a field as it is. A trial is never set below 30 days: a partner
-- link must never give a shorter trial than a stranger gets.
create or replace function public.title22_update_partner(
  p_id uuid,
  p_active boolean default null,
  p_kind text default null,
  p_commission_rate numeric default null,
  p_trial_days integer default null
)
returns public.title22_trainers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.title22_trainers;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  if p_kind is not null and p_kind not in ('trainer','affiliate','graduate') then
    raise exception 'kind must be trainer, affiliate or graduate';
  end if;
  if p_commission_rate is not null and (p_commission_rate < 0 or p_commission_rate > 0.5) then
    raise exception 'commission must be between 0%% and 50%%';
  end if;
  if p_trial_days is not null and (p_trial_days < 30 or p_trial_days > 365) then
    raise exception 'trial must be between 30 and 365 days';
  end if;
  update public.title22_trainers
     set active          = coalesce(p_active, active),
         kind            = coalesce(p_kind, kind),
         commission_rate = coalesce(p_commission_rate, commission_rate),
         trial_days      = coalesce(p_trial_days, trial_days)
   where id = p_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'no such partner';
  end if;
  return v_row;
end;
$$;

revoke all on function public.title22_update_partner(uuid, boolean, text, numeric, integer) from public, anon;
grant execute on function public.title22_update_partner(uuid, boolean, text, numeric, integer) to authenticated;

-- 5. Record a payout ----------------------------------------------------------
create or replace function public.title22_record_payout(
  p_trainer_id uuid,
  p_period text,
  p_amount_cents integer,
  p_method text default null,
  p_note text default null
)
returns public.title22_partner_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.title22_partner_payouts;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  if exists (select 1 from public.title22_partner_payouts where trainer_id = p_trainer_id and period = p_period) then
    raise exception 'already recorded for %', p_period;
  end if;
  insert into public.title22_partner_payouts (trainer_id, period, amount_cents, method, note, recorded_by)
  values (p_trainer_id, p_period, p_amount_cents, nullif(trim(coalesce(p_method,'')), ''),
          nullif(trim(coalesce(p_note,'')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.title22_record_payout(uuid, text, integer, text, text) from public, anon;
grant execute on function public.title22_record_payout(uuid, text, integer, text, text) to authenticated;

-- 6. Remove a payout recorded by mistake --------------------------------------
create or replace function public.title22_delete_payout(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  delete from public.title22_partner_payouts where id = p_id;
  return found;
end;
$$;

revoke all on function public.title22_delete_payout(uuid) from public, anon;
grant execute on function public.title22_delete_payout(uuid) to authenticated;

-- Check it worked (read-only):
--   select jsonb_pretty(public.title22_partner_report());   -- run as yourself in the app, not here:
--   the SQL editor has no auth.uid(), so it answers 'not authorized'. That is correct.
--   select count(*) from public.title22_partner_payouts;     -- 0 on a first run
