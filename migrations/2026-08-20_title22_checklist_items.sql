-- The compliance checklist has no content.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive, safe to re-run.
--
-- public.checklist_items is the master list every facility's checklist is
-- built from: seedComplianceTasks() reads it at onboarding and writes one
-- compliance_tasks row per item. The table is empty, so that loop produces
-- nothing, every facility's Compliance page is blank, and the readiness score
-- reads "0 of 0 requirements" — including in the demo sandbox, where it is the
-- first thing a prospect sees.
--
-- ON THE REGULATION REFERENCES, PLEASE READ THIS.
--
-- Only the citations already used elsewhere in this codebase are filled in
-- here — §87506, §87411, §87412, §87465 and §87211, the ones printed on the
-- DSS export. Every other row is left NULL on purpose. The app renders the
-- reference only when it exists, so a null shows nothing rather than showing
-- something wrong.
--
-- Guessing section numbers would be worse than leaving them blank: this list
-- is read by people deciding whether they are ready for an inspection, and a
-- confident wrong citation is the kind of error that survives all the way to
-- the analyst's desk. Fill the rest in from the regulations themselves.
--
-- Still unresolved and noted from earlier: §87415 vs §87465 for the centrally
-- stored medication record. The export currently says §87465.

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  frequency text,
  regulation_reference text,
  created_at timestamptz default now()
);

-- A global reference list with no facility data in it. The sandbox reads it
-- anonymously, so anon needs select or the demo scores 0 of 0 forever.
alter table public.checklist_items enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='checklist_items' and cmd='SELECT'
  ) then
    create policy checklist_items_read on public.checklist_items
      for select to anon, authenticated using (true);
  end if;
end $$;

-- Inserted by title so a second run adds nothing and edits already made by
-- hand are left alone.
insert into public.checklist_items (title, category, frequency, regulation_reference)
select v.title, v.category, v.frequency, v.regulation_reference
from (values
  -- ---------- administrator ----------
  -- This exact title is special-cased in seedComplianceTasks(): it is marked
  -- complete and dated from the facility's administrator_cert_expiry. Do not
  -- rename it without changing index.html.
  ('RCFE Administrator Certificate Current','administrator','annual',null),
  ('Administrator continuing education hours completed','administrator','biennial',null),
  ('Facility licence posted where residents and visitors can see it','administrator','annual',null),
  ('Liability insurance current','administrator','annual',null),
  ('Emergency contact list current and posted','administrator','quarterly',null),

  -- ---------- staff ----------
  ('Criminal record clearance before contact with residents','staff','on_hire','§87411'),
  ('Health screening and TB clearance before first shift','staff','on_hire','§87411'),
  ('TB test renewed','staff','annual','§87411'),
  ('CPR certification current','staff','annual','§87411'),
  ('First aid certification current','staff','annual','§87411'),
  ('Mandated reporter training completed','staff','on_hire',null),
  ('40 hours initial training completed within the first year','staff','annual','§87411'),
  ('20 hours annual in-service training completed','staff','annual','§87411'),
  ('Personnel file complete for every employee','staff','annual','§87412'),
  ('Staff schedule shows required coverage','staff','monthly',null),

  -- ---------- residents ----------
  ('LIC 601 — Identification and Emergency Information on file','residents','on_admission','§87506'),
  ('LIC 602 — Physician''s Report on file','residents','on_admission','§87506'),
  ('Individual Service Plan completed','residents','on_admission','§87506'),
  ('Individual Service Plan reviewed and updated','residents','quarterly','§87506'),
  ('Admission agreement signed and on file','residents','on_admission',null),
  ('Resident appraisal reviewed for changed needs','residents','annual','§87506'),
  ('Resident cash resources record reconciled','residents','monthly',null),
  ('Resident rights posted where residents can read them','residents','annual',null),

  -- ---------- medication ----------
  ('Centrally stored medication record complete for every dose','medication','daily','§87465'),
  ('Medications stored locked, and only where they should be','medication','weekly','§87465'),
  ('Physician orders reconciled against the MAR','medication','monthly','§87465'),
  ('Discontinued and expired medication disposed of and recorded','medication','monthly','§87465'),

  -- ---------- facility ----------
  ('Fire drill held and logged','facility','monthly',null),
  ('Fire clearance current','facility','annual',null),
  ('Emergency and disaster plan reviewed','facility','annual',null),
  ('Water temperature checked and logged','facility','weekly',null),
  ('Week''s menu planned, posted and kept','facility','weekly',null),
  ('Smoke detectors and extinguishers checked','facility','quarterly',null),
  ('Pest control carried out','facility','quarterly',null),
  ('Unusual incidents reported to the licensing agency as required','facility','monthly','§87211')
) as v(title, category, frequency, regulation_reference)
where not exists (
  select 1 from public.checklist_items c where c.title = v.title
);

-- Existing facilities were onboarded against an empty list, so they have no
-- compliance_tasks at all and would never get any — seedComplianceTasks only
-- runs once, at onboarding. Give them the same rows a new facility gets.
--
-- Due dates mirror getDefaultDueDate() in index.html; priority mirrors its
-- highPriority list. Nothing is marked complete: whether a requirement is met
-- is for the facility to say, not for a migration to assume.
insert into public.compliance_tasks (facility_id, checklist_item_id, title, category, completed, priority, due_date)
select f.id, i.id, i.title, i.category, false,
       case when i.frequency in ('daily','on_hire','on_admission') then 'high' else 'medium' end,
       (current_date + case i.frequency
          when 'daily' then interval '1 day'
          when 'weekly' then interval '7 days'
          when 'monthly' then interval '1 month'
          when 'quarterly' then interval '3 months'
          when 'annual' then interval '1 year'
          when 'biennial' then interval '2 years'
          else interval '1 month' end)::date
from public.facilities f
cross join public.checklist_items i
where not exists (
  select 1 from public.compliance_tasks t
   where t.facility_id = f.id and t.checklist_item_id = i.id
);

-- After running this, every facility's Compliance page has content and the
-- readiness score counts against something real. Nothing is ticked, so scores
-- will start low — that is the honest starting point, not a bug.
