-- Accept the invitation addressed to me, without needing the link.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and safe to
-- re-run. Does not touch title22_redeem_invite, which keeps working exactly
-- as it does today.
--
-- Why this exists: redemption hung on a token carried in the URL, kept in
-- localStorage so it could survive a redirect. That is one browser profile's
-- storage. A private window does not share it with the normal browser, and a
-- confirmation email opens in whichever browser the mail app hands it to — so
-- the token ends up in one window and the signed-in session in another, and
-- the invited caregiver lands on "create your facility" instead of inside the
-- facility they were invited to.
--
-- An invitation is addressed to an email. Someone signed in as that email is
-- the person it was written for, link or no link. So the token stops being
-- load-bearing and becomes a convenience.
--
-- What keeps that honest is the confirmation gate below. If accounts could be
-- created with addresses nobody controls, "signed in as that email" would
-- prove nothing — a stranger who guessed an invited address could walk into a
-- facility's resident records. So an unconfirmed account is refused here, and
-- told why, rather than quietly joined.

create or replace function public.title22_accept_my_invite()
returns table(ok boolean, reason text, facility_id uuid, facility_name text, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_invite public.facility_invites;
  v_name text;
begin
  if v_uid is null then
    return query select false, 'not_signed_in', null::uuid, null::text, null::text;
    return;
  end if;

  -- Read the address and its confirmation from auth.users rather than from the
  -- JWT: the token is minted at sign-in and a claim in it is a snapshot, while
  -- this is the current truth.
  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;

  if coalesce(v_email,'') = '' then
    return query select false, 'no_email', null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_invite
    from public.facility_invites i
   where lower(i.email) = v_email
     and i.status = 'pending'
   order by i.created_at desc
   limit 1;

  if v_invite.id is null then
    return query select false, 'no_invite', null::uuid, null::text, null::text;
    return;
  end if;

  select f.name into v_name from public.facilities f where f.id = v_invite.facility_id;

  -- Named so the app can say "confirm your email to join Sunrise Manor"
  -- instead of a blank onboarding page. Telling someone the facility an
  -- invitation to their own address points at gives away nothing they were
  -- not already sent.
  if v_confirmed is null then
    return query select false, 'email_unconfirmed', v_invite.facility_id, v_name, v_invite.role;
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
     set status = 'accepted', accepted_at = now()
   where id = v_invite.id;

  return query select true, 'joined', v_invite.facility_id, v_name, v_invite.role;
end $$;

grant execute on function public.title22_accept_my_invite() to authenticated;

-- If invitations still fail after this, the thing to check is whether email
-- confirmation is switched on for the project. With it off, every invited
-- account comes back 'email_unconfirmed' and nobody can be let in on the
-- strength of an address alone.
