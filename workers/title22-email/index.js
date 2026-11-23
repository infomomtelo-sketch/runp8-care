// title22-alerts — sends Web Push notifications for Title22 phone alerts.
//
// Endpoints (all JSON):
//   GET  /health  -> { ok: true }
//   POST /test    -> header x-alerts-key: <ALERTS_TEST_KEY>; body { user_id }
//                    Sends the fixed test alert to every subscription the
//                    user has stored. This is the proof path.
//   POST /send    -> header x-alerts-key: <ALERTS_TEST_KEY>;
//                    body { user_id, title, body, url?, tag? }
//                    The delivery path the scheduled checker will call.
//
// Subscriptions live in Supabase push_subscriptions (see the package's
// push_subscriptions.sql). This Worker reads them with the service key
// and deletes rows the push services report as gone (404/410).
//
// By product rule an alert NEVER names a resident or a medication.
// Callers pass counts and plain words only; the detail lives behind
// sign-in, in the app.
//
// Secrets (set on the Worker, never in wrangler.toml):
//   SUPABASE_SERVICE_KEY — service_role key; reads push_subscriptions
//                          for a user who is not the caller.
//   VAPID_PRIVATE_JWK    — the VAPID private key as a JWK JSON string.
//                          Its public half is T22_VAPID_PUBLIC in the
//                          app and VAPID_PUBLIC in wrangler.toml [vars];
//                          the three must stay one keypair.
//   ALERTS_TEST_KEY      — shared key gating /test and /send.

const enc = new TextEncoder();

function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// VAPID (RFC 8292): an ES256 JWT the push service can verify against
// the public key in the Authorization header.
async function buildVapidJwt(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const seg = (o) => bytesToB64u(enc.encode(JSON.stringify(o)));
  const unsigned = seg({ typ: 'JWT', alg: 'ES256' }) + '.' + seg({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:hello@title-22.com',
  });
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return unsigned + '.' + bytesToB64u(new Uint8Array(sig));
}

// Message encryption (RFC 8291 with the RFC 8188 aes128gcm encoding).
async function encryptPushPayload(uaPublicB64, authB64, plaintext) {
  const uaPublic = b64uToBytes(uaPublicB64);
  const authSecret = b64uToBytes(authB64);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, senderPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const record = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([senderPublic.length]), senderPublic, ct);
}

async function sendPush(sub, payload, env) {
  const body = await encryptPushPayload(sub.p256dh, sub.auth, JSON.stringify(payload));
  const jwt = await buildVapidJwt(sub.endpoint, env);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body,
  });
  return res.status;
}

async function listSubscriptions(env, userId) {
  const url = env.SUPABASE_URL + '/rest/v1/push_subscriptions?user_id=eq.' +
    encodeURIComponent(userId) + '&select=endpoint,p256dh,auth';
  const res = await fetch(url, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) throw new Error('subscription lookup failed');
  return res.json();
}

async function deleteSubscription(env, endpoint) {
  const url = env.SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint);
  await fetch(url, {
    method: 'DELETE',
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY },
  }).catch(() => {});
}

async function deliver(env, userId, payload) {
  const subs = await listSubscriptions(env, userId);
  const results = [];
  for (const sub of subs) {
    try {
      const status = await sendPush(sub, payload, env);
      if (status === 404 || status === 410) {
        await deleteSubscription(env, sub.endpoint);
        results.push({ status, cleaned: true });
      } else {
        results.push({ status });
      }
    } catch (e) {
      results.push({ status: 0 });
    }
  }
  return results;
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && (url.pathname === '/test' || url.pathname === '/send')) {
        if (!env.ALERTS_TEST_KEY || req.headers.get('x-alerts-key') !== env.ALERTS_TEST_KEY) {
          return json(401, { error: 'unauthorized' });
        }
        const body = await req.json().catch(() => null);
        if (!body || !body.user_id) return json(400, { error: 'user_id required' });
        let payload;
        if (url.pathname === '/test') {
          payload = { title: 'Tello', body: 'Phone alerts are on. This is your test alert.', url: '/', tag: 'title22-test' };
        } else {
          const title = typeof body.title === 'string' ? body.title.slice(0, 80) : '';
          const text = typeof body.body === 'string' ? body.body.slice(0, 240) : '';
          if (!title || !text) return json(400, { error: 'title and body required' });
          payload = {
            title,
            body: text,
            url: typeof body.url === 'string' && body.url.startsWith('/') ? body.url : '/',
            tag: typeof body.tag === 'string' && body.tag ? body.tag.slice(0, 64) : 'title22-alert',
          };
        }
        const results = await deliver(env, body.user_id, payload);
        return json(200, { sent: results.filter((r) => r.status >= 200 && r.status < 300).length, results });
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      return json(500, { error: 'alerts error' });
    }
  },
};

export { encryptPushPayload, buildVapidJwt };
