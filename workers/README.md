# Cloudflare Workers — source of truth status

Five Workers back Title22 in production, plus the dashboard-only `stripe-webhook`.

`title22-ai`'s deployed source **is now committed** (`title22-ai/index.js`,
pulled 2026-08-03 via the Cloudflare API — see below to re-pull after any
change made directly in the dashboard). `title22-extract` was written in this
repo and has never been dashboard-edited, so its committed source is
authoritative. `stripe-webhook` was dashboard-only until 2026-09-07; the
committed source is now what is deployed.

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

**2026-09-27: now deployed from this repo** — Actions → "Deploy title22-ai
Worker" (`deploy-title22-ai.yml`). Before deploying it reads the live Worker's
binding names and types and stops if a deploy would erase one (the
stripe-webhook outage). Its first run did exactly that: `SUPABASE_URL` was a
plain-text var typed into the dashboard, so it now lives in `[vars]` in
`wrangler.toml` (it is public) beside the two model names.
`SUPABASE_SERVICE_KEY` and `ANTHROPIC_API_KEY` are secrets and a deploy
leaves them alone. `node test.mjs` runs the
real Worker against a stubbed Supabase and Anthropic.

### Tello's own routes (title22.app/tello) — `tello.js`

- `GET /api/tello/me`, `POST /api/tello`, `POST /api/tello/new`,
  `GET /api/tello/snapshot`, `POST /api/tello/brief`.
- **The server chooses who Tello is.** The page sends only `{message}`.
  Customer mode: `tello/core.js` + `tello/title22-knowledge.js` (the owner's
  knowledge file). Partner mode: the signed-in user's id is in
  `public.tello_founders` → the owner's private instructions from
  `public.tello_private` (key `founder`), the `business_snapshot` tool, Sonnet 5 (medium effort, 8,000-token room because it thinks by default).
  Both tables are service-role only; no button, URL or field switches modes,
  and a failed lookup answers as customer mode.
- **The partner instructions are not in git** — this repo is public. They are
  loaded with a private SQL paste the owner keeps. Without them partner mode
  runs on `PARTNER_FALLBACK` and the page says so.
- Memory is written by the Worker: customers to `tello_messages`, partner
  chats to `tello_founder_messages` (owner can read and delete their own rows;
  only the Worker writes). `ai_usage` app `tello-partner` counts partner calls
  (1,500/month) apart from any customer plan.
- `business_snapshot` = `public.tello_business_snapshot()`: counts only, no
  names. MRR is list price × active rows in `subscriptions`, not Stripe.
- Briefs: one "today" per LA day and one "weekly" per LA week, cached as rows
  (`kind`, with the counts in `data`) so tomorrow's can say what changed.
- Tables and function: `migrations/2026-09-27_tello_partner.sql`.
- Google sign-in on /tello needs `https://title22.app/tello` in Supabase →
  Auth → URL Configuration → Redirect URLs.

### /api/chat (the in-app Tello)

- Route: `https://title22-ai.infomomtelo.workers.dev/api/chat`
- Takes its `system` from the page (it carries that facility's context).
- 2026-09-27: `lite` (200/mo) and `multi` (500/mo) added to the limits and
  paid plans — before, a paying Lite or Multi-Home customer resolved to
  `trial`. Plan spellings folded like the app's `t22NormalisePlan`. The two
  input dosage filters are one list (`inputIsBlocked`), and the refusal no
  longer offers a MAR or resident documentation.
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

Backs the Scan button on five staff certificate slots (CPR, First Aid, Live
Scan, Mandated Reporter, training): a photo of ONE certificate goes in, that
certificate's own fields come back as JSON for a person to review before
anything is saved. TB, resident and medication scans are refused (403). See
"Scan to fill" in CLAUDE.md. Deploy with the "Deploy title22-extract Worker"
workflow; test with `node test.mjs`.

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
  via `wrangler`. From 2026-09-29 it has a workflow; `keep_vars = true` in
  `wrangler.toml` keeps any var the dashboard holds.
- Model: `claude-opus-5`, overridable with the `EXTRACT_MODEL` binding. This
  reads handwriting and small pharmacy print off phone photos, which is the
  whole point of the worker — measure on real scans before stepping down.
- Auth and metering are copied from `title22-ai` and must stay in step with it:
  same JWT verification, same `LIMITS` table, same default-deny on an
  unrecognized plan, and the same monthly `ai_usage` bucket (`app='title22'`).
  A scan costs one AI call. There is no separate tier gate — a plan's monthly
  cap is the only limit, so trial users can scan.
- Resident scans are additionally guarded by the optional `ALLOW_RESIDENT_SCAN`
  binding. Leave it unset / false until a HIPAA BAA exists. The frontend still
  hides the button, but the Worker now rejects `formType: "resident"` unless
  that binding is explicitly set to `true`.
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
- Route: `https://stripe-webhook.infomomtelo.workers.dev` (a GET answers
  "Method not allowed" — that is the deployed Worker saying hello).
- **Last deployed 2026-09-07, version `9af47f8e-2b66-4c74-aa17-f890aca4e9ef`,
  and NOT with `wrangler deploy`** — Cloudflare records the source of that
  deploy, and every deploy of this Worker so far, as `quick_editor`: pasted
  into the dashboard. This file used to claim it was deployed from
  `stripe-webhook/index.js`; the CONTENT came from there, the deploy did not.
  Nothing in this repo has ever been the deployed artifact. The first CI
  deploy will be, and it replaces the dashboard copy wholesale — so if anyone
  has hand-edited in the dashboard since 2026-09-07, diff it before deploying.
- **`SUPABASE_URL` lives in `wrangler.toml`'s `[vars]`, and must stay there.**
  It was a dashboard-only plain-text var until 2026-09-13, and the first two CI
  deploys (runs #8 and #9, 2026-09-09) deleted it — `wrangler deploy` preserves
  secrets but replaces vars with whatever the toml declares, which was nothing.
  The Worker then threw `TypeError: Invalid URL` on every Supabase call and
  answered 500 to `checkout.session.completed` and
  `customer.subscription.created` for four days, through a real $29 purchase.
  Setting it in the dashboard does not fix this; the next deploy erases it
  again. Same rule for every other Worker here: **a var that is not in
  `wrangler.toml` does not survive CI**, and right now none of these six files
  declares one. The other five have only ever been deployed by hand, so they
  still hold their dashboard values — check before putting any of them in CI.
- **Live compatibility date is `2026-05-21`; `wrangler.toml` says
  `2026-09-07`.** A deploy moves it forward. This Worker uses only fetch, Web
  Crypto and JSON, so nothing here is sensitive to it — noted because it rides
  along with the deploy rather than being asked for.
- Account `701117dde6af00d42bac3c4058b660be`, workers.dev subdomain
  `infomomtelo`, route enabled. The account ID is deliberately NOT committed
  anywhere in this repo — it is public — so CI passes it as a secret.
- **Why it was redeployed:** the $29 Lite price was missing from the old
  price map, so a Lite payment on 2026-09-06 charged the card and left the
  customer on "Free Trial" — the webhook could not name a plan for the price
  and wrote nothing. `price_1UClAiAH9qPFLg89ln6eHAVa` → `lite` is now in the
  map, and an unmapped price returns 422 with a `console.error` instead of
  failing silently.
- It writes `profiles.title22_*` **and** `public.subscriptions`. The old one
  wrote only profiles, which is why the two stores disagree — one row there
  still says `active` on a period that ended six weeks ago. That row predates
  this deploy and is still there; decide it against Stripe.
- **It does not write `users`, and it should not start.** `public.users` does
  not exist — that migration was never run (checked 2026-09-08, ERROR 42P01).
  The app used to read `users.paid` on the welcome page and got an error every
  time, which is why buyers saw "we could not check your account". It now
  resolves the entitlement from profiles and subscriptions instead. Adding a
  `users` upsert here would create a third store of who has paid, beside two
  that already disagree.
- Maps live price IDs → `title22_plan`:
  - `price_1UClAiAH9qPFLg89ln6eHAVa` → lite ($29)
  - `price_1TkIKtAH9qPFLg89SEmENr5J` → starter
  - `price_1TkILaAH9qPFLg8923rgvHHb` → pro ($79)
  - `price_1TkIMaAH9qPFLg89SPFZH0aG` → specialist ($149)
  - `price_1TkINiAH9qPFLg89upIhpYTy` → agency
- Must handle `customer.subscription.deleted` (downgrade path) and stamp
  `title22_plan_expires_at` on cancellation so the frontend expiry check
  (`resolveEntitlement`) locks access at period end.
- Writes ONLY `title22_*` columns on `profiles`.

## title22-documents

- Route: `https://title22-documents.infomomtelo.workers.dev/api/document`
- Like the other Workers here, merging a PR that changes this file does **not**
  ship it — after merge the Worker code still has to be pasted into the
  Cloudflare dashboard and deployed by hand.
- Verifies the caller's Supabase JWT, resolves their facility role
  server-side, checks a document capability (`document.read_content` or
  `document.share`), then signs only that private Storage object.
- Uses `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. It reads `facilities`,
  `facility_members`, `documents`, and writes best-effort access events into
  `public.events`.

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
  is missing. It also reports `signup_notify_ready` separately, and that one
  is deliberately NOT folded into the overall `ok` — a health check that goes
  red because an unused optional route is unconfigured is a health check
  people stop reading.

### `POST /api/notify-signup` — owner alert on a new signup

Receives a **Supabase Database Webhook** on `public.profiles` and mails the
OWNER (never the customer). No JWT, because a database cannot hold one; it
authenticates on `SIGNUP_WEBHOOK_SECRET`, sent by the webhook as the header
`X-Title22-Signup-Secret` and compared in constant time.

Subscribe the webhook to **INSERT *and* UPDATE**. Both halves matter:

- `profiles` is SHARED with the other apps on this Supabase project, so a bare
  INSERT there may be a TheJudgy or Thelo signup rather than a Title22 one.
- Somebody who already used one of those apps gets an **UPDATE** when they join
  Title22, never an INSERT. An INSERT-only webhook misses them in silence.

So the ROW TRANSITION decides, not the event type:

| `old_record.title22_plan` → `record.title22_plan` | Result |
|---|---|
| (none) → `trial` | `signup` |
| (none) → a paid plan | `signup_paid` — they paid before they signed up |
| `trial` → a paid plan | `converted` — the one that matters |
| (none) → (none) | skipped, 200 |
| `lite` → `lite` (other column touched) | skipped, 200 |
| `lite` → `trial` (downgrade) | skipped, 200 |

**The skips answer 200 on purpose.** Most row changes on a shared table are not
a Title22 signup. Returning an error would make `pg_net` retry a non-event and
fill the webhook log with permanent red — and a log that is always red is a log
nobody reads, which is exactly how the 2026-09-13 outage survived four days.
Distinguishing "not ours" from "ours and broken" is the same split
`stripe-webhook` makes between 200-and-dropped and 422.

The mail carries email, plan, **`referred_by`**, UTM source and campaign, trial
end and profile id. `referred_by` is the reason to watch `profiles` rather than
`auth.users`: it is how a trainer's student is attributed, and finding that out
at payout instead of on the day is how a partner relationship goes quiet.

Two secrets to set before it works — `wrangler secret put SIGNUP_WEBHOOK_SECRET`
and `wrangler secret put SIGNUP_NOTIFY_TO`. Missing either returns **500 naming
the missing binding in the response body**, where the Supabase webhook log
records it.

## title22-geo

- Route: `https://title22-geo.infomomtelo.workers.dev/api/address`
- **Not deployed yet.** The source was written in this repo; it still needs
  `wrangler deploy` from `workers/title22-geo/` and a `GEOAPIFY_API_KEY`
  secret before the address fields in `index.html` do anything. Until then
  the frontend degrades to a plain text input, which is the intended
  fallback — nothing errors and nothing blocks a save.
- Backs address autocomplete on the facility address fields
  (`facm-address`, `ob-address-street`). Geoapify was chosen over Google
  Places on cost: 3,000 autocomplete requests/day free with commercial use
  allowed, against Google's per-request billing on abandoned sessions.
- Holds `GEOAPIFY_API_KEY` as a Worker secret. `index.html` has no build
  step, so a key placed in the page would simply be public — that, and
  nothing else, is why this Worker exists.
- Verifies the caller's Supabase JWT with `SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY` before spending a lookup, so the free tier cannot be
  drained by anyone who finds the URL.
- Returns California street addresses only; the product is California-only
  and onboarding fixes the state rather than asking for it.
- Carries no PHI. It is sent a partial street address and nothing else, and
  it must never be pointed at resident, medication or staff data.
- Health check (`GET` with no `q`) returns binding booleans and fails closed
  when a secret is missing.

## title22-voice

Tello's voice (Kokoro-82M `af_heart` via DeepInfra). Voice approved by the
owner 2026-09-27 from the live preview on a phone.

- `GET /api/tello/voice-preview` — the match test. Speaks one fixed sentence,
  takes no text; edge-cached. `?format=wav`, `?fresh=1`.
- `POST /api/tello/briefing-voice` — `{"text": ...}` with the user's Supabase
  access token as `Authorization: Bearer`. Strips markdown, caps at 1,200
  characters, applies the pronunciation rules and numbers-as-words
  (`speech.js`), renders, and caches the MP3 in R2 under
  `voice/<sha256(text+voice)>.mp3`. 10 new renders per user per Pacific day
  (`rate/<day>/<user>` in the same bucket); a cached replay does not count and
  a failed render is given back. CORS: `https://title22.app` only.
  It proves who is asking and bounds the spend; it cannot prove the text is
  that user's own briefing (the briefing is written in the browser). Accepted
  by the owner 2026-09-27.
- `GET /health` — which bindings are missing (names only).
- Audio: ask DeepInfra for WAV, refuse anything not 24 kHz, peak-normalise to
  0.89, encode 160 kbps mono MP3 in the Worker (`@breezystack/lamejs`,
  LGPL-3.0).
- Secret: `DEEPINFRA_API_KEY` (set). Everything else is in `wrangler.toml`,
  including the public Supabase URL and anon key and `preview_urls`/
  `observability`, because a deploy replaces whatever the dashboard held.
- R2 bucket `title22-voice-cache` must exist before deploying, with a 7-day
  lifecycle rule (dashboard: R2 -> bucket -> Settings).
- Deploy: Actions -> "Deploy title22-voice Worker". `node test.mjs` runs every
  route offline with DeepInfra, Supabase and R2 stubbed.

## partner-tello (`workers/partner_tello/`)

Partner Tello, title22.app/meet?k=<key>. Its own Worker, deployed only by
`.github/workflows/deploy-partner-tello.yml` (manual). Source of truth: this
directory; nothing about it was ever pasted into the dashboard.

- Entry `worker.js` bundles `prompt.md` and `knowledge.md` as text; the logic
  is `app.js`. Tests: `npm ci && node test.mjs` (fetch mocked). After a
  deploy, `partner-tello-live-test.yml` runs the owner's tests live.
- Uses `@anthropic-ai/sdk` (pinned in `package.json`, lockfile committed).
- Secrets, set in the dashboard: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
  `PARTNER_TELLO_DB_SECRET`. Vars in `wrangler.toml`: `SUPABASE_URL`,
  `SUPABASE_ANON_KEY` (public; no service key), `PARTNER_TELLO_MODEL`.
- Cron every 10 minutes resends emails that failed.
- See CLAUDE.md, "Partner Tello".
