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
//   POST /check/expiring -> header x-alerts-key: <ALERTS_TEST_KEY>.
//                    Runs the slice-2 expiry sweep by hand and returns
//                    its JSON report (counts only). The same sweep runs
//                    on the cron trigger (see scheduled() below).
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

// ---------------------------------------------------------------------
// Slice 2: document-expiry sweep.
//
// Mirrors the app's own expiry computation (evaluateCompliance() in
// index.html) so the phone says the same thing the Dashboard says:
//   - The dated staff requirements are TB test, CPR, First Aid
//     (COMPLIANCE_REQUIREMENTS, app index.html ~line 4980). LiveScan,
//     mandated reporter and initial training carry no expiry date in
//     the app, so they can never appear here.
//   - A filed document decides: the NEWEST document's expires_at for
//     that staff member and type wins; with no document date, the
//     typed date on the staff row is the fallback (TB reads
//     tb_test_due first, then tb_test_expiry).
//   - CPR is scored only for RCFE/CBRC homes, not ARF (the app's
//     types filter; t22FacType() normalizes anything else to 'rcfe').
//   - Only active staff count (the app skips active === false).
// Windows: expiry == today -> kind 'expiry_today'; today < expiry <=
// today+7 -> kind 'expiry_7d'. Already-expired documents stay OUT —
// the in-app briefing covers them; this sweep is the early warning.
// "Today" is computed in America/Los_Angeles, never UTC (the app has
// a known UTC-date defect; do not repeat it). Expiry values are
// date-only strings compared as calendar dates.
// Recipients: the facility owner (facilities.user_id — the app makes
// that user 'administrator') plus facility_members whose role is
// 'administrator' or 'supervisor' (the app's management tiers: the
// DSS export gate, app index.html ~line 5221, is administrator +
// supervisor). Caregivers and read-only members never get these.
// Dedupe: alert_log rows are CLAIMED (inserted) before sending, one
// per (facility, item, kind, day); a row already present skips the
// item. Claim-before-send means a failed send loses that day's alert
// rather than ever double-sending — the safe side for an alert.
// Cap: at most ONE alert per facility per sweep run. If both windows
// have fresh items, the day-of group takes the slot (it is the more
// urgent) and the 7-day group fires on the next run.
// Fail closed: any failed read aborts that facility — no alert is
// better than a wrong or duplicated one. Counts only in payloads and
// in the report: never a staff name, never a resident, never a
// medication.

const EXPIRY_REQUIREMENTS = [
  { docType: 'tb_test', dates: ['tb_test_due', 'tb_test_expiry'] },
  { docType: 'cpr_card', dates: ['cpr_cert_expiry'], types: ['rcfe', 'cbrc'] },
  { docType: 'first_aid', dates: ['first_aid_cert_expiry'] },
];
const ADMIN_MEMBER_ROLES = ['administrator', 'supervisor'];

function facTypeOf(facility) {
  const t = facility && facility.facility_type;
  return t === 'arf' ? 'arf' : (t === 'cbrc' ? 'cbrc' : 'rcfe');
}

// Today in America/Los_Angeles as 'YYYY-MM-DD'.
function laToday(now) {
  const d = now instanceof Date ? now : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

// Pure calendar math on a 'YYYY-MM-DD' string (no timezone involved).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Stored values are date-only strings; tolerate a timestamp by
// taking its date part. Anything else is not a date we can use.
function dateOnly(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function classifyExpiry(expiry, today, in7) {
  if (!expiry) return null;
  if (expiry === today) return 'expiry_today';
  if (expiry > today && expiry <= in7) return 'expiry_7d';
  return null;
}

// One log row per expiring item. The item identity is the filed
// document's id when the expiry came from a document, else
// 'staff:<staff_id>:<doc_type>' for a typed-date-only item.
function itemKeyFor(facilityId, item) {
  return facilityId + '|' + item.identity + '|' + item.expiry;
}

// The app's evaluation, reduced to the expiring items. `docs` must
// arrive newest-first (uploaded_at desc), exactly as the app loads
// them, so the first row per (staff, type) is the one that decides.
function evaluateFacilityExpiries(staff, docs, facType, today, in7) {
  const newestDoc = {};
  for (const d of docs) {
    if (!d || !d.staff_id || !d.doc_type) continue;
    const k = d.staff_id + '|' + d.doc_type;
    if (!newestDoc[k]) newestDoc[k] = d;
  }
  const items = [];
  for (const s of staff || []) {
    if (!s || s.active === false) continue;
    for (const req of EXPIRY_REQUIREMENTS) {
      if (req.types && !req.types.includes(facType)) continue;
      const doc = newestDoc[s.id + '|' + req.docType] || null;
      const typed = req.dates.map((f) => s[f]).find(Boolean) || null;
      const expiry = dateOnly(doc && doc.expires_at) || dateOnly(typed);
      const kind = classifyExpiry(expiry, today, in7);
      if (!kind) continue;
      items.push({
        identity: doc ? String(doc.id) : 'staff:' + s.id + ':' + req.docType,
        expiry,
        kind,
      });
    }
  }
  return items;
}

async function sbGet(env, path) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) throw new Error('supabase read failed');
  return res.json();
}

async function listAdminUserIds(env, facility) {
  const ids = new Set();
  if (facility.user_id) ids.add(facility.user_id);
  const roles = encodeURIComponent('(' + ADMIN_MEMBER_ROLES.join(',') + ')');
  const members = await sbGet(env, 'facility_members?facility_id=eq.' + encodeURIComponent(facility.id) +
    '&role=in.' + roles + '&select=user_id');
  for (const m of members) if (m && m.user_id) ids.add(m.user_id);
  return [...ids];
}

async function listLoggedKeys(env, facilityId, sentOn) {
  const rows = await sbGet(env, 'alert_log?facility_id=eq.' + encodeURIComponent(facilityId) +
    '&sent_on=eq.' + sentOn + '&select=item_key,kind');
  return new Set(rows.map((r) => r.kind + '|' + r.item_key));
}

async function claimItems(env, facilityId, items, kind, sentOn) {
  const rows = items.map((it) => ({
    facility_id: facilityId, item_key: itemKeyFor(facilityId, it), kind, sent_on: sentOn,
  }));
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/alert_log', {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error('alert log claim failed');
}

function expiryPayload(kind, count) {
  const noun = count === 1 ? 'document' : 'documents';
  const body = kind === 'expiry_today'
    ? count + ' staff ' + noun + ' expires today.'
    : count + ' staff ' + noun + ' expire within 7 days.';
  return { title: 'Tello', body, url: '/', tag: 'title22-expiry' };
}

async function runExpirySweep(env, now) {
  const today = laToday(now);
  const in7 = addDays(today, 7);
  const report = {
    ok: true, date: today, window: { from: today, to: in7 },
    facilities_checked: 0, sent: [], skipped: [], errors: [],
  };
  // A failed facilities read aborts the whole sweep (throws into the
  // caller's 500 / the scheduled handler's catch). No alerts at all
  // is the correct failure for a broken read.
  const facilities = await sbGet(env, 'facilities?select=id,user_id,facility_type,is_demo&order=id&limit=1000');
  for (const facility of facilities) {
    const fid = facility.id;
    if (facility.is_demo) { report.skipped.push({ facility_id: fid, reason: 'demo facility' }); continue; }
    report.facilities_checked++;
    try {
      const [staff, docs] = await Promise.all([
        sbGet(env, 'staff?facility_id=eq.' + encodeURIComponent(fid) +
          '&select=id,active,tb_test_due,tb_test_expiry,cpr_cert_expiry,first_aid_cert_expiry&limit=1000'),
        sbGet(env, 'documents?facility_id=eq.' + encodeURIComponent(fid) +
          '&staff_id=not.is.null&select=id,staff_id,doc_type,expires_at,uploaded_at&order=uploaded_at.desc,id.asc&limit=1000'),
      ]);
      const items = evaluateFacilityExpiries(staff, docs, facTypeOf(facility), today, in7);
      const byKind = {
        expiry_today: items.filter((i) => i.kind === 'expiry_today'),
        expiry_7d: items.filter((i) => i.kind === 'expiry_7d'),
      };
      if (!byKind.expiry_today.length && !byKind.expiry_7d.length) continue;
      const logged = await listLoggedKeys(env, fid, today);
      const fresh = {
        expiry_today: byKind.expiry_today.filter((i) => !logged.has('expiry_today|' + itemKeyFor(fid, i))),
        expiry_7d: byKind.expiry_7d.filter((i) => !logged.has('expiry_7d|' + itemKeyFor(fid, i))),
      };
      const kind = fresh.expiry_today.length ? 'expiry_today' : (fresh.expiry_7d.length ? 'expiry_7d' : null);
      if (!kind) { report.skipped.push({ facility_id: fid, reason: 'already alerted today' }); continue; }
      const recipients = await listAdminUserIds(env, facility);
      if (!recipients.length) { report.skipped.push({ facility_id: fid, reason: 'no admin recipients' }); continue; }
      await claimItems(env, fid, fresh[kind], kind, today);
      let delivered = 0;
      for (const userId of recipients) {
        const results = await deliver(env, userId, expiryPayload(kind, fresh[kind].length));
        delivered += results.filter((r) => r.status >= 200 && r.status < 300).length;
      }
      report.sent.push({
        facility_id: fid, kind, items: fresh[kind].length,
        recipients: recipients.length, delivered,
      });
    } catch (e) {
      report.errors.push({ facility_id: fid, error: 'facility sweep failed' });
    }
  }
  return report;
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
      if (req.method === 'POST' && url.pathname === '/check/expiring') {
        if (!env.ALERTS_TEST_KEY || req.headers.get('x-alerts-key') !== env.ALERTS_TEST_KEY) {
          return json(401, { error: 'unauthorized' });
        }
        const report = await runExpirySweep(env, new Date());
        return json(200, report);
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

  // Cron trigger (wrangler.toml [triggers]): the daily expiry sweep.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runExpirySweep(env, new Date()).catch(() => {}));
  },
};

export {
  encryptPushPayload, buildVapidJwt,
  laToday, addDays, dateOnly, classifyExpiry, itemKeyFor, evaluateFacilityExpiries,
};
