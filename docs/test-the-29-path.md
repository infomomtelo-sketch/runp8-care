# Testing the $29 path end to end

The longest-open item in CLAUDE.md. The webhook price map and `welcomeIsPaid`
were fixed two days apart and have never met a real Stripe event together —
that combination is what charged a card on 2026-09-06 and showed the customer
"Free Trial" through every refresh.

This is how to run it once, and how to tell exactly which hop failed.

## Before you start: test mode will not work

Stripe's test mode issues its own price ids, and `PRICE_PLANS` in
`workers/stripe-webhook/index.js` knows only the live ones. A test-mode event
arrives with a price the Worker has never heard of, and it refuses with 422 —
correctly, but you learn nothing about the real path. The dashboard's "send
test webhook" is worse: synthetic ids match no customer, so it exercises the
signature check and nothing else.

**So this is a real $29 charge on a real card, refunded afterwards.** Budget a
dollar or two — the processing fee may not come back with the refund.

## Pre-flight

1. The deployed Worker is whatever the last successful run of
   "Deploy stripe-webhook Worker" pushed. Check Actions before assuming your
   latest commit is live — `workers/stripe-webhook/` changes do nothing until
   that workflow runs.
2. Use a NEW email you control, not an existing account. An existing account
   with a plan already on it cannot show you a failure.
3. Buy from inside the app: sign up first, then Billing → Lite. That is the
   path every CTA on title-22.com leads to, so it is the path to test.
   `openStripe()` attaches `client_reference_id`, which is what makes
   attribution reliable.

## Run it

Sign up → Billing → subscribe to Lite ($29) → complete checkout → land back on
`title22.app#welcome`.

Then check the three hops in order. Stop at the first one that is wrong; the
later checks only make sense if the earlier ones passed.

### Hop 1 — did Stripe deliver, and did the Worker accept?

Stripe Dashboard → Developers → Webhooks → the `memorable-wonder` destination.
Look at the deliveries for the last two minutes. Expect **200** on
`checkout.session.completed` and on `customer.subscription.created`.

| Response | What it means |
|---|---|
| 200 | Worker accepted it. Go to hop 2. |
| 400 | Signature failed. `STRIPE_WEBHOOK_SECRET` on the Worker does not match this destination's secret. |
| 409 | It could not work out which user this is. Either the account did not exist yet, or the email on the Stripe customer differs from the account email. Stripe will retry for ~3 days, so creating the account now can still heal it. |
| 422 | The price is not in `PRICE_PLANS`. Nothing heals this without a code change and a deploy. |
| 500 | Handler error — read the Worker tail. |

### Hop 2 — did it write both stores?

Supabase SQL editor. Replace the email.

```sql
-- a) find the user
select id, email, created_at from auth.users where email = 'YOUR_TEST_EMAIL';

-- b) profiles — what the app falls back to
select id, title22_plan, title22_subscription_id,
       title22_trial_ends_at, title22_plan_expires_at
  from public.profiles
 where id = 'USER_ID_FROM_ABOVE';

-- c) subscriptions — what the app prefers
select user_id, plan, status, stripe_subscription_id, current_period_end
  from public.subscriptions
 where user_id = 'USER_ID_FROM_ABOVE'
 order by current_period_end desc nulls last;
```

What correct looks like:

- `profiles.title22_plan` = **`lite`** — not `trial`
- `profiles.title22_subscription_id` = the `sub_...` id
- `profiles.title22_plan_expires_at` = **null** (an active sub carries no expiry)
- `subscriptions.plan` = **`lite`**, `status` = **`active`**
- `subscriptions.current_period_end` = **about 30 days out, and NOT NULL**

**`current_period_end` being null is the one to watch.** Stripe's 2025-03-31 API
moved it off the subscription onto its items; `periodEndOf()` reads the items as
a fallback. A null here means that fallback did not fire, and `readSubscription`
will treat the row as undated — which is survivable but is half of the original
bug.

### Hop 3 — does the app agree?

Reload `title22.app`. The billing tab and the sidebar badge should say **Lite**,
not Free Trial. Tello, the checklist and the tabs should all be available.

## Decoding a failure

| Symptom | Where it is |
|---|---|
| Stripe 409, nothing in either table | Attribution. No account, or the checkout email differs from the account email. |
| Stripe 422 | `PRICE_PLANS` is missing the price. Add it, then run the deploy workflow. |
| `subscriptions` row correct, `profiles.title22_plan` = `trial` | The PATCH matched no profile row. `planToStamp()` heals this on next login — confirm it does. |
| `current_period_end` null | `periodEndOf()` did not find the items fallback. |
| Both tables correct, app still says Free Trial | `readEntitlement` / `readSubscription`. Everything upstream is fine. |
| Stripe shows no delivery at all | The Payment Link is not wired to this webhook destination. |

## Afterwards

Refund the charge in Stripe and cancel the subscription. Cancelling fires
`customer.subscription.deleted`, which stamps `title22_plan_expires_at` — so it
is worth watching as a free second test of the downgrade path: access should
run to the end of the period rather than stopping immediately.

Then delete the test account and its facility, or it joins the pile the
test-facility reset exists to clear.

## Record the result

If it passes, say so in CLAUDE.md and close the item — it has been open since
2026-09-08 and "never tested" is worth more than a guess either way. If it
fails, the table above says which hop, and that is a much smaller problem than
the one this document starts with.
