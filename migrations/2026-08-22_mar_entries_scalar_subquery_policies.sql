-- Fix: reading OR logging a MAR dose fails outright for anyone with two
-- facilities.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Safe to re-run.
--
-- Both policies on mar_entries were written the same way. mar_entries_read as
--
--   facility_id = ( select f.id from facilities f where f.user_id = auth.uid()
--                   union
--                   select fm.facility_id from facility_members fm
--                    where fm.user_id = auth.uid() )
--
-- `=` against a subquery is a SCALAR comparison: Postgres allows it at most one
-- row and raises 21000, "more than one row returned by a subquery used as an
-- expression", the instant there are two. Not zero rows — a hard error that
-- aborts the whole statement.
--
-- So the policy works for a solo operator with a single facility and starts
-- failing the moment they own a second one, or are added to another as a
-- member. Creating the sample facility is enough to trigger it. The union
-- de-duplicates, so owning AND being a member of the same facility is fine;
-- it takes two distinct facilities.
--
-- mar_entries_staff_only carries the identical comparison in its with_check,
-- as the second half of
--
--   staff_id = auth.uid() and facility_id = ( ...same subquery... )
--
-- so the same account cannot log a dose either. INSERT policies keep their
-- condition in with_check rather than qual, which is why a scan of qual alone
-- does not find this one.
--
-- What it looked like from the app: every read of mar_entries 500s, and so
-- does every insert. On the MAR screen loadMAR() falls back to the un-embedded
-- read, which fails the same way, and the list renders one error line. Logging
-- a dose is refused. On the dashboard
-- buildFacilityContext() records the MAR as unreadable and Tello declines to
-- write a briefing at all — correctly, since a briefing missing the MAR reads
-- as an all-clear.
--
-- The fix is `in` instead of `=`. The membership test itself was already right
-- and is left exactly as it was: owner OR member, because a facility's creator
-- sits in facilities.user_id and is not necessarily in facility_members, and a
-- policy written against facility_members alone would lock out the solo
-- operator. Both halves mirror how loadApp() builds the facility list.
--
-- The staff_id = auth.uid() half of the insert check is left alone. It is what
-- makes the policy staff-only — a dose is recorded against the account that
-- gave it — and nothing here should loosen who may sign for a medication.
--
-- alter policy replaces only the expression. Each policy keeps its name, its
-- command and its `authenticated` role, so nothing else is touched and no
-- window opens where the table is unprotected.

alter policy mar_entries_read on public.mar_entries
  using (
    facility_id in (
      select f.id from public.facilities f where f.user_id = auth.uid()
      union
      select fm.facility_id from public.facility_members fm where fm.user_id = auth.uid()
    )
  );

alter policy mar_entries_staff_only on public.mar_entries
  with check (
    staff_id = auth.uid()
    and facility_id in (
      select f.id from public.facilities f where f.user_id = auth.uid()
      union
      select fm.facility_id from public.facility_members fm where fm.user_id = auth.uid()
    )
  );

-- Verify. Expect `in (` and no `= (` in either expression below.
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'mar_entries'
   and policyname in ('mar_entries_read','mar_entries_staff_only');
