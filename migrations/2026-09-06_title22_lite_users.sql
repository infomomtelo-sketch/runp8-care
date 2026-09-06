-- Title22 Lite: the paid-account table the Stripe webhook writes and the app
-- reads on boot (enforcePaidGate in index.html).
--
-- Additive and idempotent. Safe to re-run. Nothing is dropped.

create table if not exists users (
  email text primary key,
  paid boolean default false,
  plan text,
  stripe_customer_id text,
  created_at timestamptz default now()
);

alter table users enable row level security;

-- As specified in the pivot note. READ THE WARNING BELOW BEFORE SHIPPING IT.
create policy "allow all for webhook" on users for all using (true) with check (true);


-- WARNING — what this policy actually grants -------------------------------
--
-- `using (true) with check (true)` for `all` applies to every role that can
-- reach PostgREST, which includes `anon` — the key published in index.html.
-- With this policy in place, anyone who opens the page can:
--
--   * read every row: the full list of customer emails, plans, and Stripe
--     customer ids;
--   * write any row: `update users set paid = true where email = 'me@...'`
--     from the browser console, which is the entire paid gate.
--
-- The gate in step 5 is therefore a speed bump, not a control. That may be an
-- acceptable trade for launching today — it is the same posture as the rest
-- of this app, which is client-side by design — but it should be a decision,
-- not a surprise, and it is a customer-list disclosure as much as a revenue
-- one.
--
-- The narrower version, if the webhook uses the service-role key (it bypasses
-- RLS, so it needs no policy of its own), is: drop the policy above and let
-- each signed-in user read only their own row.
--
--   drop policy "allow all for webhook" on users;
--   create policy "read own row" on users
--     for select to authenticated
--     using (lower(email) = lower(auth.jwt() ->> 'email'));
--
-- No insert/update/delete policy: with RLS enabled and no policy, those are
-- denied for anon and authenticated, and the service-role webhook is
-- unaffected. Same app behaviour, without handing the flag to the browser.


-- Email casing --------------------------------------------------------------
--
-- The app queries with .eq('email', user.email.toLowerCase()), so a row
-- written by the webhook in mixed case will not be found. Either lower-case
-- on write, or enforce it here:
--
--   create unique index if not exists users_email_lower_idx on users (lower(email));
