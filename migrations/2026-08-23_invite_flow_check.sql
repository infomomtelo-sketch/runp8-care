-- Read-only. Is the invitation flow actually able to complete?
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Changes nothing.
--
-- The app now refuses to show an invited caregiver "Tell us about your
-- facility" — they get a join panel naming the facility instead. That is the
-- right thing to show, but it is only a waiting room: joining still happens in
-- title22_accept_my_invite(), and if that function is not installed the panel
-- is where they stop. Silently, from the browser's point of view: a missing
-- function comes back as an ordinary error and there is nothing on screen
-- separating it from "no invitation for you".
--
-- So the first three rows below are the ones that matter. Anything MISSING is
-- a migration in this directory that has not been run yet.
--
--   title22_accept_my_invite    joining by email, no link needed
--   title22_redeem_invite       joining from an ?invite= link
--   title22_member_entitlement  inheriting the facility's plan once joined.
--                               Missing, someone joins and then meets a
--                               paywall for a subscription they are covered by.
--
-- The last three rows are the state of the invitations themselves.
--
-- "invited but unconfirmed" is the trap worth knowing about: accept refuses an
-- account whose email is unconfirmed, deliberately — if addresses nobody
-- controls could hold accounts, being signed in as an invited address would
-- prove nothing. But that means if email confirmation is switched OFF for the
-- project, every invited account can come back unconfirmed forever and nobody
-- can be let in. If that count is high and those people say they never got a
-- confirmation email, check Authentication - Providers - Email in the
-- dashboard before looking anywhere else.

select 1 as sort, 'title22_accept_my_invite' as item,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'title22_accept_my_invite')
            then 'OK'
            else 'MISSING - run migrations/2026-08-19_title22_accept_my_invite.sql' end as result
union all
select 2, 'title22_redeem_invite',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'title22_redeem_invite')
            then 'OK'
            else 'MISSING - run migrations/2026-08-19_title22_redeem_invite.sql' end
union all
select 3, 'title22_member_entitlement',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'title22_member_entitlement')
            then 'OK'
            else 'MISSING - run migrations/2026-08-19_title22_member_entitlement.sql' end
union all
select 4, 'pending invitations',
       (select count(*) from public.facility_invites where status = 'pending')::text
union all
select 5, 'invited but unconfirmed',
       (select count(*) from public.facility_invites i
          join auth.users u on lower(u.email) = lower(i.email)
         where i.status = 'pending' and u.email_confirmed_at is null)::text
       || ' - refused until they tap the link in their inbox'
union all
select 6, 'invited, no account yet',
       (select count(*) from public.facility_invites i
         where i.status = 'pending'
           and not exists (select 1 from auth.users u where lower(u.email) = lower(i.email)))::text
       || ' - have not signed up'
order by sort;
