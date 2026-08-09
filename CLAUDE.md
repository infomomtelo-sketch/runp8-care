# Title22 (runp8-care)

Compliance software for California RCFEs — residential care facilities for the elderly.
Live at **title22.app**. Real facilities keep real resident records here; a caregiver
in a real inspection is the person on the other end of every change.

Read this before touching anything. Most of it is the result of something going wrong.

---

## Shape of the project

| | |
|---|---|
| Frontend | **One file**: `index.html`. ~4000 lines, inline `<style>` and `<script>`, no build step, no framework. Deploys to Cloudflare Pages on push to `main`. |
| Data | Supabase (Postgres + Auth + Storage). Client talks to it directly via `sb` (supabase-js, vendored in `/vendor`). |
| Workers | `workers/*/index.js` — Cloudflare Workers holding anything that needs a secret. |
| Migrations | `migrations/*.sql`, applied **by hand** in the Supabase SQL editor. Nothing runs them automatically. |

Because the frontend is a single script, **a duplicate top-level `function` name silently
overrides the earlier one and a duplicate `const` is a SyntaxError that breaks the whole
app**. Before committing a large addition:

```sh
python3 -c "import re;s=open('index.html').read();open('/tmp/m.js','w').write(re.findall(r'<script>(.*?)</script>',s,re.S)[-1])"
node --check /tmp/m.js
grep -oE '^(async )?function [a-zA-Z0-9_]+' /tmp/m.js | sed 's/.*function //' | sort | uniq -d
```

---

## Traps that have already cost real time

### Workers do NOT deploy from GitHub

Merging a PR that changes `workers/**` changes **nothing** in production. Each Worker
runs code pasted into the Cloudflare dashboard. After merging, the file has to be
re-pasted by hand and deployed. Say so explicitly every time, or the user will merge and
reasonably assume it shipped.

### The extract Worker is named `mission-control`

Cloudflare auto-generated that name at creation, and **Workers cannot be renamed**. The
source lives in `workers/title22-extract/`, but `wrangler.toml` says
`name = "mission-control"` and must keep saying it — `wrangler deploy` targets whatever
is named there, so "fixing" it to match the directory creates a second, empty Worker and
orphans the live one.

Public URL: `https://mission-control.infomomtelo.workers.dev/` — a GET returns a health
check reporting which bindings are set (booleans only, never values).

### `SUPABASE_SERVICE_KEY`, not `SUPABASE_SERVICE_ROLE_KEY`

The Workers read the shorter name; `.env.example` documents the value under the longer
one. Getting this wrong makes every request 401 with nothing in the logs to explain it.

### A health check must be able to fail

The original returned `{"status":"ok"}` before reading a single secret, so it passed
while the Worker was misconfigured — and sent everyone hunting in the wrong place for
hours. Any check you add must actually exercise what it claims to verify.

### Structured outputs have a grammar size limit

`output_config.format` compiles the JSON schema into a grammar with a hard ceiling.
Declaring one named property per field, each holding a nested object, blew it at 16
fields — **every scan failed before the model ever saw the image**, with
`The compiled grammar is too large`. The schema is now a list of uniform entries with
`key` as an enum, so the entry shape is declared once. Keep it that way; put field
descriptions in the system prompt, where they cost the grammar nothing.

### `public.documents` was created outside this repo

It is not in `migrations/`, so its RLS policies and constraints aren't visible here.
Assume facility-scoped policies (the client-side upload path implies it), but verify in
Supabase before relying on it.

---

## Rules that are not negotiable

**Nothing AI-extracted saves itself.** Scan to fill puts values into a form and stops.
The existing Save button, and the audit-log triggers behind it, remain the only path to
the database. Two deliberate human gates between a photo and a compliance record. Do not
add a shortcut past them.

**Low-confidence reads and overwrites are unticked by default.** A caregiver has to
accept them on purpose.

**`workers/title22-extract/index.js` and `SCAN_FIELD_MAP` in `index.html` are one
contract.** Same field keys, and every `el` in the map must be a real input id. A key
with no mapping has nowhere to go. Check both sides when adding a field.

**Resident scanning is disabled pending a HIPAA BAA.** Face sheets are PHI. The button
is commented out with a marker; re-enabling is deleting two comment wrappers. Do not
re-enable it without the user confirming a BAA exists.

**Never claim the app is secure or HIPAA-compliant in UI copy.** Photos are sent to a
third-party AI service, and photos taken on a phone stay in the camera roll. Say what
actually happens.

---

## The most important open problem

**Compliance status is self-reported, and the score counts it.**

`residents.lic601 / lic602 / isp` and `staff.livescan_cleared /
mandated_reporter_completed / initial_training_complete` are yes/no values a human types.
Expiry tracking (`cpr_cert_expiry`, `tb_test_due`, `first_aid_cert_expiry`,
`isp_review_date`) is likewise typed. Nothing checks them against a document.

**A facility can mark everything Yes, score 100% green, and have nothing on file.** In a
product whose entire purpose is telling you whether you'd survive an inspection, this is
the most serious thing in the codebase.

Agreed direction: derive from filed documents, keep the typed value, and show anything
unverified rather than silently overwriting. `documents` already stores files; the scan
path now files them. Next step is `documents.issued_at` / `expires_at` populated from the
scan, with badges and alerts reading the newest filed document and falling back to the
typed column.

---

## Working with this user

- **They work from a phone.** They have no local clone, no Node, no `wrangler`. Anything
  requiring a terminal on their machine will not happen — use the Cloudflare and Supabase
  dashboards, and the GitHub web UI.
- **Do not push without being asked.** `main` auto-deploys to the live site.
- **Their messages are often truncated mid-sentence.** If one cuts off, say so and ask,
  rather than guessing at the ending.
- **Give one action at a time.** Multi-line command blocks get pasted whole, which breaks
  anything that prompts for input.
- **Say plainly when something is a hypothesis.** Several hours went into a latency theory
  that was wrong; the actual error was in a screenshot the whole time. Ask for the error
  text early.

---

## Verifying without access

This container cannot reach `title22.app` or `*.workers.dev` — the egress proxy 403s both.
Do not conclude a Worker is down from a failed curl here; it proves nothing.

What does work: serve the repo locally and drive it in Chromium.

```sh
npx --yes http-server -p 8099 -s . &     # file:// breaks absolute /vendor paths
# then Playwright at http://127.0.0.1:8099/index.html
```

Stubbing `window.fetch` and `sb` makes the scan and save paths fully testable offline.
This is how the "cancelled scan attaches its document to the next record saved" bug was
caught before it shipped — worth doing for anything touching shared state.
