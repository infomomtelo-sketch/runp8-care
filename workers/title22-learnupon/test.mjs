// node workers/title22-learnupon/test.mjs
// Runs the real Worker against a stubbed Supabase: no network, no secret.
// Payloads are LearnUpon's documented examples, with invented learners.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import worker, { signV1, signV2, toRow, sqssoUrl, courseToEntries, pacificDate, staffLearnerEmail, splitName } from './index.js';
const T22T = createRequire(import.meta.url)('../../training-rules.js');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const SECRET = 'test-secret';
const env = { LEARNUPON_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service' };

let inserts, insertStatus = 201;
const STAFF = '11111111-2222-3333-4444-555555555555';
const OTHER_STAFF = '99999999-2222-3333-4444-555555555555';
const db = {
  staff: { [STAFF]: 'fac-1', [OTHER_STAFF]: 'fac-2' },
  facilities: { 'fac-1': 'u-owner', 'fac-2': 'someone-else' },
  members: [{ facility_id: 'fac-2', user_id: 'u-member', role: 'administrator' }],
  links: [], catalog: [], trainings: [], trainingWrites: [], trainingStatus: 201, invites: [],
};
// Sign-on stubs: token 'owner' is the partner admin, 'member' is not.
const USERS = { owner: { id: 'u-owner', email: 'Owner@Title22.example' }, member: { id: 'u-member', email: 'member@title22.example' } };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://db.example/auth/v1/user') {
    const u = USERS[(init.headers.Authorization || '').replace('Bearer ', '')];
    return u ? new Response(JSON.stringify(u), { status: 200 }) : new Response('{}', { status: 401 });
  }
  if (url.startsWith('https://db.example/rest/v1/profiles')) {
    return new Response(JSON.stringify([{ title22_is_partner_admin: url.includes('u-owner') }]), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/learnupon_events')) {
    inserts.push({ url, init, rows: JSON.parse(init.body) });
    return new Response('', { status: insertStatus });
  }
  // A tiny stand-in for the four tables the hours path reads and writes.
  const q = new URL(url).searchParams;
  if (url.startsWith('https://db.example/rest/v1/staff?')) {
    const s = db.staff[q.get('id').replace('eq.', '')];
    return new Response(JSON.stringify(s ? [{ facility_id: s }] : []), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/facilities?')) {
    const owner = db.facilities[q.get('id').replace('eq.', '')];
    return new Response(JSON.stringify(owner && owner === q.get('user_id').replace('eq.', '') ? [{ id: 1 }] : []), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/facility_members?')) {
    const hit = db.members.filter(m => m.facility_id === q.get('facility_id').replace('eq.', '')
      && m.user_id === q.get('user_id').replace('eq.', '') && m.role === q.get('role').replace('eq.', ''));
    return new Response(JSON.stringify(hit.map(() => ({ id: 1 }))), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/learnupon_staff_invites')) {
    if (init.method === 'POST') { db.invites.push({ use_count: 0, revoked_at: null, ...JSON.parse(init.body) }); return new Response('', { status: 201 }); }
    const patch = init.method === 'PATCH' ? JSON.parse(init.body) : null;
    const hits = db.invites.filter(i => (!q.get('token_hash') || i.token_hash === q.get('token_hash').replace('eq.', ''))
      && (!q.get('staff_id') || i.staff_id === q.get('staff_id').replace('eq.', ''))
      && (!q.get('revoked_at') || i.revoked_at === null));
    if (patch) { hits.forEach(i => Object.assign(i, patch)); return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(hits), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/learnupon_learner_links')) {
    if (init.method === 'POST') {
      db.links.push({ ...JSON.parse(init.body), created_at: new Date().toISOString() });
      return new Response('', { status: 201 });
    }
    const email = q.get('learner_email').replace('eq.', '');
    const before = q.get('created_at').replace('lte.', '');
    const hit = db.links.filter(l => l.learner_email === email && l.created_at <= before)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return new Response(JSON.stringify(hit ? [hit] : []), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/title22_course_catalog')) {
    const c = db.catalog.find(c => c.external_ref === q.get('external_ref').replace('eq.', ''));
    return new Response(JSON.stringify(c ? [c] : []), { status: 200 });
  }
  if (url.startsWith('https://db.example/rest/v1/staff_trainings')) {
    if (db.trainingStatus !== 201) return new Response('nope', { status: db.trainingStatus });
    db.trainingWrites.push({ url, init, rows: JSON.parse(init.body) });
    for (const r of JSON.parse(init.body)) {
      if (!db.trainings.some(t => t.source_ref === r.source_ref && t.topic_area === r.topic_area)) db.trainings.push(r);
    }
    return new Response('', { status: 201 });
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

// Sign-on (SQSSO).
{
  const SSO = { ...env, LEARNUPON_SQSSO_SECRET: 'sso-secret', LEARNUPON_PORTAL_URL: 'https://portal.example/' };
  const origin = { Origin: 'https://title22.app' };

  // The token is SHA-256 of the portal's documented message format.
  const u = new URL(sqssoUrl('https://portal.example', 'jondoe@examplelms.com', 1791308100, 'k'));
  const want = createHash('sha256').update('USER=jondoe@examplelms.com&TS=1791308100&KEY=k').digest('hex');
  ok(u.pathname === '/sqsso' && u.searchParams.get('Email') === 'jondoe@examplelms.com'
    && u.searchParams.get('TS') === '1791308100' && u.searchParams.get('SSOToken') === want, 'sqssoUrl matches the portal format');

  let r = await call('/api/learnupon/sso', { headers: { ...origin, Authorization: 'Bearer owner' }, e: SSO });
  const link = r.data.url ? new URL(r.data.url) : null;
  ok(r.status === 200 && link && link.origin === 'https://portal.example' && link.pathname === '/sqsso', 'owner gets a link on the portal');
  ok(link && link.searchParams.get('Email') === 'owner@title22.example', 'email is lowercased');
  const ts = link && Number(link.searchParams.get('TS'));
  ok(ts && Math.abs(ts - Date.now() / 1000) < 5, 'timestamp is now, in seconds');
  ok(link && link.searchParams.get('SSOToken') === createHash('sha256').update(`USER=owner@title22.example&TS=${ts}&KEY=sso-secret`).digest('hex'), 'token signs email, time and key');
  ok(!JSON.stringify(r.data).includes('sso-secret'), 'response never contains the secret');

  r = await call('/api/learnupon/sso', { headers: { ...origin, Authorization: 'Bearer member' }, e: SSO });
  ok(r.status === 403 && !r.data.url, 'non-owner refused during the test phase');
  r = await call('/api/learnupon/sso', { headers: origin, e: SSO });
  ok(r.status === 401 && !r.data.url, 'no sign-in -> 401');
  r = await call('/api/learnupon/sso', { headers: { ...origin, Authorization: 'Bearer owner' } });
  ok(r.status === 503 && !r.data.url, 'missing sign-on secret -> 503');

  const pre = await worker.fetch(new Request('https://w.example/api/learnupon/sso', { method: 'OPTIONS', headers: origin }), SSO);
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://title22.app', 'preflight allows the app');
  const evil = await worker.fetch(new Request('https://w.example/api/learnupon/sso', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), SSO);
  ok(!evil.headers.get('access-control-allow-origin'), 'preflight refuses other sites');

  const h = await call('/health', { method: 'GET' });
  ok(h.data.status === 'ok' && h.data.sso.LEARNUPON_SQSSO_SECRET === false, 'webhook health stays ok without sign-on; sso reported separately');
}

// A completion becomes training hours, only with a staff link and a catalog entry.
{
  const SSO = { ...env, LEARNUPON_SQSSO_SECRET: 'sso-secret', LEARNUPON_PORTAL_URL: 'https://portal.example' };
  const origin = { Origin: 'https://title22.app', Authorization: 'Bearer owner' };
  const completion = (o = {}) => {
    const e = {
      header: { source: 'LearnUpon', version: 1, signature: '', webhookId: 9, attempt: 1, webHookType: 'course_completion' },
      user: { userId: 5, email: 'Owner@Title22.example' },
      enrollmentId: 555, courseId: 2024, courseName: 'Eval', enrollmentStatus: 'completed', percentage: 100,
      dateCompleted: new Date(Date.now() + 1000).toISOString(), ...o,
    };
    e.header.signature = signV1(e, SECRET);
    return JSON.stringify(e);
  };

  // Sign-on for a staff member of someone else's home is refused, and links no one.
  let r = await call('/api/learnupon/sso', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: OTHER_STAFF }) });
  ok(r.status === 404 && !r.data.url && db.links.length === 0, 'sign-on for another owner\'s staff -> 404, no link');
  r = await call('/api/learnupon/sso', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: 'not-a-uuid' }) });
  ok(r.status === 404 && db.links.length === 0, 'malformed staff id -> 404');

  // No link yet: logged, no hours, and the log says why.
  r = await call('/api/learnupon/webhook', { body: completion() });
  ok(r.status === 200 && inserts[0].rows[0].training_status === 'no_staff_link' && db.trainings.length === 0, 'no sign-on link -> no hours, status no_staff_link');

  // Signed on for our own staff member: the link is written.
  r = await call('/api/learnupon/sso', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: STAFF }) });
  ok(r.status === 200 && r.data.url && db.links.length === 1 && db.links[0].staff_id === STAFF
    && db.links[0].facility_id === 'fac-1' && db.links[0].learner_email === 'owner@title22.example', 'sign-on for own staff -> link written');

  // Linked, but the course has no catalog entry: no hours invented.
  r = await call('/api/learnupon/webhook', { body: completion() });
  ok(inserts[0].rows[0].training_status === 'no_course_hours' && db.trainings.length === 0, 'no catalog entry -> no hours, status no_course_hours');

  // With a catalog entry: hours land on that staff member, in that facility.
  db.catalog.push({ id: 'c-1', external_ref: '2024', title: 'Sandbox test course: Eval', credit_hours: 1, topic_hours: {}, delivery: 'self_paced', counts_toward: 'direct_care', phase: null });
  r = await call('/api/learnupon/webhook', { body: completion() });
  const t = db.trainings[0];
  ok(r.status === 200 && inserts[0].rows[0].training_status === 'recorded' && db.trainings.length === 1, 'linked + catalogued -> recorded');
  ok(t && t.staff_id === STAFF && t.facility_id === 'fac-1' && t.hours === 1 && t.topic_area === 'other'
    && t.course_id === 'c-1' && t.source_ref === 'learnupon:555' && t.delivery === 'self_paced', 'training row: right person, home, hours, course');
  ok(db.trainingWrites[0].url.includes('on_conflict=source_ref,topic_area') && /ignore-duplicates/.test(db.trainingWrites[0].init.headers.Prefer), 'training insert dedupes');

  // A retry of the same completion does not double the hours.
  r = await call('/api/learnupon/webhook', { body: completion() });
  ok(r.status === 200 && db.trainings.length === 1, 'retried completion -> still one training row');

  // A split course makes one row per topic.
  db.catalog.push({ id: 'c-2', external_ref: '3030', title: 'Dementia basics', credit_hours: 3, topic_hours: { dementia: 2, postural_hospice: 1 }, delivery: 'self_paced', counts_toward: 'direct_care', phase: null });
  r = await call('/api/learnupon/webhook', { body: completion({ enrollmentId: 777, courseId: 3030 }) });
  const split = db.trainings.filter(x => x.source_ref === 'learnupon:777');
  ok(split.length === 2 && split.find(x => x.topic_area === 'dementia').hours === 2 && split.find(x => x.topic_area === 'postural_hospice').hours === 1, 'topic split -> one row per topic');

  // Not finished: nothing logged as hours.
  r = await call('/api/learnupon/webhook', { body: completion({ enrollmentId: 888, enrollmentStatus: 'in_progress' }) });
  ok(inserts[0].rows[0].training_status === 'not_completed' && !db.trainings.some(x => x.source_ref === 'learnupon:888'), 'unfinished enrollment -> no hours');

  // Other event types are only logged.
  const mod = JSON.parse(completion({ enrollmentId: 999 })); mod.header.webHookType = 'module_complete'; mod.header.signature = signV1(mod, SECRET);
  r = await call('/api/learnupon/webhook', { body: JSON.stringify(mod) });
  ok(r.status === 200 && inserts[0].rows[0].training_status === null && !db.trainings.some(x => x.source_ref === 'learnupon:999'), 'module event -> logged only');

  // A failed training write is a 500 (LearnUpon retries) and writes no log row yet.
  db.trainingStatus = 500;
  r = await call('/api/learnupon/webhook', { body: completion({ enrollmentId: 1001 }) });
  ok(r.status === 500 && r.data.error === 'training_write_failed' && inserts.length === 0, 'training write failure -> 500, retried later');
  db.trainingStatus = 201;

  // A completion before the sign-on link was made is not credited to it.
  r = await call('/api/learnupon/webhook', { body: completion({ enrollmentId: 1002, dateCompleted: '2020-01-01T00:00:00Z' }) });
  ok(inserts[0].rows[0].training_status === 'no_staff_link', 'completion older than the link -> not credited');

  // Same arithmetic as the app's training-rules.js.
  const c = { id: 'x', title: 'T', credit_hours: 3, topic_hours: { dementia: 2, other: 1 }, delivery: 'live', counts_toward: 'admin_ce', phase: 'phase1' };
  ok(JSON.stringify(courseToEntries(c, 's', '2026-10-06')) === JSON.stringify(T22T.courseToEntries(c, 's', '2026-10-06')), 'courseToEntries matches training-rules.js (split)');
  const c0 = { ...c, topic_hours: {} };
  ok(JSON.stringify(courseToEntries(c0, 's', '2026-10-06')) === JSON.stringify(T22T.courseToEntries(c0, 's', '2026-10-06')), 'courseToEntries matches training-rules.js (no split)');

  // The training date is the California day.
  ok(pacificDate('2026-10-07T00:30:00Z') === '2026-10-06', '5:30 pm in California on the 6th -> the 6th');
  ok(pacificDate('2026-10-06T16:56:59Z') === '2026-10-06', 'morning completion -> same day');
}

// A staff member trains from their own phone: the owner makes a link, the
// staff member opens it, and their completions land on their record.
{
  const SSO = { ...env, LEARNUPON_SQSSO_SECRET: 'sso-secret', LEARNUPON_PORTAL_URL: 'https://portal.example' };
  const origin = { Origin: 'https://title22.app', Authorization: 'Bearer owner' };
  const go = (token) => worker.fetch(new Request('https://w.example/t/' + token, { method: 'GET' }), SSO);
  db.links.length = 0;

  ok(staffLearnerEmail(STAFF) === `staff-${STAFF}@learners.title22.app`, 'learner address names the staff record, no person');
  ok(splitName(' Maria  de la Cruz ').first === 'Maria' && splitName('Maria de la Cruz').last === 'de la Cruz' && splitName(null).first === '', 'names split for the portal');

  let r = await call('/api/learnupon/staff-link', { headers: { Origin: 'https://title22.app', Authorization: 'Bearer member' }, e: SSO, body: JSON.stringify({ staff_id: STAFF }) });
  ok(r.status === 403 && !r.data.link && db.invites.length === 0, 'non-owner cannot make a staff link');
  r = await call('/api/learnupon/staff-link', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: OTHER_STAFF }) });
  ok(r.status === 404 && db.invites.length === 0, 'link for another owner\'s staff -> 404');
  r = await call('/api/learnupon/staff-link', { headers: origin, e: SSO, body: '{}' });
  ok(r.status === 404 && db.invites.length === 0, 'no staff picked -> 404');

  r = await call('/api/learnupon/staff-link', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: STAFF }) });
  const token1 = r.data.link && r.data.link.replace('https://title22.app/train/', '');
  ok(r.status === 200 && /^https:\/\/title22\.app\/train\/[A-Za-z0-9_-]{32}$/.test(r.data.link), 'owner gets a title22.app/train link');
  ok(db.invites.length === 1 && db.invites[0].token_hash === createHash('sha256').update(token1).digest('hex')
    && !JSON.stringify(db.invites).includes(token1), 'only the token\'s hash is stored');
  ok(db.links.length === 1 && db.links[0].learner_email === staffLearnerEmail(STAFF) && db.links[0].staff_id === STAFF, 'learner linked to the staff member at once');
  const days = (new Date(r.data.expires_at) - Date.now()) / 86400e3;
  ok(days > 29.9 && days <= 30, 'link lasts 30 days');

  let g = await go(token1);
  const dest = g.headers.get('location') ? new URL(g.headers.get('location')) : null;
  const ts = dest && dest.searchParams.get('TS');
  ok(g.status === 302 && dest && dest.origin === 'https://portal.example' && dest.searchParams.get('Email') === staffLearnerEmail(STAFF), 'opening the link signs on as the staff learner');
  ok(dest && dest.searchParams.get('SSOToken') === createHash('sha256').update(`USER=${staffLearnerEmail(STAFF)}&TS=${ts}&KEY=sso-secret`).digest('hex'), 'staff sign-on is signed');
  ok(g.headers.get('referrer-policy') === 'no-referrer' && db.invites[0].use_count === 1 && db.invites[0].last_used_at, 'use counted, no referrer');

  // A second link switches the first off.
  r = await call('/api/learnupon/staff-link', { headers: origin, e: SSO, body: JSON.stringify({ staff_id: STAFF }) });
  const token2 = r.data.link.replace('https://title22.app/train/', '');
  g = await go(token1);
  ok(g.status === 404 && !g.headers.get('location'), 'old link stops working when a new one is made');
  g = await go(token2);
  ok(g.status === 302, 'new link works');

  // Expired, unknown and malformed links show a plain page, never a sign-on.
  db.invites.find(i => i.token_hash === createHash('sha256').update(token2).digest('hex')).expires_at = '2020-01-01T00:00:00Z';
  g = await go(token2);
  ok(g.status === 404 && /isn't active/.test(await g.text()), 'expired link -> not active page');
  g = await go('A'.repeat(32));
  ok(g.status === 404 && !g.headers.get('location'), 'unknown link -> 404');
  g = await go('<script>');
  ok(g.status === 404 && !g.headers.get('location'), 'malformed link -> 404');
  g = await worker.fetch(new Request('https://w.example/t/' + 'B'.repeat(32), { method: 'GET' }), env);
  ok(g.status === 503 && !g.headers.get('location'), 'sign-on not configured -> 503 page');


  // Opened to customers: an administrator on a home's team sends their own
  // staff's links, and still cannot reach another home's staff.
  {
    const OPEN = { ...SSO, STAFF_LINKS_OPEN: 'true' };
    const member = { Origin: 'https://title22.app', Authorization: 'Bearer member' };
    const before = db.invites.length;
    let r2 = await call('/api/learnupon/staff-link', { headers: member, e: OPEN, body: JSON.stringify({ staff_id: OTHER_STAFF }) });
    ok(r2.status === 200 && r2.data.link && db.invites.length === before + 1, 'switch on: a home\'s administrator makes their own staff link');
    r2 = await call('/api/learnupon/staff-link', { headers: member, e: OPEN, body: JSON.stringify({ staff_id: STAFF }) });
    ok(r2.status === 404 && db.invites.length === before + 1, 'switch on: still refused for another home\'s staff');
    r2 = await call('/api/learnupon/staff-link', { headers: member, e: { ...SSO, STAFF_LINKS_OPEN: 'false' }, body: JSON.stringify({ staff_id: OTHER_STAFF }) });
    ok(r2.status === 403, 'switch off: administrator refused');
  }

  // The staff learner's completion lands on that staff member.
  const e = {
    header: { source: 'LearnUpon', version: 1, signature: '', webhookId: 9, attempt: 1, webHookType: 'course_completion' },
    user: { userId: 6, email: staffLearnerEmail(STAFF) },
    enrollmentId: 4242, courseId: 2024, courseName: 'Eval', enrollmentStatus: 'completed', percentage: 100,
    dateCompleted: new Date(Date.now() + 1000).toISOString(),
  };
  e.header.signature = signV1(e, SECRET);
  r = await call('/api/learnupon/webhook', { body: JSON.stringify(e) });
  const row = db.trainings.find(x => x.source_ref === 'learnupon:4242');
  ok(r.status === 200 && row && row.staff_id === STAFF && row.facility_id === 'fac-1', 'staff learner completion -> hours on that staff member');
}

insertStatus = 201;
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
