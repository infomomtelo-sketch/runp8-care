-- Every new sign-up fails with 500, email and Google alike (2026-09-25).
--
-- The cause is not Title22's code. This Supabase project is shared, and
-- another app on it installed a trigger on auth.users:
--
--   on_auth_user_created -> public.handle_new_user()
--     insert into credit_balances (user_id, balance) values (new.id, 0);
--
-- The table name is unqualified and the function sets no search_path, so it
-- resolves against the CALLER's search_path. The caller is Supabase Auth
-- (GoTrue), connected as supabase_auth_admin with search_path = auth, so the
-- name means auth.credit_balances, which does not exist:
--
--   ERROR: relation "credit_balances" does not exist (SQLSTATE 42P01)
--
-- GoTrue turns that into 500 "Database error saving new user", supabase-js
-- turns a 500 into the message "{}", and that is what the sign-up box showed.
-- Run the same insert from the SQL editor (search_path = public) and it
-- succeeds, which is why the trigger looks fine when tested by hand.
-- Reproduced on Postgres 16 with a role whose search_path is auth.
--
-- The fix: pin the function's search_path and name the schema. The
-- behaviour is otherwise unchanged, one row of balance 0 per new user, so the
-- app that owns credit_balances gets exactly what it asked for, and gets it
-- for the first time from a real sign-up. CREATE OR REPLACE keeps the owner,
-- the grants and the trigger itself.
--
-- Run in the Supabase SQL editor. Step 1 is read-only.

-- ── Step 1: preview (read-only) ─────────────────────────────────────────────
-- Expect: credit_balances_table not null (it may print as just credit_balances),
--         auth_role_search_path contains search_path=auth,
--         fn_config is null (no search_path pinned: the bug).
select to_regclass('public.credit_balances')                           as credit_balances_table,
       (select rolconfig from pg_roles where rolname = 'supabase_auth_admin') as auth_role_search_path,
       (select proconfig from pg_proc
         where proname = 'handle_new_user'
           and pronamespace = 'public'::regnamespace)                  as fn_config;

-- ── Step 2: the fix ─────────────────────────────────────────────────────────
-- Guarded: if public.credit_balances is missing, this refuses rather than
-- installing a function that would still fail every sign-up.
do $guard$
begin
  if to_regclass('public.credit_balances') is null then
    raise exception 'public.credit_balances does not exist; this fix would not help. Stop and look at the auth logs.';
  end if;
end
$guard$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.credit_balances (user_id, balance) values (new.id, 0);
  return new;
end;
$function$;

-- ── Step 3: verify (read-only) ──────────────────────────────────────────────
-- Expect fn_config = {"search_path=\"\""}, and the trigger still enabled ('O').
select p.proconfig as fn_config, t.tgname, t.tgenabled
from pg_proc p
join pg_trigger t on t.tgfoid = p.oid
where p.proname = 'handle_new_user'
  and p.pronamespace = 'public'::regnamespace
  and t.tgrelid = 'auth.users'::regclass;
