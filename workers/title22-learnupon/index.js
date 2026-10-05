// title22-learnupon — receives LearnUpon webhooks from a training partner's sandbox portal.
//
// TEST ENDPOINT. A training partner hosts its staff courses on LearnUpon; Title22 staff will launch them by single sign-on and the
// completion comes back here. This Worker is the first half of that: it
// proves a completion can travel from the partner's sandbox portal into our database.
// It writes ONLY to public.learnupon_events, a log, and never to
// staff_trainings — turning a completion into training hours is the next step,
// once we have seen real payloads and agreed the course-to-hours mapping.
//
// For now this receives test data only: invented learners on the partner's
// sandbox portal. No resident information is involved, ever;
// a course completion carries a learner and a course, nothing else.
//
// Routes:
//   POST /api/learnupon/webhook   the address given to the partner for its portal
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
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
  const user = (event && event.user) || {};
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
    payload: event,
  };
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
      });
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

    // 500 on a failed write, so LearnUpon retries rather than the completion
    // vanishing; the dedupe key makes the retry safe.
    if (!(await insertRows(env, rows))) return json({ error: 'store_failed' }, 500);
    return json({ ok: true, stored: rows.length });
  },
};
