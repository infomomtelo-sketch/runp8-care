-- Why the MAR cannot join its tables. READ-ONLY — this only looks.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Run the whole thing and
-- screenshot the result; it is one small table of answers.
--
-- Background: public.mar_entries is not created by anything in migrations/, so
-- its foreign keys are invisible from the repo. PostgREST builds the embedded
-- read the MAR screen depends on —
--
--   .select('*, residents(name, full_name), medications(medication_name, ...)')
--
-- — entirely from those foreign keys. No key, no relationship, and the whole
-- view fails with "Could not find a relationship ... in the schema cache".
-- The same table is the last bulk insert the sample facility performs, which
-- is why one error could be behind both symptoms.

select 'mar_entries table' as check_name,
       case when to_regclass('public.mar_entries') is null
            then 'MISSING' else 'present' end as answer

union all
select 'FK mar_entries -> residents',
       coalesce((select con.conname
                   from pg_constraint con
                   join pg_class s on s.oid = con.conrelid
                   join pg_class t on t.oid = con.confrelid
                  where con.contype = 'f'
                    and s.relnamespace = 'public'::regnamespace
                    and s.relname = 'mar_entries'
                    and t.relname = 'residents'
                  limit 1),
                'MISSING — the MAR embed needs this')

union all
select 'FK mar_entries -> medications',
       coalesce((select con.conname
                   from pg_constraint con
                   join pg_class s on s.oid = con.conrelid
                   join pg_class t on t.oid = con.confrelid
                  where con.contype = 'f'
                    and s.relnamespace = 'public'::regnamespace
                    and s.relname = 'mar_entries'
                    and t.relname = 'medications'
                  limit 1),
                'MISSING — the MAR embed needs this')

-- The app writes the signed-in account's id into staff_id, in both the sample
-- facility and ordinary logging. If this points at public.staff rather than at
-- auth.users, every one of those writes violates the key.
union all
select 'mar_entries.staff_id points at',
       coalesce((select t.relname
                   from pg_constraint con
                   join pg_class s on s.oid = con.conrelid
                   join pg_class t on t.oid = con.confrelid
                   join pg_attribute a on a.attrelid = con.conrelid
                                      and a.attnum = con.conkey[1]
                  where con.contype = 'f'
                    and s.relnamespace = 'public'::regnamespace
                    and s.relname = 'mar_entries'
                    and a.attname = 'staff_id'
                  limit 1),
                'nothing — any uuid is accepted')

union all
select 'row level security on mar_entries',
       coalesce((select case when relrowsecurity then 'on' else 'OFF — every account can read every facility'
                        end
                   from pg_class
                  where relnamespace = 'public'::regnamespace
                    and relname = 'mar_entries'
                  limit 1), 'n/a')

union all
select 'policies on mar_entries',
       (select count(*)::text
          from pg_policies
         where schemaname = 'public' and tablename = 'mar_entries')

union all
select 'residents rows visible to you',
       (select count(*)::text from public.residents)

union all
select 'mar_entries rows visible to you',
       (select count(*)::text from public.mar_entries);
