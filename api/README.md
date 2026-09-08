# `api/stripe-webhook.js` — this file does not run

**Nothing calls it. Nothing has ever called it. It is not the webhook.**

The webhook that actually runs is the Cloudflare Worker `stripe-webhook`,
deployed 2026-09-07 against the `memorable-wonder` Stripe destination. Its
source is `workers/stripe-webhook/index.js`. If you are here to change how a
Stripe event is handled, go there instead.

This file is kept, byte for byte, because it was supplied that way with the
instruction not to modify it. What follows is why it cannot be the answer,
so nobody spends a second afternoon rediscovering it.

## 1. It cannot run on this project's hosting as written

Per `SELF_HOST.md`, `title22.app` is a **Cloudflare Pages** site with **no build
step**, and the backend pieces are **Cloudflare Workers**. The handler is a
**Vercel serverless function**:

| What it uses | Why Cloudflare Pages can't run it |
|---|---|
| `export const config = { api: { bodyParser: false } }` | A Vercel-only convention. Pages ignores it. |
| `export default async function handler(req, res)` | Pages Functions export `onRequestPost({ request, env })` and return a `Response`. There is no `res`. |
| `req.on('data')` / `Buffer.concat` | Node streams. Workers use `await request.text()`. |
| `process.env.*` | Workers read `env.*`, bound as secrets in `wrangler`. |
| `import Stripe from 'stripe'` | No `package.json` and no build step in this repo, so nothing resolves the import. |
| `stripe.webhooks.constructEvent` | Synchronous Node crypto. On Workers use `constructEventAsync` with `Stripe.createSubtleCryptoProvider()`. |

The port was done rather than debated: `workers/stripe-webhook/index.js` is
that same logic in Workers idioms, with no npm dependency — the Stripe
signature is verified with Web Crypto directly, because this repo has no
build step to resolve an SDK import.

## 2. Three bugs in this file that the Worker does not have

Left in place here, since the file is not to be modified:

1. **`.update()` never creates a row.** Nothing in the app inserts into `users`
   — `enforcePaidGate` and `handleWelcome` only read it. A first-time buyer has
   no row, `.update()` matches nothing, and `paid` stays false: the exact bug
   this file was meant to fix.
2. **Email casing.** The app queries `.eq('email', user.email.toLowerCase())`.
   Stripe returns the address as the customer typed it, so `Ada@Example.com`
   writes a row the app will never find.
3. **`plan` is hardcoded to `'lite'`.** A $79 Multi-Home checkout would record
   `lite`, and `TIER_LIMITS.lite` allows one facility — capping a Multi-Home
   customer at one. The Worker reads the plan from the subscription's price ID.

It also handles only `checkout.session.completed`. The Worker additionally
handles `customer.subscription.created`, `.updated` and `.deleted`, so a
cancelled subscription does not keep access forever.

## 3. What is still broken, and it is not this file

The live Worker writes `profiles.title22_*` and `public.subscriptions`. It
does **not** write `users`, and nothing else does either. Meanwhile
`enforcePaidGate` and `welcomeIsPaid` in `index.html` still read
`users.paid`.

So a Lite payment today lands the correct plan in `profiles`, and the welcome
page still polls `users.paid` for 30 seconds and times out. The fix is one
function — point `welcomeIsPaid` at the source `readSubscription` already
trusts, or have the Worker upsert `users` too — and it is not a reason to
resurrect this file.

## 4. The RLS policy to drop

The Worker uses the **service-role key**, which bypasses RLS entirely — it does
not need the `"allow all for webhook"` policy in the users migration. That
policy is what exposes the customer list to the published anon key: it lets
anyone holding the anon key read every customer email and set `paid = true`.
Drop it and switch to the read-own-row policy written out in
`migrations/2026-09-06_title22_lite_users.sql`.
