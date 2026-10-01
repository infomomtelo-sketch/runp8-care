-- Team members of a Lite or Multi-Home home are covered by that home's plan.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Safe to re-run: it only
-- replaces one function. No table, column or row is touched.
--
-- Why: title22_member_entitlement (2026-08-19) lets an invited caregiver run on
-- the plan of the home they were invited to, instead of their own trial. Its
-- list of covering plans was written before Lite and Multi-Home existed —
-- 'starter','pro','specialist','agency' — and was never updated. So on the two
-- plans actually sold, an invited team member was covered only by their own
-- 30-day trial, and went read-only the day it ended, while the home was paid
-- for. Checked on the live database 2026-10-01: covers_lite = false,
-- covers_multi = false, and 0 members under a Lite or Multi-Home owner yet, so
-- nobody had been locked out.
--
-- What changes, and nothing else:
--   1. 'lite' and 'multi' cover a team, under the same expiry rule as every
--      paid plan: no end date, or an end date still in the future. A cancelled
--      plan keeps covering its team until its paid period ends, then stops.
--   2. They are ranked, so someone on two teams gets the more capable plan:
--      agency 7, specialist 6, multi 5, pro 4, lite 3, starter 2, edu 1.
--      The old plans keep their order relative to each other.
-- The plan key is 'multi', never 'multi-home': the Stripe Worker folds every
-- spelling to 'multi' before it writes profiles.title22_plan.
--
-- The app needs no change: resolveTierLimits() already accepts whatever plan
-- this returns, looks it up in TIER_LIMITS (lite and multi are there), and caps
-- an inherited plan at zero owned facilities.

create or replace function public.title22_member_entitlement()
returns table(entitled boolean, plan text, facility_id uuid, facility_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select false, null::text, null::uuid, null::text;
    return;
  end if;

  -- Facilities this person is a member of but does not own. An owner is
  -- already covered by their own profiles row, which is the path the client
  -- tries first; this is only the fallback for everybody else.
  --
  -- Ordered so the most capable covering plan wins: someone on the team of
  -- two facilities gets the better of the two, the same as if they owned it.
  return query
  with covering as (
    select f.id, f.name, p.title22_plan as plan,
           case p.title22_plan
             when 'agency' then 7 when 'specialist' then 6
             when 'multi' then 5 when 'pro' then 4
             when 'lite' then 3 when 'starter' then 2
             when 'edu' then 1 else 0 end as rank
      from public.facility_members m
      join public.facilities f on f.id = m.facility_id
      join public.profiles   p on p.id = f.user_id
     where m.user_id = v_uid
       and f.user_id <> v_uid
       and (
         -- edu never expires; it is the free teaching tier.
         p.title22_plan = 'edu'
         or (
           p.title22_plan in ('lite','multi','starter','pro','specialist','agency')
           and (p.title22_plan_expires_at is null or p.title22_plan_expires_at > now())
         )
         -- A facility owner still inside their own trial covers their team
         -- too. Otherwise a trial cannot be evaluated with staff, which is
         -- the thing the trial is for.
         or (
           coalesce(p.title22_plan, 'trial') = 'trial'
           and p.title22_trial_ends_at is not null
           and p.title22_trial_ends_at > now()
         )
       )
  )
  select true, c.plan, c.id, c.name
    from covering c
   order by c.rank desc
   limit 1;

  if not found then
    return query select false, null::text, null::uuid, null::text;
  end if;
end $$;

grant execute on function public.title22_member_entitlement() to authenticated;

-- Check (read-only), after running the above:
-- select position('''lite''' in pg_get_functiondef('public.title22_member_entitlement'::regproc)) > 0 as covers_lite,
--        position('''multi''' in pg_get_functiondef('public.title22_member_entitlement'::regproc)) > 0 as covers_multi;
