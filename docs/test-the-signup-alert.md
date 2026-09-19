# Testing the signup alert

A notifier's failure mode is silence, and silence is exactly what "nobody
signed up" also looks like. So this is not optional, and it is not a single
test — it is four, each of which isolates one hop.

Companion to `docs/test-the-29-path.md`. Same discipline: prove each hop
before trusting the next, and **read the delivery log before reading any code.**

The path:

    signup → profiles row → Supabase Database Webhook → Worker → Resend → inbox

## 0. Before anything, set up

Cloudflare → Workers → `title22-email` → Settings → Variables and Secrets:

- `SIGNUP_WEBHOOK_SECRET` — any long random string
- `SIGNUP_NOTIFY_TO` — the address alerts go to

Then deploy the Worker. **Merging does not deploy it.** No CI workflow covers
this one; the code has to be pasted into the dashboard editor and deployed by
hand, like every Worker here except `stripe-webhook`.

## 1. Is the Worker deployed and configured?

No signup needed, no secret needed. Open the base URL in a browser:

    https://title22-email.infomomtelo.workers.dev/

| You see | Meaning |
|---|---|
| `"signup_notify_ready": true` | Both secrets are set. Go to step 2. |
| `"signup_notify_ready": false` | One of the two secrets is missing — `signup_notify` says which. |
| `"status": "misconfigured"` | A CORE binding is missing. The signup route is the least of your problems. |
| 404 / nothing | The Worker is not deployed, or not on this route. |

This one check catches "I forgot to deploy" and "I forgot a secret", which are
the two most likely failures and both look like "no email arrived".

## 2. Does the Worker mail you? (no signup required)

Send it a hand-made payload shaped exactly like Supabase's:

```bash
curl -i -X POST \
  https://title22-email.infomomtelo.workers.dev/api/notify-signup \
  -H "Content-Type: application/json" \
  -H "X-Title22-Signup-Secret: YOUR_SECRET_HERE" \
  -d '{"type":"INSERT","table":"profiles","schema":"public",
       "record":{"id":"test-0001","email":"test@example.com",
                 "title22_plan":"trial","referred_by":"testcode"},
       "old_record":null}'
```

Expected: `200 {"ok":true,"kind":"signup","id":"em_..."}` and an email titled
**"Title22: new signup via testcode"**.

| Response | What is actually wrong |
|---|---|
| `200 {"ok":true,...}` and no email in 2 min | **Check spam first.** Then check `SIGNUP_NOTIFY_TO` is the address you are watching. Resend accepted it, so the Worker is fine. |
| `200 {"ok":true,"skipped":...}` | The payload is wrong, not the Worker. `record.title22_plan` must be set and `old_record.title22_plan` must not be. |
| `401` | Secret mismatch. Look for a trailing space or newline from pasting — the comparison is exact and constant-time. |
| `500 missing binding(s): X` | That secret is not set. It names the one. |
| `502 Resend refused` | The body carries Resend's own message. Almost always the `EMAIL_FROM` domain is not verified in Resend, or the API key is wrong. |
| `404` / connection error | Worker not deployed, or the route path differs. |

Passing step 2 proves everything except Supabase.

## 3. Does Supabase actually fire?

Supabase → Database → Webhooks → your hook. **It keeps a delivery log with the
response code for every attempt. That page is the first thing to open when an
email does not arrive — not the Worker code, not the app.**

Four days went into the 2026-09-13 outage because nobody opened the equivalent
page in Stripe, which had been showing red 500s since the moment of purchase.
Do not repeat it here.

Check the hook itself:

- Table is `public.profiles`
- **Insert AND Update are both ticked.** Update alone is not enough, Insert
  alone silently misses anyone who already had a profile from Thelo or
  TheJudgy — see `workers/README.md`.
- The header name is exactly `X-Title22-Signup-Secret`

## 4. End to end, with a real signup

Use **plus addressing** so you do not need a second mailbox:

    infomomtelo+t1@gmail.com

Gmail delivers `you+anything@gmail.com` to your inbox, and Supabase treats it
as a distinct account. Increment the suffix for each test.

1. Sign up at <https://title22.app> with that address.
2. The alert should land within a minute or so.
3. **Stop there — do not create a facility.** A test facility is real, it
   counts, and there are already 49 of them across 32 accounts. The guarded
   reset is `migrations/2026-09-08_title22_reset_test_facilities.sql`.

To test the conversion alert without paying, you would have to move a plan in
the database by hand. **Do not do that on your own account** — it changes your
real entitlement. It is better tested by the next genuine purchase, which is
also the moment you most want to know whether it works.

## What this still cannot tell you

**An alert that never arrives is indistinguishable from nobody signing up.**
Steps 1-4 prove the pipe works *today*. They say nothing about six months from
now, when a domain lapses, a secret is rotated, or somebody pauses the hook.

The fix for that class is an email that arrives **even when nothing happened** —
a scheduled digest reporting zero. Zero is information; silence is not. Not
built yet.
