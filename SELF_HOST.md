# Self-hosting / deploying Title22

Title22 is two Cloudflare Pages sites plus two Cloudflare Workers on a shared
Supabase project. There is **no build step** anywhere — everything deploys as
static files or a single Worker script.

## Repos

| Repo | Domain | What it is |
|---|---|---|
| `runp8-care` (this repo) | `title22.app` | Product app — single-file vanilla JS SPA (`index.html`) |
| `title-22-site` | `title-22.com` | Marketing site — static pages |

## 1. Frontend (this repo → Cloudflare Pages)

1. Cloudflare Dashboard → Pages → Create project → connect this repo.
2. Build command: **none**. Output directory: `/` (repo root).
3. Custom domain: `title22.app`.
4. `_redirects` handles legacy paths. There is intentionally **no**
   `/* /index.html 200` rule: Cloudflare Pages serves `index.html` for
   unmatched routes automatically when no `404.html` exists (SPA mode), and an
   explicit catch-all would shadow `legal.html` / `privacy.html` / `terms.html`.
5. Configuration is hardcoded in `index.html` (see `.env.example` for the
   list). To point at your own Supabase project, edit `SUPABASE_URL`,
   `SUPABASE_ANON`, `AI_WORKER`, and the Stripe links at the top of the
   `<script>` block.

### Auth redirect rule

The Supabase project is shared by multiple apps. Every `redirectTo` in this
app hardcodes `https://title22.app` — **never** use `window.location.origin`.
If you self-host under a different domain, change those hardcoded URLs *and*
add your domain to Supabase Auth → URL Configuration → Redirect URLs.

## 2. Database (Supabase)

- Tables used: `profiles` (only `title22_*` columns + `created_at`,
  `referred_by`), `facilities`, `facility_members`, `facility_invites`,
  `checklist_items`, `compliance_tasks`, `residents`, `staff`,
  `staff_trainings`, `medications`, `mar_entries`, `incidents`, `daily_logs`,
  `ai_usage`.
- Run everything in `migrations/` (idempotent, additive) in the Supabase SQL
  editor, in filename order.
- **Never touch the shared `profiles` columns** (`plan`,
  `stripe_subscription_id`, `plan_expires_at`, `trial_ends_at`,
  `access_granted`) — they belong to other apps on the same project.

## 3. Workers (Cloudflare)

Two Workers, deployed with `wrangler deploy`:

- **`title22-ai`** — Anthropic proxy at
  `https://title22-ai.infomomtelo.workers.dev/api/chat`. Verifies the caller's
  Supabase JWT, enforces per-tier AI limits, logs to `ai_usage` with
  `app='title22'`. Secrets: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **`stripe-webhook`** — receives Stripe events (destination
  `memorable-wonder`), maps price IDs to `title22_plan` and stamps
  `title22_subscription_id` / `title22_plan_expires_at`. Secrets:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

See `workers/README.md` for the source-of-truth status of each Worker.

## 4. Email (Resend)

SMTP `smtp.resend.com:465`, sender `noreply@send.thejudgy.com`. Configure the
same SMTP settings in Supabase Auth → SMTP for auth emails.

### Password reset template (required for cross-browser resets)

In Supabase Auth → Email Templates → Reset Password, link to:

```
{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery
```

and include the line: *"For security, open this link on the device and browser
where you requested the reset if the button doesn't work."*

The token-hash flow verifies server-side, so it works from email-app webviews;
the default PKCE `?code=` flow only works in the browser that requested the
reset. The app supports both (`index.html` boot logic).
