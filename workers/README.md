# Cloudflare Workers — source of truth status

Two live Workers back Title22.

`title22-ai`'s deployed source **is now committed** (`title22-ai/index.js`,
pulled 2026-08-03 via the Cloudflare API — see below to re-pull after any
change made directly in the dashboard). `stripe-webhook`'s source is still
not committed; pull it the same way before changing it.

To re-capture deployed source after a dashboard-only edit (needs a
Cloudflare API token with Workers Scripts:Read):

```sh
# List scripts
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Download one (multipart response — the script body is the part between the
# boundary markers, under the "worker.js" form field)
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/title22-ai" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Commit each Worker as `workers/<name>/index.js` + `workers/<name>/wrangler.toml`.
Deploy a change with `wrangler deploy` from inside `workers/<name>/`.

## title22-ai

- Route: `https://title22-ai.infomomtelo.workers.dev/api/chat`
- Model: `claude-haiku-4-5-20251001`. If a stronger model is added for the
  DSS grader use `claude-sonnet-5` — not `claude-sonnet-4-5`.
- Writes `ai_usage` rows with `app='title22'`.
- Verified behavior, read from the deployed source on 2026-08-03 (this
  superseded the older numbers previously documented here — trial/starter
  were 20, there was no `edu` tier, and a 10 req/min rate limit was claimed):
  - Verifies the caller's Supabase JWT on every request; rejects anonymous
    calls (401).
  - Monthly call limits, default-deny on any unrecognized plan (falls back
    to `trial`), expiry-checked against `title22_plan_expires_at`:
    trial 50, edu 100000, starter 50, pro 200, specialist 200, agency 500.
  - **No per-minute rate limit found in the Worker script.** If one exists,
    it's enforced elsewhere (a Cloudflare Rate Limiting rule on the route,
    configured outside this repo) — worth confirming in the dashboard if
    that protection is actually still wanted.
  - `tools` (Anthropic tool-use) is forwarded to Claude when the caller
    sends one; optional, so callers that don't send `tools` are unaffected.
  - Does not itself enforce a no-dosage-commentary rule — that constraint
    lives in the `system` prompt the caller sends (see AI_TOOLS / the system
    string built in `sendAIQuery()` in the main app's `index.html`), not in
    this Worker. If that's meant to be a hard guarantee rather than a
    prompt-level convention, it isn't currently enforced server-side.

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
