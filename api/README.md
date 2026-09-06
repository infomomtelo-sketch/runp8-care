# `api/stripe-webhook.js` — what it is and what it still needs

`stripe-webhook.js` is committed exactly as supplied. Nothing in it has been
changed. This file records what has to be true around it before it flips
`users.paid`, because none of it is true today.

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

Two ways forward — pick one deliberately:

- **Deploy this file to Vercel** as a separate project (`api/stripe-webhook.js`
  is already the path Vercel expects), point the Stripe endpoint at it, and add
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` there. The app itself stays on Pages.
- **Port it to a Worker** under `workers/`, alongside `title22-ai` and
  `title22-email`, and deploy with `wrangler`. Same logic, Workers idioms.

## 2. Three things to fix before it flips anyone to paid

These are in the supplied code and were left as-is:

1. **`.update()` never creates a row.** Nothing in the app inserts into `users`
   — `enforcePaidGate` and `handleWelcome` only read it. A first-time buyer has
   no row, `.update()` matches nothing, and `paid` stays false: the exact bug
   this file exists to fix. It needs an upsert:

   ```js
   await supabase.from('users').upsert(
     { email, paid: true, stripe_customer_id: session.customer, plan: 'lite' },
     { onConflict: 'email' }
   );
   ```

2. **Email casing.** The app queries `.eq('email', user.email.toLowerCase())`.
   Stripe returns the address as the customer typed it, so `Ada@Example.com`
   writes a row the app will never find. Lower-case on write
   (`email.toLowerCase()`), and add the unique index in
   `migrations/2026-09-06_title22_lite_users.sql`.

3. **`plan` is hardcoded to `'lite'`.** A $79 Multi-Home checkout records
   `lite`, and `TIER_LIMITS.lite` allows one facility — so a Multi-Home
   customer is capped at one. Read it from the Payment Link's metadata
   (`session.metadata?.plan`) and fall back to `'lite'`.

Also unhandled: `customer.subscription.deleted` and
`invoice.payment_failed`. Without them a cancelled subscription keeps
`paid = true` forever.

## 3. The RLS policy this writes through

The webhook uses the **service-role key**, which bypasses RLS entirely — it does
not need the `"allow all for webhook"` policy in the users migration. That
policy is what exposes the customer list to the published anon key. Once this
webhook is live, drop it and switch to the read-own-row policy written out in
`migrations/2026-09-06_title22_lite_users.sql`.
