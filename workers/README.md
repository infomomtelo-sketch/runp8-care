# Cloudflare Workers — source of truth status

Two live Workers back Title22. **Neither currently has its deployed source
committed to git.** Per the launch spec, the deployed `title22-ai` script must
be pulled from Cloudflare and committed here **before any change is made to
it** — do not reconstruct it from memory.

To capture the deployed source (needs a Cloudflare API token with
Workers Scripts:Read):

```sh
# List scripts
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Download one
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/title22-ai" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" > workers/title22-ai/index.js
```

Commit each Worker as `workers/<name>/index.js` + `workers/<name>/wrangler.toml`.

## title22-ai

- Route: `https://title22-ai.infomomtelo.workers.dev/api/chat`
- Model: `claude-haiku-4-5` (briefings). If a stronger model is added for the
  DSS grader use `claude-sonnet-5` — not `claude-sonnet-4-5`.
- Writes `ai_usage` rows with `app='title22'`.
- Required behavior (verify against deployed code once committed):
  - Verify Supabase JWT on every request; reject anonymous calls.
  - Per-tier limits recomputed per call, default-deny, expiry enforced:
    trial 20, starter 20, pro 200, specialist 200, agency 500.
  - Rate limit 10 requests/min per user.
  - Never comment on clinical dosage data — documentation compliance only.

## stripe-webhook

- Stripe destination: `memorable-wonder`.
- Maps live price IDs → `title22_plan`:
  - `price_1TkIKtAH9qPFLg89SEmENr5J` → starter
  - `price_1TkILaAH9qPFLg8923rgvHHb` → pro ($79)
  - `price_1TkIMaAH9qPFLg89SPFZH0aG` → specialist ($149)
  - `price_1TkINiAH9qPFLg89upIhpYTy` → agency
- Must handle `customer.subscription.deleted` (downgrade path) and stamp
  `title22_plan_expires_at` on cancellation so the frontend expiry check
  (`resolveEntitlement`) locks access at period end.
- Writes ONLY `title22_*` columns on `profiles`.
