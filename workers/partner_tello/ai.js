// ai.js — two-rail model access for Partner Tello.
//
// Why this file exists (2026-10-26): the same Anthropic billing stop that
// silenced the in-app Tello on 2026-10-24 also silenced this Worker — one
// API account was the only rail. The fix is the one proven on Co-Tello
// (2026-10-25) and ported to title22-ai: a second, separately-billed rail
// (OpenRouter) that takes over automatically when the failure is on the
// provider's side.
//
// This Worker's version speaks through the Anthropic SDK and uses the
// beta server-side fallback, so its rails are two SDK clients rather than
// two fetch URLs. The classification rules are the same as everywhere:
// billing (including the 400 'credit balance is too low' and an
// aggregator 402), auth 401/403, rate limit 429, 5xx/529 and network
// errors fail over; a plain 400 (the request itself is wrong) does not —
// a second account cannot fix a bad request.
//
// An injected client (the tests) bypasses the rails entirely and behaves
// exactly as this Worker always has. If OPENROUTER_API_KEY is not set,
// behavior is likewise unchanged.

import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Anthropic model id -> OpenRouter model id (checked against OpenRouter's
// model list 2026-10-26). Unknown ids pass through unchanged.
const OPENROUTER_MODELS = {
  'claude-opus-5-5': 'anthropic/claude-opus-5.5',
};

export function categorize(status, message) {
  const text = String(message || '');
  if (status == null) return 'network';
  if (status === 402) return 'billing';
  if (status === 400 && /credit|balance|billing|payment|insufficient/i.test(text)) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500) return 'overloaded';
  if (status === 400) return 'request';
  return 'other';
}

// What the second rail cannot carry, taken off the request: the effort
// hint (output_config), and prompt-caching marks (cache_control) — a
// slightly slower answer beats a refused one. The model id is remapped.
function stripForOpenRouter(params) {
  const p = { ...params, model: OPENROUTER_MODELS[params.model] || params.model };
  delete p.output_config;
  if (Array.isArray(p.system)) {
    p.system = p.system.map((b) => {
      if (!b || typeof b !== 'object' || !('cache_control' in b)) return b;
      const { cache_control, ...rest } = b;
      return rest;
    });
  }
  return p;
}

async function createOnAnthropic(client, params) {
  try {
    return await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
  } catch (e) {
    // If the fallback option itself is ever refused, answer without it
    // rather than not at all. (This retry predates the rails; kept.)
    if (e?.status === 400 && /fallback/i.test(e?.message || '')) return client.messages.create(params);
    throw e;
  }
}

// One model call, on the first rail that answers. Throws only when every
// configured rail has failed (or the request itself was refused); the
// caller already turns a throw into its stored, human-follow-up reply.
export async function createMessage(env, params, { client } = {}) {
  if (client) return createOnAnthropic(client, params);

  const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 45_000,
    fetch: (...a) => globalThis.fetch(...a),
  });
  try {
    return await createOnAnthropic(anthropic, params);
  } catch (e) {
    const category = categorize(e?.status, e?.message);
    if (category === 'request' || !env.OPENROUTER_API_KEY) throw e;
    console.error('partner_tello ai: anthropic rail failed', e?.status ?? 'network', category, '— failing over to openrouter');
    const openrouter = new Anthropic({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api',
      maxRetries: 1,
      timeout: 45_000,
      fetch: (...a) => globalThis.fetch(...a),
    });
    return openrouter.messages.create(stripForOpenRouter(params));
  }
}
