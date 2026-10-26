// ai.js — the model caller for title22-ai, with a second rail.
//
// Why this file exists (2026-10-26): on 2026-10-24 Anthropic's billing
// stopped this Worker's only API account (auto-reload failed repeatedly,
// the balance hit $0), and every surface behind this Worker — the in-app
// Tello, Tello's own page, the signed-out assistant — answered 'Tello
// could not be reached. (HTTP 500)'. The fix is the one proven first on
// Co-Tello (2026-10-25): a second, separately-billed rail (OpenRouter)
// that takes over automatically when the failure is on the provider's
// side of the wall.
//
// Rules, the same as the Co-Tello port:
// - Anthropic stays the primary rail. OpenRouter is only called when the
//   primary fails in a way a second account can fix: billing (including
//   the 400 'credit balance is too low' and an aggregator 402), auth
//   401/403, rate limit 429, 5xx/529, or a network error.
// - A plain 400 (the request itself is wrong) is NOT retried on the
//   second rail — a second account cannot fix a bad request, and hiding
//   it would hide bugs.
// - If OPENROUTER_API_KEY is not set, behavior is exactly the old
//   single-rail behavior. AI_PROVIDER=openrouter flips the order.
// - Provider error bodies are logged server-side only. Callers decide
//   what the user sees; nothing raw from a provider reaches the page.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/messages';

// Anthropic model id -> OpenRouter model id (checked against OpenRouter's
// model list 2026-10-26). Unknown ids pass through unchanged.
const OPENROUTER_MODELS = {
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-opus-5-5': 'anthropic/claude-opus-5.5',
  'claude-opus-5': 'anthropic/claude-opus-5',
};

function rails(env) {
  const all = [
    {
      name: 'anthropic',
      url: ANTHROPIC_URL,
      key: env.ANTHROPIC_API_KEY,
      headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
      body: (body) => body,
    },
    {
      name: 'openrouter',
      url: OPENROUTER_URL,
      key: env.OPENROUTER_API_KEY,
      headers: (key) => ({ Authorization: 'Bearer ' + key, 'anthropic-version': '2023-06-01' }),
      body: (body) => {
        const b = { ...body, model: OPENROUTER_MODELS[body.model] || body.model };
        // Not carried by the fallback rail (the same trade as Co-Tello):
        // an effort hint becomes the model's default on this rail.
        delete b.output_config;
        return b;
      },
    },
  ].filter((r) => !!r.key);
  if (env.AI_PROVIDER === 'openrouter') all.reverse();
  return all;
}

function errorText(data) {
  const e = data?.error;
  return [e?.type, e?.code, e?.message, typeof e === 'string' ? e : '']
    .filter(Boolean)
    .join(' ');
}

// What kind of failure is this? Only provider-side kinds fail over.
export function categorize(status, data) {
  if (status === 402) return 'billing';
  if (status === 400 && /credit|balance|billing|payment|insufficient/i.test(errorText(data))) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500) return 'overloaded';
  if (status === 400) return 'request';
  return 'other';
}

// POSTs the Anthropic-shaped body to the first rail that answers.
// Returns { ok, status, data, rail, category } and never throws for a
// provider failure; status is 0 when the failure was the network itself.
export async function callAI(env, body) {
  const chain = rails(env);
  let last = { ok: false, status: 0, data: {}, rail: null, category: 'network' };
  for (const rail of chain) {
    let r, data;
    try {
      r = await fetch(rail.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...rail.headers(rail.key) },
        body: JSON.stringify(rail.body(body)),
      });
      data = await r.json().catch(() => ({}));
    } catch (err) {
      console.error('ai rail network', rail.name, String(err?.message || err));
      last = { ok: false, status: 0, data: {}, rail: rail.name, category: 'network' };
      continue;
    }
    if (r.ok) return { ok: true, status: r.status, data, rail: rail.name, category: null };
    const category = categorize(r.status, data);
    console.error('ai rail', rail.name, r.status, category, JSON.stringify(data).slice(0, 300));
    last = { ok: false, status: r.status, data, rail: rail.name, category };
    if (category === 'request') break; // a second account cannot fix this request
  }
  return last;
}
