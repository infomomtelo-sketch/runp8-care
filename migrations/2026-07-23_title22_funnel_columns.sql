-- Title22 marketing-funnel attribution columns (Section 5, two-domain launch).
-- Additive and idempotent: safe to run repeatedly, touches ONLY namespaced
-- title22_* columns. Never touches the shared columns (plan,
-- stripe_subscription_id, plan_expires_at, trial_ends_at, access_granted).
--
-- Run in the Supabase SQL editor for project nwlhsshvqmbhemhxcran.

alter table public.profiles
  add column if not exists title22_utm_source   text,
  add column if not exists title22_utm_campaign text,
  add column if not exists title22_signup_plan  text;

comment on column public.profiles.title22_utm_source   is 'Title22: utm_source captured at signup from title-22.com CTA';
comment on column public.profiles.title22_utm_campaign is 'Title22: utm_campaign captured at signup from title-22.com CTA';
comment on column public.profiles.title22_signup_plan  is 'Title22: ?plan= tier the user clicked on the marketing site before signup';

-- No new GRANTs needed: these columns ride on the existing profiles RLS
-- policies (user can update own row). Verify with:
--   select * from pg_policies where tablename = 'profiles';
