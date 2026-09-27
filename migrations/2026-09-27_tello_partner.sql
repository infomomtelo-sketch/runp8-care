-- Tello as the owner's business partner (founder mode).
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Safe to re-run.
--
-- What this creates, and who can touch each piece:
--
--   tello_founders          who gets partner mode. Server only: RLS on, no
--                           policies, no grants. The title22-ai Worker reads
--                           it with the service key. Nothing in a browser can
--                           read it, so nobody can find out who is on it, and
--                           no button, URL or request field can add to it.
--
--   tello_private           the partner-mode instructions. Server only, same
--                           as above. They are NOT in git: this repository is
--                           public, and those instructions are private.
--
--   tello_founder_messages  partner conversations, apart from customer chats
--                           (tello_messages). The owner reads and deletes
--                           their own rows. Only the Worker writes, so a row
--                           here exists only because the server decided that
--                           user was a founder.
--
--   tello_business_snapshot()  live numbers for partner mode. READ ONLY and
--                           COUNTS ONLY: no names, no emails, no facility
--                           names, no resident table touched. Executable by
--                           the service role alone.
--
-- After running this, one more paste makes it work (it is NOT in this file on
-- purpose): the founder row and the instructions. See workers/README.md,
-- "title22-ai: Tello partner mode".

-- ------------------------------------------------------------ founders --
create table if not exists public.tello_founders (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.tello_founders enable row level security;
revoke all on public.tello_founders from anon, authenticated;

-- ------------------------------------------------------ instructions --
create table if not exists public.tello_private (
  key        text primary key,
  body       text not null,
  updated_at timestamptz not null default now()
);
alter table public.tello_private enable row level security;
revoke all on public.tello_private from anon, authenticated;

-- ---------------------------------------------------- partner chats --
create table if not exists public.tello_founder_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  -- chat: the conversation. today / weekly: the briefs Tello wrote, one per
  -- day and one per week, kept so she is not paid to write the same one twice.
  -- marker: "new conversation" — the earlier messages still happened.
  kind       text not null default 'chat' check (kind in ('chat','today','weekly','marker')),
  content    text not null,
  -- For a brief: the counts it was written from, so tomorrow's can say what
  -- changed. Counts only, the same shape tello_business_snapshot() returns.
  data       jsonb,
  created_at timestamptz not null default now()
);
alter table public.tello_founder_messages add column if not exists data jsonb;
create index if not exists tello_founder_messages_user_time
  on public.tello_founder_messages (user_id, created_at);
alter table public.tello_founder_messages enable row level security;

revoke all on public.tello_founder_messages from anon, authenticated;
grant select, delete on public.tello_founder_messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
     and tablename='tello_founder_messages' and policyname='tello_founder_messages_own_select') then
    create policy tello_founder_messages_own_select on public.tello_founder_messages
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
     and tablename='tello_founder_messages' and policyname='tello_founder_messages_own_delete') then
    create policy tello_founder_messages_own_delete on public.tello_founder_messages
      for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------- snapshot --
-- Every number here is a COUNT. "Title22 users" means profiles with a
-- title22_plan, because profiles is shared with other apps on this project.
-- MRR is from list prices on active subscriptions in our own table, not from
-- Stripe: coupons, refunds and anything Stripe knows that we do not are not in
-- it, and the result says so. Agency has no list price, so it is counted and
-- left out of MRR rather than guessed.
create or replace function public.tello_business_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  with
  t22 as (
    select p.id, p.created_at, p.title22_plan, p.title22_trial_ends_at, p.referred_by
      from public.profiles p
     where p.title22_plan is not null
  ),
  subs as (
    select distinct on (s.user_id, s.stripe_subscription_id)
           s.user_id, s.status,
           case
             when lower(replace(replace(trim(s.plan),'_','-'),' ','-')) in ('multi','multi-home','multihome') then 'multi'
             else lower(trim(s.plan))
           end as plan
      from public.subscriptions s
  ),
  paying as (
    select plan, count(distinct user_id) as accounts
      from subs
     where status = 'active'
       and plan in ('lite','multi','starter','pro','specialist','agency')
     group by plan
  ),
  acct as (
    select t.id,
      (select count(*) from public.facilities f
        where f.user_id = t.id and not coalesce(f.is_demo,false)
          and f.name is distinct from 'Sunrise Demo Home (Sample)')                   as homes,
      (select count(*) from public.staff s join public.facilities f on f.id = s.facility_id
        where f.user_id = t.id)                                                        as staff_rows,
      (select count(*) from public.compliance_tasks c join public.facilities f on f.id = c.facility_id
        where f.user_id = t.id and c.completed)                                        as tasks_done
    from t22 t
  )
  select jsonb_build_object(
    'as_of', now(),
    'signups', jsonb_build_object(
      'last_7_days',  (select count(*) from t22 where created_at >= now() - interval '7 days'),
      'last_30_days', (select count(*) from t22 where created_at >= now() - interval '30 days'),
      'all_time',     (select count(*) from t22)),
    'trials', jsonb_build_object(
      'active',             (select count(*) from t22 where title22_plan = 'trial' and title22_trial_ends_at > now()),
      'ending_next_7_days', (select count(*) from t22 where title22_plan = 'trial'
                               and title22_trial_ends_at > now() and title22_trial_ends_at <= now() + interval '7 days'),
      'expired_read_only',  (select count(*) from t22 where title22_plan = 'trial' and title22_trial_ends_at <= now())),
    'classroom_accounts', (select count(*) from t22 where title22_plan = 'edu'),
    'paying_accounts_by_plan', coalesce((select jsonb_object_agg(plan, accounts) from paying), '{}'::jsonb),
    'paying_accounts_total',   coalesce((select sum(accounts) from paying), 0),
    'mrr_usd_list_price', coalesce((select sum(accounts * case plan
                                   when 'lite' then 29 when 'multi' then 79 when 'starter' then 49
                                   when 'pro' then 79 when 'specialist' then 149 end)
                                   from paying where plan <> 'agency'), 0),
    'mrr_note', 'List prices x active subscriptions in our own table, not Stripe. Agency has no list price and is not included. Check Stripe before quoting it.',
    -- An account that failed once and has since paid is not failing now.
    'failed_payments', (select count(distinct f.user_id) from subs f
                         where f.status in ('past_due','unpaid','incomplete')
                           and not exists (select 1 from subs a where a.user_id = f.user_id and a.status = 'active')),
    'funnel', jsonb_build_object(
      'no_home_yet',          (select count(*) from acct where homes = 0),
      'home_but_no_staff',    (select count(*) from acct where homes > 0 and staff_rows = 0),
      'staff_but_no_checklist',(select count(*) from acct where staff_rows > 0 and tasks_done = 0),
      'started_checklist',    (select count(*) from acct where tasks_done between 1 and 4),
      'using_it',             (select count(*) from acct where tasks_done >= 5)),
    'active_users_last_7_days', (select count(distinct e.user_id) from public.events e
                                  join t22 on t22.id = e.user_id
                                 where e.created_at >= now() - interval '7 days'),
    'partner_codes', coalesce((
       select jsonb_agg(x order by (x->>'signups')::int desc)
         from (select jsonb_build_object(
                  'code', referred_by,
                  'signups', count(*),
                  'paid', count(*) filter (where title22_plan not in ('trial','free','edu'))) as x
                 from t22
                where referred_by is not null
                group by referred_by
                order by count(*) desc
                limit 25) q), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.tello_business_snapshot() from public, anon, authenticated;
grant execute on function public.tello_business_snapshot() to service_role;

-- ------------------------------------------------------------- check --
-- Expect: three tables, rls on for all three, and the function executable by
-- service_role only.
select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('tello_founders','tello_private','tello_founder_messages')
 order by 1;
select has_function_privilege('authenticated', 'public.tello_business_snapshot()', 'execute') as authenticated_can_run,
       has_function_privilege('service_role',  'public.tello_business_snapshot()', 'execute') as service_role_can_run;
