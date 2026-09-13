-- Reset the test facilities. DRY RUN FIRST — this ends in ROLLBACK.
--
-- Read the three reports it prints, then change the last line to COMMIT and
-- run it again. Nothing is written until you do.
--
-- WHAT IT KEEPS, and why
--
--   the accounts you list in t22_keep_owners  real prospects and partners.
--                              You build that list yourself in STEP 0 below —
--                              it is not committed to this file. One of them
--                              is a prospect who signed up 18 Aug, came back
--                              13 hours later, and has a facility.
--   the zero-facility strangers  nothing to delete anyway, excluded so
--                              the question does not arise.
--   the newest sample home     the one you asked to keep.
--   ANY facility holding an incident   CLAUDE.md: "incidents.resident_id =
--                              NULL (12 rows unlinked, keep for LIC 624)".
--                              Rather than move those rows to a facility they
--                              did not happen at, this refuses to delete the
--                              facility under them and lists it for you. If
--                              they turn out to be test incidents you do not
--                              need, delete those facilities in a second pass.
--
-- Your partner's two facilities ARE in the delete set, since they are test
-- data — but report 2 shows what is in them before you commit. If either
-- holds real work, add her user id to the keep list in STEP 0.

-- STEP 0 — BUILD THE KEEP LIST. Do this before anything else.
--
-- Run this on its own and read it:
--
--     select id, email, created_at from auth.users order by email;
--
-- Copy the `id` of every account whose facilities must SURVIVE into the
-- insert below. Copy them — do not type them from memory, and do not guess.
--
-- Why ids and not the email addresses that used to be written here: this file
-- lives in a public repository, and the addresses of five real people were
-- committed in it. The list does the same job either way; only one of them
-- publishes a customer's contact details. The reports further down still
-- print emails at run time, from the database, so you can still check by eye
-- that the right accounts are being spared.
--
-- This file CANNOT be run as it stands — the placeholder below is not a valid
-- uuid and will fail. That is deliberate on a script that deletes things.

begin;

create temp table t22_keep_owners(user_id uuid primary key) on commit drop;

insert into t22_keep_owners(user_id) values
  ('PASTE-A-USER-ID-HERE')
  -- ,('00000000-0000-0000-0000-000000000000')
;

-- An empty keep list means every account is in scope, which is never what
-- anyone intended. Refuse rather than find out afterwards.
do $$
begin
  if (select count(*) from t22_keep_owners) = 0 then
    raise exception 'Keep list is empty. Fill t22_keep_owners in STEP 0 before running this.';
  end if;
end $$;

-- The facilities to remove -----------------------------------------------

create temp table t22_doomed on commit drop as
select f.id, f.name, f.created_at, u.email as owner
  from public.facilities f
  join auth.users u on u.id = f.user_id
 where u.id not in (select user_id from t22_keep_owners)
   and not exists (
        select 1 from public.incidents i where i.facility_id = f.id
      )
   and f.id not in (
        select f2.id
          from public.facilities f2
         where f2.name ilike '%sample%'
         order by f2.created_at desc
         limit 1
      );

-- Report 1: what is being kept, and why ----------------------------------

select 'KEPT — not yours'      as reason, f.name, u.email as owner, f.created_at
  from public.facilities f join auth.users u on u.id = f.user_id
 where u.id in (select user_id from t22_keep_owners)
union all
select 'KEPT — holds incidents (LIC 624)', f.name, u.email, f.created_at
  from public.facilities f join auth.users u on u.id = f.user_id
 where exists (select 1 from public.incidents i where i.facility_id = f.id)
union all
select 'KEPT — the sample home', f.name, u.email, f.created_at
  from public.facilities f join auth.users u on u.id = f.user_id
 where f.id in (select f2.id from public.facilities f2
                 where f2.name ilike '%sample%'
                 order by f2.created_at desc limit 1)
 order by 1, 4;

-- Report 2: what is being destroyed, with its contents -------------------

select d.owner, d.name, d.created_at,
       (select count(*) from public.staff      s where s.facility_id = d.id) as staff,
       (select count(*) from public.documents  x where x.facility_id = d.id) as documents,
       (select count(*) from public.compliance_tasks t where t.facility_id = d.id) as tasks,
       (select count(*) from public.facility_members m where m.facility_id = d.id) as members
  from t22_doomed d
 order by d.owner, d.created_at;

-- Delete ------------------------------------------------------------------
--
-- staff_trainings hangs off staff, not off a facility, so it goes first or
-- the staff delete trips its foreign key.

do $$
begin
  if to_regclass('public.staff_trainings') is not null then
    delete from public.staff_trainings
     where staff_id in (
       select s.id from public.staff s
        where s.facility_id in (select id from t22_doomed)
     );
  end if;
end $$;

-- Everything else that carries a facility_id, found rather than listed, so a
-- table added since this was written is not silently left behind.

do $$
declare t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables b
        on b.table_schema = c.table_schema and b.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name  = 'facility_id'
       and b.table_type   = 'BASE TABLE'
       and c.table_name not in ('facilities')
     order by c.table_name
  loop
    execute format(
      'delete from public.%I where facility_id in (select id from t22_doomed)', t);
  end loop;
end $$;

delete from public.facilities where id in (select id from t22_doomed);

-- Report 3: what is left --------------------------------------------------

select u.email as owner, count(f.id) as facilities_remaining
  from auth.users u
  left join public.facilities f on f.user_id = u.id
 group by u.email
having count(f.id) > 0
 order by u.email;

-- Change this to COMMIT once reports 1 and 2 look right.
rollback;
