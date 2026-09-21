-- Exercises migrations/2026-09-21_title22_repair_trainer_trials.sql against a
-- real Postgres, with rows covering every case the file claims to handle.
\set ON_ERROR_STOP on
\pset pager off

drop schema if exists public cascade;
create schema public;

create table public.title22_trainers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  trial_days integer not null default 90,
  active boolean not null default true
);

create table public.profiles (
  id text primary key,
  referred_by text,
  title22_plan text,
  title22_trial_ends_at timestamptz,
  created_at timestamptz
);

insert into public.title22_trainers (code, name, trial_days, active) values
  ('coastal-rcfe',  'Coastal RCFE Training', 90,  true),
  ('valley-ce',     'Valley CE',             60,  true),
  ('retired-coach', 'Retired Coach',         90,  false);

-- created_at, days actually granted, plan, code
insert into public.profiles (id, referred_by, title22_plan, created_at, title22_trial_ends_at) values
  -- 1. the reported case: 14 days where 90 was owed, still running
  ('a-shortchanged',      'coastal-rcfe',  'trial', now() - interval '3 days',  now() + interval '11 days'),
  -- 2. same, but the wrong trial already expired -- locked out today
  ('b-expired',           'coastal-rcfe',  'trial', now() - interval '20 days', now() - interval '6 days'),
  -- 3. a 60-day code, also stamped 14
  ('c-valley',            'valley-ce',     'trial', now() - interval '5 days',  now() + interval '9 days'),
  -- 4. code written in caps with spaces, as a URL might carry it
  ('d-messy-code',        '  Coastal-RCFE ','trial', now() - interval '2 days', now() + interval '12 days'),
  -- 5. already correct -- must not move
  ('e-already-right',     'coastal-rcfe',  'trial', now() - interval '10 days', now() + interval '80 days'),
  -- 6. PAID, and short -- must not be touched
  ('f-paid',              'coastal-rcfe',  'lite',  now() - interval '3 days',  now() + interval '11 days'),
  -- 7. classroom -- must not be touched
  ('g-edu',               'coastal-rcfe',  'edu',   now() - interval '3 days',  now() + interval '11 days'),
  -- 8. inactive trainer -- keeps what it has
  ('h-inactive-trainer',  'retired-coach', 'trial', now() - interval '3 days',  now() + interval '11 days'),
  -- 9. no referral at all -- ordinary signup
  ('i-no-referral',       null,            'trial', now() - interval '3 days',  now() + interval '11 days'),
  -- 10. referral that matches no trainer
  ('j-unknown-code',      'not-a-code',    'trial', now() - interval '3 days',  now() + interval '11 days'),
  -- 11. trial with no end date recorded -- out of scope, left alone
  ('k-null-end',          'coastal-rcfe',  'trial', now() - interval '3 days',  null),
  -- 12. null created_at -- dates from now, still extended
  ('l-null-created',      'coastal-rcfe',  'trial', null,                       now() + interval '11 days');

create temp table before_state as select id, title22_trial_ends_at from public.profiles;

\echo '=== STEP 1: dry run says these rows are short ==='
select p.id, p.referred_by as code, t.trial_days as owed,
       round(extract(epoch from (p.title22_trial_ends_at - p.created_at))/86400)::int as granted
  from public.profiles p
  join public.title22_trainers t on t.code = lower(trim(p.referred_by)) and t.active
 where p.referred_by is not null
   and p.title22_plan = 'trial'
   and p.title22_trial_ends_at is not null
   and p.created_at is not null
   and p.title22_trial_ends_at < p.created_at + make_interval(days => t.trial_days)
 order by p.id;

\echo ''
\echo '=== STEP 2: the repair ==='
update public.profiles p
   set title22_trial_ends_at = greatest(
         p.title22_trial_ends_at,
         p.created_at + make_interval(days => t.trial_days))
  from public.title22_trainers t
 where t.code = lower(trim(p.referred_by))
   and t.active
   and p.referred_by is not null
   and p.title22_plan = 'trial'
   and p.title22_trial_ends_at is not null
   and p.created_at is not null
   and p.title22_trial_ends_at < p.created_at + make_interval(days => t.trial_days);

\echo ''
\echo '=== what changed, and what did not ==='
select p.id,
       round(extract(epoch from (b.title22_trial_ends_at - p.created_at))/86400)::int as was,
       round(extract(epoch from (p.title22_trial_ends_at - p.created_at))/86400)::int as now_has,
       case when p.title22_trial_ends_at is distinct from b.title22_trial_ends_at
            then 'CHANGED' else 'untouched' end as result
  from public.profiles p join before_state b using (id)
 order by p.id;

\echo ''
\echo '=== assertions ==='
do $$
declare n int;
begin
  -- the four that should have moved, to exactly the right length
  select count(*) into n from public.profiles
   where id in ('a-shortchanged','b-expired','d-messy-code')
     and abs(extract(epoch from (title22_trial_ends_at - created_at))/86400 - 90) < 0.01;
  assert n = 3, '90-day students not all at 90: ' || n;

  select count(*) into n from public.profiles where id = 'c-valley'
     and abs(extract(epoch from (title22_trial_ends_at - created_at))/86400 - 60) < 0.01;
  assert n = 1, 'the 60-day code did not give 60 days';

  -- nothing that should have been left alone moved
  select count(*) into n from public.profiles p join before_state b using (id)
   where p.id in ('e-already-right','f-paid','g-edu','h-inactive-trainer',
                  'i-no-referral','j-unknown-code','k-null-end','l-null-created')
     and p.title22_trial_ends_at is distinct from b.title22_trial_ends_at;
  assert n = 0, 'rows that must not move, moved: ' || n;

  -- no trial anywhere got shorter
  select count(*) into n from public.profiles p join before_state b using (id)
   where p.title22_trial_ends_at < b.title22_trial_ends_at;
  assert n = 0, 'a trial was SHORTENED: ' || n;

  -- the expired one is live again
  select count(*) into n from public.profiles
   where id = 'b-expired' and title22_trial_ends_at > now();
  assert n = 1, 'the expired student is still locked out';

  raise notice 'all assertions passed';
end $$;

\echo ''
\echo '=== idempotence: run it a second time ==='
create temp table after_first as select id, title22_trial_ends_at from public.profiles;

update public.profiles p
   set title22_trial_ends_at = greatest(
         p.title22_trial_ends_at,
         p.created_at + make_interval(days => t.trial_days))
  from public.title22_trainers t
 where t.code = lower(trim(p.referred_by))
   and t.active
   and p.referred_by is not null
   and p.title22_plan = 'trial'
   and p.title22_trial_ends_at is not null
   and p.created_at is not null
   and p.title22_trial_ends_at < p.created_at + make_interval(days => t.trial_days);

do $$
declare n int;
begin
  select count(*) into n from public.profiles p join after_first a using (id)
   where p.title22_trial_ends_at is distinct from a.title22_trial_ends_at;
  assert n = 0, 'second run changed ' || n || ' rows -- not idempotent';
  raise notice 'second run changed nothing';
end $$;
