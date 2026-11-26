-- Title22 package agreements: the signed agreement a home files in
-- Title22 BEFORE a Title22 package ($29 / $79 / $139) selected in the
-- checkout can be checked out.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and
-- idempotent. Safe to re-run. Nothing is dropped or rewritten.
--
-- The rule (Eli, Nov 25, 2026): "all package should have agreement when
-- selected." Both packages carry an agreement door — the Resident
-- Binder has its own (binder_agreements, live); this is the Title22
-- package's. Add-ons alone (training, Tello Staff, without a package
-- or the binder) carry no agreement. This table mirrors
-- binder_agreements' shape exactly.
--
-- Boundary (Eli, Nov 25, 2026): this layer is ADDITIONAL ONLY. The
-- package payment links and the checkout flow live today keep working
-- exactly as they do now; this table serves only the new cart's
-- package selection.
--
-- Depends on migrations/2026-07-23_title22_audit_log.sql having been
-- run: the shared title22_audit() trigger writes the signing into
-- audit_log as a Title22-side event, same as the binder agreement.
--
-- ORDER OF OPERATIONS: run this BEFORE the cart's package agreement
-- door is used. The app fails safe while the table is absent — the
-- package state reads as not signed and the cart's package selection
-- waits, exactly as the binder door did — so running it late breaks
-- nothing.

create table if not exists public.title22_package_agreements (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references public.facilities(id) on delete cascade,
  signed_by         uuid,                          -- auth user who signed (the audit trigger also records the actor)
  signer_name       text not null,                 -- printed name, as typed at signing
  signer_title      text,                          -- e.g. Licensee, Administrator
  facility_name     text not null,                 -- the home's name as confirmed at signing
  license_number    text,                          -- from the facility's Title22 record, confirmed at signing
  account_email     text,                          -- the account email shown on the door at signing
  agreement_version text not null,                 -- the version of the text that was signed (app ships 'v1.0')
  signature_image   text not null,                 -- the drawn signature, PNG data URL
  signed_at         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists title22_package_agreements_facility_signed_idx
  on public.title22_package_agreements (facility_id, signed_at desc);

alter table public.title22_package_agreements enable row level security;

-- Read: the facility owner, or a member of that facility's team (same
-- shape as binder_agreements_read).
drop policy if exists title22_package_agreements_read on public.title22_package_agreements;
create policy title22_package_agreements_read on public.title22_package_agreements
  for select to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = title22_package_agreements.facility_id and f.user_id = auth.uid()
    )
    or exists (
      select 1 from public.facility_members m
      where m.facility_id = title22_package_agreements.facility_id and m.user_id = auth.uid()
    )
  );

-- Sign: the owner, or a team member whose role is administrator.
drop policy if exists title22_package_agreements_sign on public.title22_package_agreements;
create policy title22_package_agreements_sign on public.title22_package_agreements
  for insert to authenticated
  with check (
    exists (
      select 1 from public.facilities f
      where f.id = title22_package_agreements.facility_id and f.user_id = auth.uid()
    )
    or exists (
      select 1 from public.facility_members m
      where m.facility_id = title22_package_agreements.facility_id
        and m.user_id = auth.uid()
        and m.role = 'administrator'
    )
  );

-- No UPDATE or DELETE policies, deliberately: a filed signature is
-- history. Cancelling a package does not un-sign it, and a re-sign (a
-- new agreement version) is a new row, never an edit of the old one.
revoke all on public.title22_package_agreements from anon;
grant select, insert on public.title22_package_agreements to authenticated;

-- The audit entry: one audit_log row per insert, carrying the full
-- signed record — the Title22-side event the audit view shows.
drop trigger if exists title22_audit_trg on public.title22_package_agreements;
create trigger title22_audit_trg
  after insert or update or delete on public.title22_package_agreements
  for each row execute function public.title22_audit();
