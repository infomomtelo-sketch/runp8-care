-- Reset the test facilities. DRY RUN FIRST — this ends in ROLLBACK.
--
-- Read the three reports it prints, then change the last line to COMMIT and
-- run it again. Nothing is written until you do.
--
-- WHAT IT KEEPS, and why
--
--   jas@thehomewellgroup.com   a real prospect: signed up 18 Aug, came back
--                              13 hours later, has a facility. Not yours.
--   the four zero-facility strangers  nothing to delete anyway, excluded so
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
-- Charise's two facilities ARE in the delete set, since she is your partner
-- and they are test data — but report 2 shows what is in them before you
-- commit. If either holds real work, add her email to the exclusion list.

begin;

-- The facilities to remove -----------------------------------------------

create temp table t22_doomed on commit drop as
select f.id, f.name, f.created_at, u.email as owner
  from public.facilities f
  join auth.users u on u.id = f.user_id
 where u.email not in (
        'jas@thehomewellgroup.com',
        'danalaanderson@gmail.com',
        'rsamra2006@gmail.com',
        'jssocialspark@gmail.com',
        'tiffanih25@gmail.com'
      )
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
 where u.email in ('jas@thehomewellgroup.com','danalaanderson@gmail.com',
                   'rsamra2006@gmail.com','jssocialspark@gmail.com',
                   'tiffanih25@gmail.com')
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
