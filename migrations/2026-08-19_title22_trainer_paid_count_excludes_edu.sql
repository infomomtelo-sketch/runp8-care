-- Trainer signups report: stop counting classroom accounts as paid customers.
--
-- Run in the Supabase SQL editor for project nwlhsshvqmbhemhxcran. Safe to
-- re-run. Replaces the function body only — same signature, same return
-- columns, so nothing else has to change.
--
-- Why: 2026-08-03_title22_classroom_accounts.sql added the 'edu' plan, a
-- free, never-expiring classroom account granted to trainers by a partner
-- admin. title22_trainer_signups() was written before that plan existed, so
-- its paid_count filter only excluded 'trial' and 'free' — every classroom
-- account a trainer was granted showed up in the Paid column of the partner
-- report, the number commissions are paid against. A trainer with three
-- classroom accounts and no customers read as three conversions.

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
