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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
      });
    }

    if (url.pathname === '/api/learnupon/sso') return handleSso(request, env);

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
