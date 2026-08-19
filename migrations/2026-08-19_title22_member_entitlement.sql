-- A caregiver you invited is covered by your plan, not by their own trial.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and safe to
-- re-run.
--
-- Why this exists: access is decided by readEntitlement(), which reads exactly
-- one row — the signed-in person's own profiles row. Being a member of a
-- facility grants nothing. So an invited caregiver runs on their own 14-day
-- trial and, on day 15, is locked out to a billing page and asked to
-- subscribe — while the facility they work in is paid for by somebody else.
--
-- Every plan is priced per facility, and Team access exists so a facility can
-- put its staff in the app. A team that stops working after two weeks makes
-- that feature pointless.
--
-- The client cannot check this for itself: row level security will not let a
-- caregiver read the facility owner's profiles row, and it should not — that
-- row carries the owner's plan, subscription id and expiry. So the check
-- happens here, under SECURITY DEFINER, and only ever answers one question:
-- is a facility this person actually belongs to covered right now.
--
-- What it deliberately does NOT do: say whose plan it is, when it expires, or
-- anything else about the owner's billing. It returns the plan tier, because
-- the tier decides whether the AI assistant is available, and the facility
-- name, so the app can say where the access came from.

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
             when 'agency' then 5 when 'specialist' then 4
             when 'pro' then 3 when 'starter' then 2
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
           p.title22_plan in ('starter','pro','specialist','agency')
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

-- Note for whoever reads this next: the app caps an inherited plan at zero
-- OWNED facilities. Inheriting 'agency' from a facility you were invited to
-- must not let you create five facilities of your own on somebody else's
-- subscription. That cap is in resolveTierLimits(), not here — this function
-- only reports what covers you.
