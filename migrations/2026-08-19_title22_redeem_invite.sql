-- Redeem a facility invitation, server-side.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and safe to
-- re-run.
--
-- Why this exists: redeeming an invitation is a chicken-and-egg problem for
-- row level security. The person accepting is, by definition, not yet a member
-- of the facility they are joining — yet the browser had to read the invite row
-- (SELECT on facility_invites), add itself to the facility (INSERT on
-- facility_members), and mark the invite used (UPDATE on facility_invites), all
-- as that non-member. Any facility-scoped policy on those tables refuses all
-- three, and the invitation link silently does nothing.
--
-- The alternatives were both bad: leave those tables readable by every
-- authenticated account, which publishes the invitation tokens; or allow
-- anyone to insert their own facility_members row, which is a self-serve grant
-- of access to a facility's resident records.
--
-- So the whole redemption happens here instead, under SECURITY DEFINER, with
-- the checks the client used to make enforced where they cannot be skipped:
-- the invitation must be pending, and it must have been addressed to the email
-- of the account redeeming it. Same pattern as title22_create_trainer and
-- title22_grant_classroom_account.
--
-- With this in place, facility_invites and facility_members need no policy
-- permitting a stranger to read or write them.

create or replace function public.title22_redeem_invite(p_token text)
returns table(ok boolean, reason text, facility_id uuid, member_role text, invited_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.facility_invites;
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), ''));
begin
  if v_uid is null then
    return query select false, 'not_signed_in', null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_invite
    from public.facility_invites
   where token = p_token
     and status = 'pending'
   limit 1;

  if v_invite.id is null then
    return query select false, 'invite_not_found', null::uuid, null::text, null::text;
    return;
  end if;

  -- An invitation is addressed to one person. Enforced here rather than only in
  -- the browser, where it could simply be skipped.
  if coalesce(v_invite.email, '') <> ''
     and v_email <> ''
     and lower(v_invite.email) <> v_email then
    return query select false, 'wrong_email', null::uuid, null::text, v_invite.email;
    return;
  end if;

  -- Accepting twice would leave two membership rows for one person, and the
  -- role lookup the app does is single-row.
  if not exists (
    select 1 from public.facility_members m
     where m.facility_id = v_invite.facility_id
       and m.user_id = v_uid
  ) then
    insert into public.facility_members (facility_id, user_id, role)
    values (v_invite.facility_id, v_uid, v_invite.role);
  end if;

  update public.facility_invites
     set status = 'accepted',
         accepted_at = now()
   where id = v_invite.id;

  return query select true, 'joined', v_invite.facility_id, v_invite.role, v_invite.email;
end $$;

grant execute on function public.title22_redeem_invite(text) to authenticated;

-- After running this, an invitation works regardless of how tight the policies
-- on facility_invites and facility_members are. Check what they are with
-- migrations/2026-08-19_rbac_check.sql — Part 3 lists both tables.
