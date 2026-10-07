// title22-learnupon — receives LearnUpon webhooks from a training partner's sandbox portal.
//
// TEST ENDPOINT. A training partner hosts its staff courses on LearnUpon; Title22 staff will launch them by single sign-on and the
// completion comes back here. This Worker is the first half of that: it
// proves a completion can travel from the partner's sandbox portal into our database.
// Every event goes to public.learnupon_events, a log. A course completion is
// also turned into staff_trainings rows when the Worker can say who and how
// many hours without guessing (see recordTraining); otherwise the log row says
// why not, in training_status.
//
// For now this receives test data only: invented learners on the partner's
// sandbox portal. No resident information is involved, ever;
// a course completion carries a learner and a course, nothing else.
//
// Routes:
//   POST /api/learnupon/webhook   the address given to the partner for its portal
//   POST /api/learnupon/sso       signed sign-on link for the signed-in Title22 user
//   POST /api/learnupon/staff-link a link the owner texts to ONE staff member
//   GET  /t/<token>               that link, opened on the staff member's phone
//                                 (title22.app/train/<token> redirects here)
//   POST /t/<token>               "Start my training": joins the staff group
//                                 (when set up), then signs on
//   GET  /health                  yes/no for each secret, never a value
//
// LearnUpon has two webhook formats and the portal decides which it sends:
//   v2 (current): JSON body {"data":[event, ...]}, up to 10 events per POST,
//       signed with HMAC-SHA256 of the RAW body, hex, in X-Webhook-Signature.
//       Event type in X-Webhook-Type.
//   v1 (legacy):  one event per POST with a "header" object holding
//       webHookType and an MD5 "signature" = md5(<JSON without the signature
//       element> + ":" + secret). Rebuilding that JSON byte for byte depends
//       on how LearnUpon serialises it, so v1 is best effort: if real v1
//       deliveries fail the check, ask the partner to switch the portal to v2 rather
//       than loosening the check.
// Docs: https://docs.learnupon.com/webhooks/v2/ and /webhooks/
//
// Both are verified before anything is parsed or written. A bad signature is
// 401 and writes nothing. A missing secret is 503, not 200, so LearnUpon keeps
// retrying (v2 retries for 72 hours) instead of the event being lost while the
// secret is being set.
//
// node:crypto (nodejs_compat in wrangler.toml) rather than Web Crypto because
// Web Crypto has no MD5 in Node, and the test runs the real file under Node.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

// Only the app may ask for a sign-on link from a browser. The webhook needs no
// CORS: LearnUpon posts server to server.
const SSO_ORIGINS = ['https://title22.app', 'https://www.title22.app'];

function ssoCors(request) {
  const origin = request.headers.get('origin');
  if (!origin || !SSO_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// LearnUpon SQSSO ("signed query string" sign-on). The partner portal's
// Settings -> Integrations -> SQSSO page sets the format, and these are its
// values: the link is <portal>/sqsso?Email=<email>&TS=<unix seconds>&SSOToken=<t>
// where t = hex SHA-256 of "USER=<email>&TS=<ts>&KEY=<secret>". Built here, on
// the server, because the secret must never reach a browser.
export function sqssoUrl(portal, email, ts, secret) {
  const token = createHash('sha256').update(`USER=${email}&TS=${ts}&KEY=${secret}`).digest('hex');
  const base = String(portal).replace(/\/+$/, '');
  return `${base}/sqsso?Email=${encodeURIComponent(email)}&TS=${ts}&SSOToken=${token}`;
}

async function signedInUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) return null;
  return res.json();
}

// Test phase: only the app owner (profiles.title22_is_partner_admin) may sign
// on. Anyone else would be created as a learner on the partner's portal the
// moment they tapped, which nobody has agreed to yet.
async function isPartnerAdmin(userId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=title22_is_partner_admin`,
    { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY } }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return !!(rows[0] && rows[0].title22_is_partner_admin);
}

const REST = (env, path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  },
});

// The staff member the owner is signing on for must be in a facility the
// owner owns. Returns the facility id, or null.
async function ownedStaffFacility(staffId, userId, env) {
  if (!/^[0-9a-f-]{36}$/i.test(String(staffId))) return null;
  const r = await REST(env, `staff?id=eq.${staffId}&select=facility_id`);
  if (!r.ok) return null;
  const s = (await r.json())[0];
  if (!s || !s.facility_id) return null;
  const f = await REST(env, `facilities?id=eq.${s.facility_id}&user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (!f.ok) return null;
  return (await f.json()).length ? s.facility_id : null;
}

// As ownedStaffFacility, but an administrator on the home's team counts too:
// the person running the home day to day sends their staff's links.
async function adminStaffFacility(staffId, userId, env) {
  if (!/^[0-9a-f-]{36}$/i.test(String(staffId))) return null;
  const owned = await ownedStaffFacility(staffId, userId, env);
  if (owned) return owned;
  const r = await REST(env, `staff?id=eq.${staffId}&select=facility_id`);
  if (!r.ok) return null;
  const s = (await r.json())[0];
  if (!s || !s.facility_id) return null;
  const m = await REST(env, `facility_members?facility_id=eq.${s.facility_id}&user_id=eq.${encodeURIComponent(userId)}&role=eq.administrator&select=id`);
  if (!m.ok) return null;
  return (await m.json()).length ? s.facility_id : null;
}

async function handleSso(request, env) {
  const cors = ssoCors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  if (!env.LEARNUPON_SQSSO_SECRET || !env.LEARNUPON_PORTAL_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'not_configured' }, 503, cors);
  }
  const user = await signedInUser(request, env);
  if (!user || !user.id || !user.email) return json({ error: 'not_signed_in' }, 401, cors);
  if (!(await isPartnerAdmin(user.id, env))) return json({ error: 'not_allowed' }, 403, cors);

  const email = String(user.email).trim().toLowerCase();

  // Optional: the staff member these courses are for. The completion that
  // comes back for this learner is logged as that person's training hours.
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  if (body && body.staff_id) {
    const facilityId = await ownedStaffFacility(body.staff_id, user.id, env);
    if (!facilityId) return json({ error: 'staff_not_found' }, 404, cors);
    const link = await REST(env, 'learnupon_learner_links', {
      method: 'POST', headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ learner_email: email, staff_id: body.staff_id, facility_id: facilityId, linked_by: user.id }),
    });
    if (!link.ok) return json({ error: 'link_failed' }, 500, cors);
  }

  const ts = Math.floor(Date.now() / 1000);
  const url = sqssoUrl(env.LEARNUPON_PORTAL_URL, email, ts, env.LEARNUPON_SQSSO_SECRET);
  return json({ url, email }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ---- A staff member trains from their own phone -----------------------------
// The owner makes a link for one staff member and texts it; the staff member
// opens it anywhere and lands on the portal signed in as their OWN learner.
// Staff records have no email, so the learner gets an address that names the
// staff record and no one. migrations/2026-10-06b_learnupon_staff_links.sql.
const LEARNER_DOMAIN = 'learners.title22.app';
const LINK_DAYS = 30;
const APP_TRAIN_URL = 'https://title22.app/train/';

export function staffLearnerEmail(staffId) {
  return `staff-${String(staffId).toLowerCase()}@${LEARNER_DOMAIN}`;
}
const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

// "Maria de la Cruz" -> Maria / de la Cruz. Only used to name the learner on
// the portal; an empty name is fine.
export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

async function handleStaffLink(request, env) {
  const cors = ssoCors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  if (!env.LEARNUPON_SQSSO_SECRET || !env.LEARNUPON_PORTAL_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'not_configured' }, 503, cors);
  }
  const user = await signedInUser(request, env);
  if (!user || !user.id) return json({ error: 'not_signed_in' }, 401, cors);
  // Every link opened creates a learner on the partner's portal. Until the
  // partner agrees (STAFF_LINKS_OPEN = "true" in wrangler.toml, and the app's
  // T22_STAFF_TRAINING_LINKS_OPEN), only the app owner may make one. After
  // that, each home's owner and administrators send their own, with no one
  // to wait for.
  const open = String(env.STAFF_LINKS_OPEN || '').toLowerCase() === 'true';
  if (!open && !(await isPartnerAdmin(user.id, env))) return json({ error: 'not_allowed' }, 403, cors);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const staffId = body && body.staff_id;
  const facilityId = staffId ? await adminStaffFacility(staffId, user.id, env) : null;
  if (!facilityId) return json({ error: 'staff_not_found' }, 404, cors);

  const s = await REST(env, `staff?id=eq.${staffId}&select=full_name`);
  const name = splitName(s.ok ? ((await s.json())[0] || {}).full_name : '');
  const email = staffLearnerEmail(staffId);

  // One live link per staff member: a new one switches the old one off.
  const off = await REST(env, `learnupon_staff_invites?staff_id=eq.${staffId}&revoked_at=is.null`, {
    method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!off.ok) return json({ error: 'link_failed' }, 500, cors);

  const token = randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + LINK_DAYS * 86400e3).toISOString();
  const inv = await REST(env, 'learnupon_staff_invites', {
    method: 'POST', headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      token_hash: hashToken(token), expires_at: expires, staff_id: staffId, facility_id: facilityId,
      learner_email: email, first_name: name.first || null, last_name: name.last || null, created_by: user.id,
    }),
  });
  if (!inv.ok) return json({ error: 'link_failed' }, 500, cors);

  // Completions by this learner are this staff member's hours from now on.
  const link = await REST(env, 'learnupon_learner_links', {
    method: 'POST', headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ learner_email: email, staff_id: staffId, facility_id: facilityId, linked_by: user.id }),
  });
  if (!link.ok) return json({ error: 'link_failed' }, 500, cors);

  return json({ link: APP_TRAIN_URL + token, expires_at: expires }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

function page(title, text, status) {
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">`
    + `<title>${esc(title)}</title><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#1d2b2a">`
    + `<h1 style="font-size:20px">${esc(title)}</h1><p style="font-size:16px;line-height:1.5">${esc(text)}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }
  );
}

// The staff member's first stop: a Title22 page that says what happens next,
// with one button. Opening the link signs nobody on, so a text message's link
// preview cannot create a learner on the partner's portal; only the button's
// POST does. Written for any training partner: its name comes from the
// optional TRAINING_PARTNER_NAME secret, never from this public file.
async function readInvite(token, env) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { dead: true };
  if (!env.LEARNUPON_SQSSO_SECRET || !env.LEARNUPON_PORTAL_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return { down: true };
  const h = hashToken(token);
  const r = await REST(env, `learnupon_staff_invites?token_hash=eq.${h}&select=learner_email,first_name,last_name,expires_at,revoked_at,use_count`);
  if (!r.ok) return { down: true };
  const inv = (await r.json())[0];
  if (!inv || inv.revoked_at || !(new Date(inv.expires_at) > new Date())) return { dead: true };
  return { inv, h };
}

const deadPage = () => page('This link isn\'t active', 'Ask your administrator to send you a new training link.', 404);
const downPage = () => page('Training is not available right now', 'Please try again later.', 503);

export function welcomePage(token, firstName, partnerName) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const who = String(partnerName || '').trim();
  const site = who ? `${esc(who)}'s training site` : 'our training partner\'s site';
  const cert = who ? esc(who) : 'the training partner';
  const hi = String(firstName || '').trim() ? `Hi ${esc(String(firstName).trim())},` : 'Hi,';
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">`
    + `<title>Your training</title><body style="margin:0;background:#f4f7f6;font-family:system-ui,-apple-system,sans-serif;color:#1d2b2a">`
    + `<main style="max-width:440px;margin:0 auto;padding:32px 20px 40px">`
    + `<p style="font-weight:700;font-size:15px;letter-spacing:.02em;color:#2f6f63;margin:0 0 24px">Title22</p>`
    + `<h1 style="font-size:24px;margin:0 0 8px">${hi}</h1>`
    + `<p style="font-size:17px;line-height:1.5;margin:0 0 24px">Your home has set up online training for you.</p>`
    + `<ol style="font-size:16px;line-height:1.5;padding-left:22px;margin:0 0 28px">`
    + `<li style="margin-bottom:10px">Tap <b>Start my training</b>. You'll go to ${site}, already signed in.</li>`
    + `<li style="margin-bottom:10px">Finish each course all the way to the end.</li>`
    + `<li>When you finish, it shows on your training record in Title22. If a course has a certificate, it comes from ${cert}.</li>`
    + `</ol>`
    + `<form method="post" action="/t/${esc(token)}"><button type="submit" style="width:100%;min-height:56px;border:0;border-radius:12px;background:#2f6f63;color:#fff;font:inherit;font-size:18px;font-weight:600;cursor:pointer">Start my training</button></form>`
    + `<p style="font-size:14px;line-height:1.5;color:#5b6b69;margin:20px 0 0">This link is just for you, so please don't share it. Questions? Ask your administrator.</p>`
    + `</main></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } }
  );
}

async function handleStaffWelcome(token, env) {
  const r = await readInvite(token, env);
  if (r.dead) return deadPage();
  if (r.down) return downPage();
  return welcomePage(token, r.inv.first_name, env.TRAINING_PARTNER_NAME);
}

// The staff learner joins the portal's staff group before signing on, so the
// courses attached to that group are waiting when they arrive. Sign-on links
// cannot do this (LearnUpon's SQSSO has no group parameter); the portal API
// can. Off until the API key and LEARNUPON_STAFF_GROUP_ID are both set, and
// never in the way: any failure still signs the person on, without the group.
const API_TIMEOUT_MS = 4000;

export function staffGroupReady(env) {
  return !!(env.LEARNUPON_API_USERNAME && env.LEARNUPON_API_PASSWORD && env.LEARNUPON_PORTAL_URL
    && /^\d+$/.test(String(env.LEARNUPON_STAFF_GROUP_ID || '').trim()));
}

async function portalApi(env, path, init = {}) {
  const auth = Buffer.from(`${env.LEARNUPON_API_USERNAME}:${env.LEARNUPON_API_PASSWORD}`).toString('base64');
  return fetch(String(env.LEARNUPON_PORTAL_URL).replace(/\/+$/, '') + '/api/v1/' + path, {
    ...init,
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

// LearnUpon answers a user search as {"user":[...]}; accept the near shapes too.
const firstUser = (d) => [].concat((d && (d.user || d.users)) || (Array.isArray(d) ? d : []))[0] || null;

export async function joinStaffGroup(env, inv) {
  if (!staffGroupReady(env)) return { status: 'off' };
  try {
    let u = null;
    const found = await portalApi(env, 'users/search?email=' + encodeURIComponent(inv.learner_email));
    if (found.ok) u = firstUser(await found.json().catch(() => null));
    else if (found.status !== 404) return { status: 'failed', note: `user search ${found.status}` };
    if (!u || !u.id) {
      // Made here rather than by sign-on, so the name is spelled as Title22 has it.
      const made = await portalApi(env, 'users', {
        method: 'POST',
        body: JSON.stringify({ User: {
          email: inv.learner_email, first_name: inv.first_name || 'Staff', last_name: inv.last_name || 'Member',
          // Never used: this learner only ever arrives by signed sign-on.
          password: randomBytes(18).toString('base64url') + 'Aa1!',
        } }),
      });
      const d = await made.json().catch(() => null);
      u = d && (d.id ? d : d.user || firstUser(d));
      if (!made.ok || !u || !u.id) return { status: 'failed', note: `user create ${made.status}` };
    }
    const groupId = Number(String(env.LEARNUPON_STAFF_GROUP_ID).trim());
    const m = await portalApi(env, 'group_memberships', {
      method: 'POST', body: JSON.stringify({ GroupMembership: { user_id: Number(u.id), group_id: groupId } }),
    });
    if (m.ok) return { status: 'joined' };
    const text = await m.text().catch(() => '');
    if (/already/i.test(text)) return { status: 'already' };
    return { status: 'failed', note: `group membership ${m.status}` };
  } catch (err) {
    return { status: 'failed', note: String(err && err.name === 'TimeoutError' ? 'timeout' : (err && err.message) || err) };
  }
}

async function handleStaffGo(token, env) {
  const r = await readInvite(token, env);
  if (r.dead) return deadPage();
  if (r.down) return downPage();
  const { inv, h } = r;

  await REST(env, `learnupon_staff_invites?token_hash=eq.${h}`, {
    method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ last_used_at: new Date().toISOString(), use_count: (inv.use_count || 0) + 1 }),
  }).catch(() => null);

  const g = await joinStaffGroup(env, inv);
  if (g.status === 'failed') console.warn('title22-learnupon: staff group not joined:', g.note);

  const ts = Math.floor(Date.now() / 1000);
  let url = sqssoUrl(env.LEARNUPON_PORTAL_URL, inv.learner_email, ts, env.LEARNUPON_SQSSO_SECRET);
  // Names the new learner on the portal. Not part of the signed message.
  if (inv.first_name) url += '&FirstName=' + encodeURIComponent(inv.first_name);
  if (inv.last_name) url += '&LastName=' + encodeURIComponent(inv.last_name);
  return new Response(null, { status: 303, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signV2(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

// v1: the signature is computed over the body with the signature element
// removed. JSON.stringify keeps key order and is compact, which matches how
// LearnUpon's documented examples serialise.
export function signV1(parsed, secret) {
  const copy = JSON.parse(JSON.stringify(parsed));
  if (copy && copy.header) delete copy.header.signature;
  return createHash('md5').update(JSON.stringify(copy) + ':' + secret).digest('hex');
}

// Returns { version, type, events } for a verified delivery, or { error }.
export function verify(rawBody, headers, secret) {
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { return { error: 'bad_json' }; }

  const v2sig = headers.get('x-webhook-signature');
  if (v2sig) {
    if (!safeEqualHex(signV2(rawBody, secret), v2sig)) return { error: 'bad_signature' };
    const events = Array.isArray(parsed && parsed.data) ? parsed.data : [parsed];
    return { version: 2, type: headers.get('x-webhook-type') || null, events };
  }

  const v1sig = parsed && parsed.header && parsed.header.signature;
  if (v1sig) {
    if (!safeEqualHex(signV1(parsed, secret), v1sig)) return { error: 'bad_signature' };
    const { header, ...event } = parsed;
    return { version: 1, type: header.webHookType || null, events: [event] };
  }

  return { error: 'unsigned' };
}

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

// One webhook event -> one learnupon_events row. Only the fields a completion
// record needs are lifted into columns; the event itself is kept in `payload`
// so we can see exactly what LearnUpon sends while this is a test. Credits are
// a list of {name, number}; summed into credit_hours for a first look only —
// the real mapping comes from title22_course_catalog, not from this sum.
export function toRow(event, { version, type, deliveryId }) {
  const user = (event && event.user) || {
    userId: event && event.userId, username: event && event.username,
    email: event && (event.userEmail || event.email),
  };
  const credits = Array.isArray(event && event.credits) ? event.credits : [];
  const creditSum = credits.reduce((n, c) => n + (num(c && c.number) || 0), 0);
  return {
    delivery_id: str(deliveryId),
    webhook_version: version,
    webhook_type: str(type),
    enrollment_id: num(event && event.enrollmentId),
    course_id: num(event && event.courseId),
    course_name: str(event && event.courseName),
    course_reference_code: str(event && event.courseReferenceCode),
    learner_id: num(user.userId),
    learner_username: str(user.username),
    learner_email: user.email ? String(user.email).trim().toLowerCase() : null,
    status: str(event && event.enrollmentStatus),
    percentage: num(event && event.percentage),
    credit_hours: credits.length ? creditSum : null,
    completed_at: str(event && event.dateCompleted),
    // Filled in for course completions; every row carries the keys because
    // PostgREST refuses a bulk insert whose rows have different keys.
    training_status: null,
    training_note: null,
    payload: event,
  };
}

// --- Completion -> training hours -----------------------------------------

export const isCourseCompletion = (row) => /course_?completion/i.test(row.webhook_type || '');
const DONE = new Set(['completed', 'passed']);

// The day the course was finished, in California, not UTC: a completion at
// 5 pm on the 6th is 00:00 UTC on the 7th.
export function pacificDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Same result as courseToEntries in training-rules.js (test.mjs checks they
// agree): one row per topic in the course's split, or one "other" row.
export function courseToEntries(course, staffId, date) {
  const split = (course && course.topic_hours) || {};
  const keys = Object.keys(split).filter(k => (parseFloat(split[k]) || 0) > 0);
  const base = { staff_id: staffId, training_date: date, course_id: course.id || null,
    delivery: course.delivery || null, counts_toward: course.counts_toward || 'direct_care', phase: course.phase || null };
  if (!keys.length) return [Object.assign({}, base, { topic: course.title, hours: course.credit_hours, topic_area: 'other', hands_on: false })];
  return keys.map(k => Object.assign({}, base, { topic: course.title, hours: parseFloat(split[k]), topic_area: k, hands_on: false }));
}

// Decides, and writes, the training rows for one completion. Returns
// { status, note } for the log row, or { error } when a write failed and
// LearnUpon should retry.
export async function recordTraining(env, row) {
  if (!DONE.has(String(row.status || '').toLowerCase())) return { status: 'not_completed', note: `status ${row.status || 'missing'}` };
  if (!row.learner_email || !row.course_id || !row.enrollment_id || !row.completed_at) {
    return { status: 'no_staff_link', note: 'completion is missing the learner, course, enrollment or date' };
  }

  const links = await REST(env, `learnupon_learner_links?learner_email=eq.${encodeURIComponent(row.learner_email)}`
    + `&created_at=lte.${encodeURIComponent(new Date(row.completed_at).toISOString())}`
    + '&select=staff_id,facility_id&order=created_at.desc&limit=1');
  if (!links.ok) return { error: 'link_lookup_failed' };
  const link = (await links.json())[0];
  if (!link) return { status: 'no_staff_link', note: 'no one signed on from Title22 as this learner before the completion' };

  const cat = await REST(env, `title22_course_catalog?external_ref=eq.${encodeURIComponent(String(row.course_id))}`
    + '&select=id,title,credit_hours,topic_hours,delivery,counts_toward,phase&limit=1');
  if (!cat.ok) return { error: 'catalog_lookup_failed' };
  const course = (await cat.json())[0];
  if (!course) return { status: 'no_course_hours', note: `course ${row.course_id} has no catalog entry, so no hours were logged` };

  const date = pacificDate(row.completed_at);
  const entries = courseToEntries(course, link.staff_id, date).map(e => ({
    ...e,
    facility_id: link.facility_id,
    hours: Number(e.hours),
    notes: 'Completed on the training partner\'s course portal.',
    source_ref: `learnupon:${row.enrollment_id}`,
  }));
  const ins = await REST(env, 'staff_trainings?on_conflict=source_ref,topic_area', {
    method: 'POST', headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(entries),
  });
  if (!ins.ok) {
    console.error('staff_trainings insert failed', ins.status, await ins.text().catch(() => ''));
    return { error: 'training_write_failed' };
  }
  const hours = entries.reduce((n, e) => n + e.hours, 0);
  return { status: 'recorded', note: `${hours} h on ${date}` };
}

async function insertRows(env, rows) {
  // Dedupe on (enrollment_id, completed_at, webhook_type): LearnUpon retries a
  // delivery it thinks failed, and a retry must not log a second completion.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/learnupon_events?on_conflict=enrollment_id,completed_at,webhook_type`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    console.error('learnupon_events insert failed', res.status, await res.text().catch(() => ''));
  }
  return res.ok;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        status: env.LEARNUPON_WEBHOOK_SECRET && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? 'ok' : 'missing_config',
        config: {
          LEARNUPON_WEBHOOK_SECRET: !!env.LEARNUPON_WEBHOOK_SECRET,
          SUPABASE_URL: !!env.SUPABASE_URL,
          SUPABASE_SERVICE_KEY: !!env.SUPABASE_SERVICE_KEY,
        },
        accepts: ['v1', 'v2'],
        // Sign-on is separate: the webhook works without it.
        sso: {
          LEARNUPON_SQSSO_SECRET: !!env.LEARNUPON_SQSSO_SECRET,
          LEARNUPON_PORTAL_URL: !!env.LEARNUPON_PORTAL_URL,
        },
        // Staff join the portal's staff group before signing on.
        staff_group: {
          LEARNUPON_API_USERNAME: !!env.LEARNUPON_API_USERNAME,
          LEARNUPON_API_PASSWORD: !!env.LEARNUPON_API_PASSWORD,
          LEARNUPON_STAFF_GROUP_ID: !!String(env.LEARNUPON_STAFF_GROUP_ID || '').trim(),
          ready: staffGroupReady(env),
        },
      });
    }

    if (url.pathname === '/api/learnupon/sso') return handleSso(request, env);
    if (url.pathname === '/api/learnupon/staff-link') return handleStaffLink(request, env);
    if (url.pathname.startsWith('/t/')) {
      const token = url.pathname.slice(3);
      if (request.method === 'GET') return handleStaffWelcome(token, env);
      if (request.method === 'POST') return handleStaffGo(token, env);
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (url.pathname !== '/api/learnupon/webhook') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    if (!env.LEARNUPON_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      console.error('title22-learnupon: a secret is missing; answering 503 so LearnUpon retries');
      return json({ error: 'not_configured' }, 503);
    }

    const raw = await request.text();
    const v = verify(raw, request.headers, env.LEARNUPON_WEBHOOK_SECRET);
    if (v.error) {
      console.warn('title22-learnupon: refused delivery:', v.error);
      return json({ error: v.error }, v.error === 'bad_json' ? 400 : 401);
    }

    const deliveryId = request.headers.get('x-webhook-id');
    const rows = v.events.filter(Boolean).map((e) => toRow(e, { version: v.version, type: v.type, deliveryId }));
    if (!rows.length) return json({ ok: true, stored: 0 });

    // Completions first, so the log row can say what happened. A failed
    // training write is 500 and LearnUpon retries; source_ref makes the retry
    // safe, and the log row is not written until the outcome is known.
    for (const row of rows) {
      if (!isCourseCompletion(row)) continue;
      const t = await recordTraining(env, row);
      if (t.error) return json({ error: t.error }, 500);
      row.training_status = t.status;
      row.training_note = t.note;
    }

    // 500 on a failed write, so LearnUpon retries rather than the completion
    // vanishing; the dedupe key makes the retry safe.
    if (!(await insertRows(env, rows))) return json({ error: 'store_failed' }, 500);
    return json({ ok: true, stored: rows.length, training: rows.filter(isCourseCompletion).map(r => r.training_status) });
  },
};
