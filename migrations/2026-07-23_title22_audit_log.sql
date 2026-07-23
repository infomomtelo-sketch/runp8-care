-- Title22 audit log (Section 7): immutable record of every write to
-- residents, medications, mar_entries, staff, and incidents.
-- Additive and idempotent. RLS + GRANTs included in this migration.
--
-- Immutability model: clients get SELECT only (facility owner). Rows are
-- inserted exclusively by a SECURITY DEFINER trigger function; INSERT/UPDATE/
-- DELETE are revoked from client roles, and no RLS policy grants them.

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  facility_id uuid,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor       uuid,
  record      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_facility_created_idx
  on public.audit_log (facility_id, created_at desc);

alter table public.audit_log enable row level security;

-- Administrator-only view: only the facility owner can read its audit trail.
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (exists (
    select 1 from public.facilities f
    where f.id = audit_log.facility_id and f.user_id = auth.uid()
  ));

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.title22_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
begin
  if tg_op = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  insert into public.audit_log (facility_id, table_name, row_id, action, actor, record)
  values ((rec->>'facility_id')::uuid, tg_table_name, (rec->>'id')::uuid, tg_op, auth.uid(), rec);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['residents','medications','mar_entries','staff','incidents'] loop
    execute format('drop trigger if exists title22_audit_trg on public.%I', t);
    execute format('create trigger title22_audit_trg after insert or update or delete on public.%I for each row execute function public.title22_audit()', t);
  end loop;
end $$;
