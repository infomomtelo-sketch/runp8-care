-- Title22 subscription enforcement columns on profiles.
-- Additive and idempotent. Run after 2026-08-13b_title22_facility_capabilities.sql.
--
-- These columns are written by the stripe-webhook Cloudflare Worker (service role)
-- and read by the frontend to gate paid features.
--
-- title22_plan values: 'trial' | 'active' | 'past_due' | 'canceled' | 'free'
-- title22_plan_expires_at: null means indefinite (legacy / manually granted)
-- title22_subscription_id: Stripe subscription ID for the customer portal link

alter table public.profiles
  add column if not exists title22_plan             text not null default 'trial',
  add column if not exists title22_plan_expires_at  timestamptz,
  add column if not exists title22_subscription_id  text;

-- Ensure authenticated users can still read/write their own profile row
-- (existing policies cover this; no changes needed to profiles RLS).

comment on column public.profiles.title22_plan is
  'Subscription tier: trial | active | past_due | canceled | free. Written by stripe-webhook Worker only.';

comment on column public.profiles.title22_plan_expires_at is
  'UTC timestamp when the current plan expires. NULL = no expiry (legacy). Written by stripe-webhook Worker only.';

comment on column public.profiles.title22_subscription_id is
  'Stripe subscription ID. Used to link the customer portal. Written by stripe-webhook Worker only.';
