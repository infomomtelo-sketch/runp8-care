-- Tello sales flow (2026-11-12, Flow A): what a visitor told Tello while
-- shopping for Title22, so the owner sees the fit without re-asking.
--
-- What it adds, all additive and safe to run twice:
--   1. assistant_leads.facility_type  RCFE / ARF / both (nullable).
--   2. assistant_leads.home_count     how many homes (nullable, 1-100).
--   3. title22_assistant_leads()      the owner's list in Tello's Cabinet
--      now returns both, so they show next to the name and contact.
--
-- No new table, no new email plumbing: the lead email reads the existing
-- partner_tello_config row (notify_to / email_from), and the lead is still
-- saved even when that row or RESEND_API_KEY is missing. Run this in
-- Supabase BEFORE deploying the Worker (see the note below).
--
-- NOTE: the Worker's POST to assistant_leads now includes facility_type and
-- home_count. If this migration has not run, PostgREST answers 400
-- ("column does not exist") and the lead is refused with save_failed. Run
-- this file first, then deploy.

alter table public.assistant_leads
  add column if not exists facility_type text
    check (facility_type is null or facility_type in ('RCFE', 'ARF', 'both'));
alter table public.assistant_leads
  add column if not exists home_count integer
    check (home_count is null or (home_count >= 1 and home_count <= 100));

create or replace function public.title22_assistant_leads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and title22_is_partner_admin) then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(l) order by l.status = 'done', l.created_at desc)
      from (select id, assistant, kind, name, contact, business, message, summary, language, facility_type, home_count, status, created_at
              from public.assistant_leads
             order by created_at desc limit 100) l), '[]'::jsonb);
end;
$$;

-- Check it worked (read-only):
--   select column_name from information_schema.columns
--    where table_name = 'assistant_leads'
--      and column_name in ('facility_type', 'home_count');
--   Both rows should come back.
