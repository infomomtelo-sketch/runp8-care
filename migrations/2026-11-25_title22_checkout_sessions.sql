-- Title22 one checkout: the checkout session record, and the Tello
-- Staff activation flag the stripe-webhook stamps.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and
-- idempotent. Safe to re-run. Nothing is dropped or rewritten.
--
-- Why (one-checkout build list step 4, Nov 25, 2026): a purchase made
-- through the new /checkout route on stripe-webhook is traceable
-- account -> session -> subscription WITHOUT email matching. The
-- route inserts one row when it creates the Stripe Checkout Session;
-- the webhook's checkout.session.completed handler walks the same row
-- forward (stripe_subscription_id, state 'completed') when the
-- payment lands. The row is a trace, not an entitlement: nothing in
-- the app or the webhook grants access from this table — entitlement
-- is still stamped from the subscription itself, exactly as before.
--
-- Also here: profiles.title22_staff_addon, the flag the webhook
-- stamps when a Tello Staff subscription activates (the mirror of
-- title22_training_included and title22_binder_addon). The column
-- must exist before the one-checkout stripe-webhook build is
-- deployed, or its staff PATCH would fail — the build isolates that
-- patch so it would fail alone and loudly, but run this first and it
-- never comes up (same rule the cap-fix set in 2026, and the binder
-- flag's migration repeated on 2026-11-25).
--
-- ORDER OF OPERATIONS: run this BEFORE deploying the one-checkout
-- stripe-webhook build. The /checkout route works without the table
-- (its insert is best-effort and logs instead of failing), so running
-- it late breaks nothing — the trace rows simply start when the
-- table does.

-- 1. The checkout session record ------------------------------------

create table if not exists public.checkout_sessions (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null,        -- the Title22 account (auth user id) that opened the checkout
  facility_ids           uuid[] not null default '{}',  -- the account's own homes the cart named
  lines                  jsonb not null,       -- the cart's priced lines: [{price, quantity, kind}] as sent to Stripe
  stripe_session_id      text not null,        -- Stripe Checkout Session id (cs_...)
  stripe_subscription_id text,                 -- filled in by checkout.session.completed
  state                  text not null default 'created',  -- created | completed
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists checkout_sessions_stripe_session_idx
  on public.checkout_sessions (stripe_session_id);

create index if not exists checkout_sessions_account_created_idx
  on public.checkout_sessions (account_id, created_at desc);

alter table public.checkout_sessions enable row level security;

-- Read: the account the checkout belongs to, and nobody else. Writes
-- are the webhook's alone, through the service key, which bypasses
-- RLS — there is deliberately no insert/update policy for users: a
-- checkout record is written by the payment flow, never by a browser.
drop policy if exists checkout_sessions_read on public.checkout_sessions;
create policy checkout_sessions_read on public.checkout_sessions
  for select to authenticated
  using (account_id = auth.uid());

revoke all on public.checkout_sessions from anon;
grant select on public.checkout_sessions to authenticated;

comment on table public.checkout_sessions is
  'One row per Stripe Checkout Session opened by the stripe-webhook /checkout route (one checkout, Nov 25 2026). A trace from account to session to subscription — never an entitlement source.';

-- 2. The webhook's Tello Staff activation flag ------------------------

alter table public.profiles
  add column if not exists title22_staff_addon boolean not null default false;

comment on column public.profiles.title22_staff_addon is
  'Stamped by stripe-webhook when a Tello Staff add-on subscription activates (the $10/home price, or the $5/home binder-bundle price once it exists). Cleared when that subscription is cancelled. The mirror of title22_training_included / title22_binder_addon.';
