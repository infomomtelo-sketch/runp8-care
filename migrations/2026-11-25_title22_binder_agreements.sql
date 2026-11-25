-- Title22 Resident Binder agreements: the signed BAA-style agreement a home
-- files in Title22 BEFORE the Resident Binder add-on can be activated.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and idempotent.
-- Safe to re-run. Nothing is dropped or rewritten.
--
-- The rule (Eli, Nov 20 + Nov 24, 2026): no signed agreement, no add-on.
-- One signature per facility covers the whole binder package (MAR + ADL +
-- the resident binders). The signed copy is the home's business paper — it
-- belongs on the Title22 side of the line, next to the license and the
-- certificates, and it is NOT resident data: nothing about any resident is
-- in this table, ever.
--
-- Depends on migrations/2026-07-23_title22_audit_log.sql having been run:
-- the shared title22_audit() trigger below is what writes the signing into
-- audit_log as a Title22-side event ("Agreement signed for the Resident
-- Binder add-on" is how the app's audit view labels the row).
--
-- ORDER OF OPERATIONS: run this BEFORE the agreement-door build of the app
-- is used. The app fails safe while the table is absent — the Billing
-- add-on rows keep reading "Coming soon", exactly as they did before the
-- door existed — so running it late breaks nothing, the door simply stays
-- shut until the table exists.
--
-- Also here: profiles.title22_binder_addon, the flag the Stripe webhook
-- stamps when a binder add-on subscription activates WITH a filed
-- agreement on the account (the mirror of title22_training_included).
-- The column must exist before the new stripe-webhook build is deployed,
-- or its PATCH of profiles would fail — same rule the cap-fix set in 2026.

-- 1. The agreements table ---------------------------------------------------

create table if not exists public.binder_agreements (
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

create index if not exists binder_agreements_facility_signed_idx
  on public.binder_agreements (facility_id, signed_at desc);

alter table public.binder_agreements enable row level security;

-- Read: the facility owner, or a member of that facility's team. The team
-- can see THAT the home is signed (the app's Billing rows read this); the
-- policies follow the audit_log policy's shape.
drop policy if exists binder_agreements_read on public.binder_agreements;
create policy binder_agreements_read on public.binder_agreements
  for select to authenticated
  using (
    exists (
      select 1 from public.facilities f
      where f.id = binder_agreements.facility_id and f.user_id = auth.uid()
    )
    or exists (
      select 1 from public.facility_members m
      where m.facility_id = binder_agreements.facility_id and m.user_id = auth.uid()
    )
  );

-- Sign: the owner, or a team member whose role is administrator — the
-- door is an administrator/owner act (FLOW-SPEC §2). Nobody else can file
-- a signature for a home.
drop policy if exists binder_agreements_sign on public.binder_agreements;
create policy binder_agreements_sign on public.binder_agreements
  for insert to authenticated
  with check (
    exists (
      select 1 from public.facilities f
      where f.id = binder_agreements.facility_id and f.user_id = auth.uid()
    )
    or exists (
      select 1 from public.facility_members m
      where m.facility_id = binder_agreements.facility_id
        and m.user_id = auth.uid()
        and m.role = 'administrator'
    )
  );

-- No UPDATE or DELETE policies, deliberately: a filed signature is
-- history. Ending the add-on does not un-sign it, and a re-sign (a new
-- agreement version) is a new row, never an edit of the old one.
revoke all on public.binder_agreements from anon;
grant select, insert on public.binder_agreements to authenticated;

-- 2. The audit entry --------------------------------------------------------
--
-- The shared trigger writes one audit_log row per insert, carrying the
-- full signed record (signer name included) — the Title22-side event the
-- binder's LIC book audit view shows. It needs facility_id and id as
-- uuid columns, which this table has.
drop trigger if exists title22_audit_trg on public.binder_agreements;
create trigger title22_audit_trg
  after insert or update or delete on public.binder_agreements
  for each row execute function public.title22_audit();

-- 3. The webhook's activation flag ------------------------------------------

alter table public.profiles
  add column if not exists title22_binder_addon boolean not null default false;

comment on column public.profiles.title22_binder_addon is
  'Stamped by stripe-webhook when a Resident Binder add-on subscription activates and a filed binder_agreements row exists for the account. Never stamped without the agreement (no signature, no add-on).';
