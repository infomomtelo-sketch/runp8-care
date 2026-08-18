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

The Supabase project is shared by multiple apps. Every `redirectTo` /
`emailRedirectTo` in this app hardcodes `https://title22.app` — **never** use
`window.location.origin`, and never omit it. Omitting it is not a no-op: the
link falls back to the project-wide Site URL, which belongs to whichever app
happens to own it, and the caregiver lands somewhere that isn't Title22. The
calls that must carry it are `signUp`, `resend` and `resetPasswordForEmail`.
If you self-host under a different domain, change those hardcoded URLs *and*
add your domain to Supabase Auth → URL Configuration → Redirect URLs.

### `flowType` must stay `implicit`

`index.html` pins `flowType:'implicit'` on the Supabase client. Do not change
it to `pkce`. PKCE keeps the `code_verifier` in the requesting browser's
localStorage, so a link opened anywhere else — which for these users means the
Gmail app's in-app webview, or their laptop when they asked from their phone —
can never be exchanged. Implicit puts the tokens in the URL fragment and works
from any browser on any device.

It is also the library default, but leaving it implied is what broke the
`?code=` boot path once already: supabase-js only treats `?code=` as a
callback when it finds a verifier it wrote itself, so the handler in
`index.html` sat behind a condition that could never be true and every such
link died with an error blaming the user's browser. The app now exchanges
`?code=` explicitly, so both shapes work.

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

The token-hash flow verifies server-side, so it works from email-app webviews
and from a different device than the one that asked. The app supports both
shapes (`index.html` boot logic), but token-hash is the one to configure.

### Confirm signup template (required if email confirmation is on)

Same reasoning, same shape. In Supabase Auth → Email Templates → Confirm
signup, link to:

```
{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=signup
```

The boot logic handles `type=signup`, `invite`, `magiclink`, `email` and
`email_change` this way; anything else falls through to a normal cold boot.
A link that fails to verify lands on the login page with a **Send it again**
control (`sb.auth.resend({type:'signup'})`), not on the password-reset form.

If email confirmation is **off** in Supabase Auth → Providers → Email, signup
returns a session immediately and goes straight to onboarding. Both paths are
supported — `handleSignup` branches on whether a session came back, never on
whether a user object came back.
