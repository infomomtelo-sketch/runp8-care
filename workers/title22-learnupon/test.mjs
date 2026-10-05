// node workers/title22-learnupon/test.mjs
// Runs the real Worker against a stubbed Supabase: no network, no secret.
// Payloads are LearnUpon's documented examples, with invented learners.
import worker, { signV1, signV2, toRow } from './index.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const SECRET = 'test-secret';
const env = { LEARNUPON_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service' };

let inserts, insertStatus = 201;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://db.example/rest/v1/learnupon_events')) {
    inserts.push({ url, init, rows: JSON.parse(init.body) });
    return new Response('', { status: insertStatus });
  }
  return new Response('unexpected ' + url, { status: 500 });
};

async function call(path, { method = 'POST', body = '', headers = {}, e = env } = {}) {
  inserts = [];
  const r = await worker.fetch(new Request('https://w.example' + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : body,
  }), e);
  return { status: r.status, data: await r.json() };
}

const v2Body = JSON.stringify({
  data: [{
    courseId: 2587200, enrollmentId: 17906600, courseReferenceCode: null,
    dateEnrolled: '2026-10-05T20:45:41.000Z', dateStarted: '2026-10-05T20:47:42.000Z',
    dateCompleted: '2026-10-05T21:00:00.000Z', enrollmentStatus: 'passed', percentage: 100,
    user: { userId: 291162, username: null, email: 'Test.Learner@Title22.example' },
    credits: [{ name: 'hours', number: '1.0' }, { name: 'dementia', number: '0.5' }],
    modules: [{ id: 1, name: 'Intro', type: 'page', status: 'completed' }],
    eventCreated: '2026-10-05T21:00:03.000Z',
  }],
});
const v2Headers = (body, secret = SECRET) => ({
  'X-Webhook-Signature': signV2(body, secret), 'X-Webhook-Type': 'course_completion', 'X-Webhook-ID': 'd-1',
});

// Health never shows a value.
{
  const r = await call('/health', { method: 'GET' });
  ok(r.status === 200 && r.data.status === 'ok', 'health ok when all three are set');
  ok(!JSON.stringify(r.data).includes(SECRET), 'health does not echo the secret');
  const m = await call('/health', { method: 'GET', e: { ...env, LEARNUPON_WEBHOOK_SECRET: '' } });
  ok(m.data.status === 'missing_config' && m.data.config.LEARNUPON_WEBHOOK_SECRET === false, 'health names the missing secret');
}

// v2: a correctly signed completion is stored, with the learner email folded.
{
  const r = await call('/api/learnupon/webhook', { body: v2Body, headers: v2Headers(v2Body) });
  ok(r.status === 200 && r.data.stored === 1, 'v2 signed completion -> 200, one row');
  const row = inserts[0] && inserts[0].rows[0];
  ok(row && row.enrollment_id === 17906600 && row.course_id === 2587200, 'v2 row carries enrollment and course');
  ok(row && row.learner_email === 'test.learner@title22.example', 'v2 learner email lower-cased');
  ok(row && row.status === 'passed' && row.percentage === 100, 'v2 status and score');
  ok(row && row.credit_hours === 1.5, 'v2 credits summed');
  ok(row && row.webhook_version === 2 && row.webhook_type === 'course_completion' && row.delivery_id === 'd-1', 'v2 delivery metadata');
  ok(inserts[0].url.includes('on_conflict=enrollment_id,completed_at,webhook_type'), 'insert dedupes on retry');
  ok(/ignore-duplicates/.test(inserts[0].init.headers.Prefer), 'duplicates ignored, not errors');
}

// Refusals write nothing.
{
  let r = await call('/api/learnupon/webhook', { body: v2Body, headers: v2Headers(v2Body, 'wrong') });
  ok(r.status === 401 && inserts.length === 0, 'v2 wrong secret -> 401, nothing written');
  const tampered = v2Body.replace('"passed"', '"failed"');
  r = await call('/api/learnupon/webhook', { body: tampered, headers: v2Headers(v2Body) });
  ok(r.status === 401 && inserts.length === 0, 'v2 body changed after signing -> 401');
  r = await call('/api/learnupon/webhook', { body: v2Body });
  ok(r.status === 401 && r.data.error === 'unsigned' && inserts.length === 0, 'unsigned -> 401');
  r = await call('/api/learnupon/webhook', { body: '{nope', headers: { 'X-Webhook-Signature': 'x' } });
  ok(r.status === 400 && inserts.length === 0, 'bad JSON -> 400');
  r = await call('/api/learnupon/webhook', { body: v2Body, headers: v2Headers(v2Body), e: { ...env, LEARNUPON_WEBHOOK_SECRET: undefined } });
  ok(r.status === 503 && inserts.length === 0, 'no secret set -> 503 so LearnUpon retries');
  r = await call('/api/learnupon/webhook', { method: 'GET' });
  ok(r.status === 405, 'GET on the webhook -> 405');
  r = await call('/elsewhere', { body: v2Body, headers: v2Headers(v2Body) });
  ok(r.status === 404, 'other paths -> 404');
}

// A failed write is a 500, so LearnUpon retries instead of losing it.
{
  insertStatus = 500;
  const r = await call('/api/learnupon/webhook', { body: v2Body, headers: v2Headers(v2Body) });
  ok(r.status === 500 && r.data.error === 'store_failed', 'store failure -> 500');
  insertStatus = 201;
}

// v1: MD5 over the body without its signature, plus ":" + secret.
{
  const v1 = {
    header: { source: 'LearnUpon', version: 1, signature: '', webhookId: 1234, attempt: 1, webHookType: 'course_completion' },
    user: { userId: 12, lastName: 'Learner', firstName: 'Test', email: 'test@title22.example', username: 'test.learner' },
    enrollmentId: 12345, courseId: 678, courseName: 'Caregiving 101', courseReferenceCode: 'XYZ123',
    credits: [{ name: 'cpd', number: '2.0' }], enrollmentStatus: 'passed', percentage: 95,
    dateCompleted: '2026-10-05T15:30:09Z',
  };
  v1.header.signature = signV1(v1, SECRET);
  const body = JSON.stringify(v1);
  let r = await call('/api/learnupon/webhook', { body });
  ok(r.status === 200 && r.data.stored === 1, 'v1 signed completion -> 200, one row');
  const row = inserts[0] && inserts[0].rows[0];
  ok(row && row.webhook_version === 1 && row.webhook_type === 'course_completion', 'v1 type read from header');
  ok(row && row.course_name === 'Caregiving 101' && row.credit_hours === 2, 'v1 course and credits');
  ok(row && !('header' in row.payload), 'v1 payload stored without the signed header');
  r = await call('/api/learnupon/webhook', { body: body.replace('"passed"', '"failed"') });
  ok(r.status === 401 && inserts.length === 0, 'v1 tampered -> 401');
}

// toRow never throws on a sparse event.
{
  const row = toRow({}, { version: 2, type: null, deliveryId: null });
  ok(row.enrollment_id === null && row.learner_email === null && row.credit_hours === null, 'sparse event -> nulls, no throw');
}

insertStatus = 201;
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
