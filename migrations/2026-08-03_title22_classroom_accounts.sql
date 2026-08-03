-- Title22 trainer classroom accounts (Section: trainer program, part 2).
-- Additive. Only touches title22_* columns on profiles — never the shared
-- ones (plan, stripe_subscription_id, plan_expires_at, trial_ends_at,
-- access_granted).
--
-- Run in the Supabase SQL editor for project nwlhsshvqmbhemhxcran, after
-- 2026-08-03_title22_trainers.sql.

-- Partner-admin only: grant a full, never-expiring classroom account to a
-- trainer who has already signed up for a normal free account. 'edu' is an
-- existing plan tier in the title22-ai Worker's limits (100,000 AI calls/mo)
-- — this just points an existing profile at it and clears any expiry.
-- Does NOT create the account or seed sample data — the trainer signs up
-- themselves and seeds their own facility with the in-app "Load sample
-- facility" button; this only removes the trial clock.
create or replace function public.title22_grant_classroom_account(p_email text)
returns table(found boolean, profile_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;

  if v_id is null then
    return query select false, null::uuid;
    return;
  end if;

  update public.profiles
  set title22_plan = 'edu', title22_plan_expires_at = null
  where id = v_id;

  return query select true, v_id;
end;
$$;

grant execute on function public.title22_grant_classroom_account(text) to authenticated;
