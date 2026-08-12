# Cloudflare Workers — source of truth status

Three Workers back Title22 in production, plus the dashboard-only `stripe-webhook`.

`title22-ai`'s deployed source **is now committed** (`title22-ai/index.js`,
pulled 2026-08-03 via the Cloudflare API — see below to re-pull after any
change made directly in the dashboard). `title22-extract` was written in this
repo and has never been dashboard-edited, so its committed source is
authoritative. `stripe-webhook`'s source is still not committed; pull it the
same way before changing it.

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

## title22-extract

Backs the "Scan to fill" button in the staff, resident, and medication modals:
a photo of a paper form goes in, that form's fields come back as JSON for a
human to review before anything is saved.

- Route: `https://mission-control.infomomtelo.workers.dev/api/extract`
- **The deployed script is named `mission-control`, not `title22-extract`.**
  Cloudflare auto-generated that name when the Worker was created from the
  dashboard, and Workers cannot be renamed. The source directory keeps the
  descriptive name; `wrangler.toml`'s `name` field is what `wrangler deploy`
  targets, so leave it as `mission-control` or a deploy will silently create a
  second, empty Worker. To move to the intended name, create a new Worker
  called `title22-extract`, deploy this source to it, set the three secrets
  again, update `wrangler.toml` and `EXTRACT_WORKER` in `index.html`, then
  delete `mission-control`.
- Deployed 2026-08-05 from the Cloudflare dashboard (paste-the-file flow), not
  via `wrangler`. Re-pull the deployed source per the instructions at the top
  of this file before changing it, in case it has been edited in the dashboard
  since.
- Model: `claude-opus-5`, overridable with the `EXTRACT_MODEL` binding. This
  reads handwriting and small pharmacy print off phone photos, which is the
  whole point of the worker — measure on real scans before stepping down.
- Auth and metering are copied from `title22-ai` and must stay in step with it:
  same JWT verification, same `LIMITS` table, same default-deny on an
  unrecognized plan, and the same monthly `ai_usage` bucket (`app='title22'`).
  A scan costs one AI call. There is no separate tier gate — a plan's monthly
  cap is the only limit, so trial users can scan.
- Writes nothing. It has the service key (needed to verify the caller and
  deduct a credit) but never touches `residents`, `staff`, or `medications`;
  the frontend's existing save paths — and the audit-log triggers behind them
  — remain the only way a scan reaches the database.

### Request / response contract

```
POST /api/extract          Authorization: Bearer <supabase access_token>
{ "formType": "staff" | "resident" | "medication",
  "image": { "media_type": "image/jpeg", "data": "<base64, no data: prefix>" },
  "hint": "optional free text from the caregiver" }
```

```
200 { "formType", "formLabel", "notes",
      "fields": { "<key>": { "label", "type", "value", "confidence",
                             "source_text", "box", "unparsed"? } },
      "plan", "limit", "remaining", "isPaid" }
```

- `confidence` is `high` | `medium` | `low` | `not_found`. Anything the worker
  could not normalize into a usable value is downgraded to `not_found` and the
  raw reading is preserved in `unparsed`, so a bad date surfaces to the
  reviewer instead of vanishing.
- `box` is `[x0, y0, x1, y1]` normalized 0-1 from the top-left, or `null`.
  These are the model's **approximate** estimates — good enough to crop the
  photo next to each value, not good enough to rely on as ground truth. The
  frontend pads them generously and lets the reviewer open the full page.
- `value` is pre-normalized for the form: dates as `YYYY-MM-DD`, booleans as
  `yes`/`no`, phones as `(559) 555-0100`.
- Errors: 400 bad request, 401 unauthenticated, 402 monthly limit reached,
  413 image too large, 422 unreadable/refused/truncated, 502 upstream failure.
  All carry a `message` the frontend shows verbatim.

### Adding a field

The field keys are a contract with the frontend. `FORMS` in
`title22-extract/index.js` and `SCAN_FIELD_MAP` in the main app's `index.html`
must list the same keys, and every `el` in `SCAN_FIELD_MAP` must be a real
input id in the matching modal. A key with no mapping is shown in the review
sheet as read-only — it has nowhere to go.

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

## title22-email

- Route: `https://title22-email.infomomtelo.workers.dev/api/email`
- Like the other Workers here, merging a PR that changes this file does **not**
  ship it — after merge the Worker code still has to be pasted into the
  Cloudflare dashboard and deployed by hand.
- Sends transactional email through Resend with `RESEND_API_KEY`.
- Verifies the caller's Supabase JWT before sending, so the frontend can only
  email the signed-in user. Supported templates: `welcome`,
  `trial_warning`, `subscription_confirmed`, and `payment_failed`.
- Health check returns binding booleans and fails closed when
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, or `EMAIL_FROM`
  is missing.
