// title22-geo — address autocomplete proxy (Geoapify)
//
// Why a Worker at all: index.html has no build step, so there is nowhere to
// inject a key at deploy time — anything in the page is public. The Geoapify
// key therefore lives here as a Worker secret, exactly like ANTHROPIC_API_KEY
// on title22-ai, and the page only ever talks to this endpoint.
//
// Scope: this returns real-world street addresses so someone can pick one
// instead of typing it. It is a UX layer over the facility address field and
// nothing else. It never sees, and must never be pointed at, resident or
// medication data — no PHI is sent anywhere by this Worker.
//
// California only: Title22 is a California product (the onboarding form fixes
// the state to "CA" rather than asking), so results outside CA are dropped
// rather than shown and then rejected downstream.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function getUserFromToken(token, env) {
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token,
    }
  });
  if (!res.ok) return null;
  return await res.json();
}

// Geoapify hands back a lot per result; the page needs five strings. Anything
// without a street is a city/region match, which is not what an address field
// is asking for.
function toSuggestion(r) {
  if (!r || !r.street) return null;
  if (String(r.state_code || '').toUpperCase() !== 'CA') return null;
  const line1 = [r.housenumber, r.street].filter(Boolean).join(' ').trim();
  if (!line1) return null;
  const city = String(r.city || r.county || '').trim();
  const postcode = String(r.postcode || '').trim();
  return {
    line1,
    city,
    state: 'CA',
    postcode,
    label: [line1, [city, ['CA', postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
      .filter(Boolean).join(', '),
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Same health-check shape as title22-email: GET with no query reports
    // whether the secrets are bound, without revealing them.
    if (request.method === 'GET' && !url.searchParams.get('q')) {
      const bindings = {
        geoapify_api_key: !!env.GEOAPIFY_API_KEY,
        supabase_url: !!env.SUPABASE_URL,
        supabase_service_key: !!env.SUPABASE_SERVICE_KEY,
      };
      const ok = Object.values(bindings).every(Boolean);
      return json({ status: ok ? 'ok' : 'misconfigured', bindings }, ok ? 200 : 500);
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    try {
      // Signed-in callers only. Onboarding runs after the account exists, so
      // every legitimate use of the address field has a session; requiring one
      // keeps the free tier from being spent by anyone who finds the URL.
      const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
      const user = await getUserFromToken(token, env);
      if (!user?.id) return json({ error: 'Unauthorized' }, 401);

      const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      if (q.length < 3) return json({ suggestions: [] });

      const api = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      api.searchParams.set('text', q);
      api.searchParams.set('filter', 'countrycode:us');
      // Centre of California, so a partial street name ranks CA matches first
      // before the state filter below throws the rest away.
      api.searchParams.set('bias', 'proximity:-119.4179,36.7783');
      api.searchParams.set('limit', '8');
      api.searchParams.set('format', 'json');
      api.searchParams.set('lang', 'en');
      api.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);

      const res = await fetch(api.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return json({ error: 'Address lookup unavailable' }, 502);
      const data = await res.json().catch(() => ({}));

      const seen = new Set();
      const suggestions = [];
      for (const r of (data.results || [])) {
        const s = toSuggestion(r);
        if (!s || seen.has(s.label)) continue;
        seen.add(s.label);
        suggestions.push(s);
        if (suggestions.length >= 6) break;
      }
      return json({ suggestions });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};
