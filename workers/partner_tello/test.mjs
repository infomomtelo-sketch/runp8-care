// Partner Tello: node test.mjs. No network: fetch is replaced with an
// in-memory stand-in for the partner_tello_* database functions, Resend and
// the Anthropic API. The SQL itself is tested against Postgres separately (see
// the PR); this checks the Worker's behaviour around it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createHandler, healthReasons, fixedReply, cleanReply, buildEmail, subjectFor, retryUnsent, timing,
  T22_PHI_RULES, GREETING, FOOTER, REAL_PERSON, WHO_RUNS, DONT_GUESS, TERMS, DIRECT_SENT, INACTIVE, REMOVED,
  HEALTH_WARNING, NO_DOSAGE, LIMITS, REQUIRED_BINDINGS,
} from './app.js';

timing.backoff = [1, 1];
const here = (f) => new URL(f, import.meta.url);
const prompt = readFileSync(here('./prompt.md'), 'utf8');
const knowledge = readFileSync(here('./knowledge.md'), 'utf8');
const indexHtml = readFileSync(here('../../index.html'), 'utf8');
const migration = readFileSync(here('../../migrations/2026-10-01_partner_tello.sql'), 'utf8');
let passed = 0;
const ok = (label) => { passed++; console.log('ok  ' + label); };

// ---------------------------------------------------------------- fakes --
const SECRET = 'd'.repeat(64);
const KEY = 'k'.repeat(32);
const OFF_KEY = 'o'.repeat(32);
const CONV = '11111111-2222-4333-8444-555555555555';
let db, anthropic, resend, script, resendScript, dbDown;

function reset() {
  db = {
    links: [
      { key: KEY, name: 'Test Partner', org: 'Sample Training Co.', brief: 'Sample row for testing.', active: true },
      { key: OFF_KEY, name: 'Old Link', org: null, brief: null, active: false },
      { key: 'charise-k7q2xm', name: 'Charise', org: 'Title22', brief: null, active: true },
    ],
    messages: [], usage: {}, config: { notify_to: 'team@example.test', email_from: 'Tello <noreply@example.test>' },
  };
  anthropic = []; resend = []; script = []; resendScript = []; dbDown = new Set();
}
const env = {
  SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'sk-test',
  RESEND_API_KEY: 're_test', PARTNER_TELLO_DB_SECRET: SECRET,
};
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (t, extra = {}) => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 1 }, ...extra });

const active = (k) => db.links.find((l) => l.key === k && l.active);
const rpcs = {
  partner_tello_open: (a) => (active(a.p_key) ? [{ name: active(a.p_key).name, org: active(a.p_key).org, brief: active(a.p_key).brief }] : []),
  partner_tello_take: (a) => { if (!active(a.p_key)) return null; db.usage[a.p_key] = (db.usage[a.p_key] || 0) + 1; return a.p_limit - db.usage[a.p_key]; },
  partner_tello_log: (a) => {
    if (!active(a.p_key)) throw Object.assign(new Error('inactive link'), { status: 403 });
    if (!['user', 'tello', 'direct'].includes(a.p_role)) throw Object.assign(new Error('role'), { status: 400 });
    const id = db.messages.length + 1;
    db.messages.push({ id, link_key: a.p_key, conversation_id: a.p_conversation_id, role: a.p_role, text: a.p_text,
      created_at: new Date().toISOString(), email_status: ['user', 'direct'].includes(a.p_role) ? 'pending' : null, email_attempts: 0 });
    return id;
  },
  partner_tello_history: (a) => {
    const conv = db.messages.filter((m) => m.link_key === a.p_key && m.conversation_id === a.p_conversation_id);
    if (a.p_upto == null) return conv;
    const next = conv.find((m) => m.id > a.p_upto);
    return conv.filter((m) => m.id <= a.p_upto || (next && m === next && m.role === 'tello'));
  },
  partner_tello_mark_email: (a) => { const m = db.messages.find((x) => x.id === a.p_id); m.email_attempts++; m.email_status = a.p_ok ? 'sent' : 'failed'; m.email_error = a.p_ok ? null : a.p_error; return null; },
  partner_tello_unsent: () => db.messages.filter((m) => ['pending', 'failed'].includes(m.email_status) && m.email_attempts < 8)
    .map((m) => ({ ...m, ...(({ name, org }) => ({ name, org }))(db.links.find((l) => l.key === m.link_key)) })),
  partner_tello_mail_config: () => [db.config],
};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = new Headers(init.headers);
  let m;
  if ((m = url.match(/^https:\/\/db\.example\.test\/rest\/v1\/rpc\/(\w+)$/))) {
    assert.equal(headers.get('apikey'), 'anon', 'the Worker uses the anon key, never a service key');
    if (body.p_secret !== SECRET) return res({ message: 'forbidden' }, 403);
    if (dbDown.has(m[1])) return res({ message: 'down' }, 503);
    try { return res(rpcs[m[1]](body)); } catch (e) { return res({ message: e.message }, e.status || 400); }
  }
  if (url === 'https://api.resend.com/emails') {
    resend.push({ body, headers });
    const next = resendScript.shift();
    if (next) return next;
    return res({ id: 're_' + resend.length });
  }
  if (url.startsWith('https://api.anthropic.com/v1/messages')) {
    anthropic.push({ url, body, headers });
    const next = script.shift();
    if (next instanceof Response) return next;
    if (next instanceof Error) throw next;
    return res(next || text('Fine.'));
  }
  throw new Error('unexpected fetch ' + url);
};

const handler = createHandler({ system: `${prompt}\n\n${knowledge}` });
async function call(path, body, method = 'POST', e = env) {
  const waits = [];
  const req = new Request('https://partner-tello.example.test' + path, method === 'GET' ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const r = await handler.fetch(req, e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: r.status, body: await r.json() };
}
const chat = (message, extra = {}) => call('/api/partner_tello/chat', { k: KEY, conversation_id: CONV, message, ...extra });

// ------------------------------------------------- the fixed wording --
assert.equal(GREETING, "Hi, I'm Tello, Title22's AI assistant. Every message you send here is passed to the Title22 team, so nothing gets lost. I can answer questions about Title22 anytime. For anything about terms, pricing or commitments, a person from our team will reply personally.");
assert.equal(FOOTER, 'Tello is an AI. All messages are sent to the Title22 team.');
assert.equal(REAL_PERSON, "No, I'm an AI assistant. Everything you write here goes to the Title22 team, and a person will reply personally.");
assert.equal(WHO_RUNS, 'Title22 is based in California. A person from the team can tell you more.');
assert.equal(DONT_GUESS, "I don't want to guess on that. I've passed your question to the Title22 team.");
assert.equal(DIRECT_SENT, 'Sent to the Title22 team. A person will reply personally.');
assert.equal(INACTIVE, "This link isn't active. Please contact hello@title-22.com.");
assert.equal(REMOVED, '[removed: possible health information]');
ok('disclosure, greeting, footer and fixed replies are word for word the owner\'s');

// ------------------------------------------- the app's identifier check --
{
  const src = indexHtml.match(/const T22_PHI_RULES = \[([\s\S]*?)\n\];/)[1];
  const appRules = [...src.matchAll(/kind:'([^']+)',\s*re:(\/.*\/[a-z]*)\}/g)].map((x) => [x[1], x[2]]);
  assert.equal(appRules.length, 6);
  assert.deepEqual(T22_PHI_RULES.map((r) => [r.kind, String(r.re)]), appRules, 'the identifier rules are the app\'s, byte for byte');
  ok('identifier rules match index.html T22_PHI_RULES exactly (6 rules)');
}

{
  const SAMPLES = ['What does Title22 track?', 'What does Title22 NOT hold?', 'Do you support ARF?',
    'Does medication training change with home size?', 'How does the trainer program work?', 'Can training courses run inside Title22?'];
  const CLEAN = [...SAMPLES, 'Are you a real person?', 'What revenue split would you accept?', 'Can SCORM be ready by November?',
    "Show me Maria's CPR date", 'Who is behind Title22?', 'How do I log hands-on training for a new hire?',
    'Do you track dementia training for staff who care for residents with dementia?',
    'How many hours of medication training does a caregiver need in a home with 20 residents?',
    'Our clients are RCFE administrators who take a 40-hour course.', 'Can residents have visitors on Sunday?',
    'Fire Drill logs and the LIC 624 for a fall, without names?'];
  for (const q of CLEAN) assert.deepEqual(healthReasons(q), [], 'not health information: ' + q);
  const FLAG = [
    'Our resident Maria Lopez was diagnosed with dementia last week, what should we log?',
    'My mother has diabetes and takes insulin, can Title22 track that?',
    'The resident in room 4 is on insulin 10 units at night',
    'Mrs. Gomez fell yesterday and was hospitalized',
    'Her date of birth is 03/04/1941',
    'SSN 123-45-6789',
    'Medicare number 1EG4-TE5-MK73',
    'MRN 448812 for the patient',
  ];
  for (const q of FLAG) assert.ok(healthReasons(q).length, 'flagged: ' + q);
  ok(`health check: ${CLEAN.length} partner questions pass (all 6 sample questions among them), ${FLAG.length} health or identifier messages flagged`);
}

// ---------------------------------------------- answered in the code --
assert.equal(fixedReply('Are you a real person?'), REAL_PERSON);
assert.equal(fixedReply('am i talking to a bot?'), REAL_PERSON);
assert.equal(fixedReply('Can I speak with a human?'), REAL_PERSON);
assert.equal(fixedReply('Who is behind Title22?'), WHO_RUNS);
assert.equal(fixedReply("What's the founder's name?"), WHO_RUNS);
assert.equal(fixedReply('Who runs this company?'), WHO_RUNS);
assert.equal(fixedReply('What revenue split would you accept?'), TERMS);
assert.equal(fixedReply('Could we get a discount for 40 homes?'), TERMS);
assert.equal(fixedReply('Would you sign an exclusivity agreement?'), TERMS);
for (const q of ['What does Title22 track?', 'How does the trainer program work?', 'Can SCORM be ready by November?', 'How much is Title22?',
  'Do you support ARF?', 'Can training courses run inside Title22?', "Show me Maria's CPR date"]) assert.equal(fixedReply(q), null, 'goes to the model: ' + q);
ok('real-person, who-runs-it and terms questions are answered in code; product questions go to the model');

// ------------------------------------------------------- output guard --
assert.equal(cleanReply('Eli will call you.'), 'the Title22 team will call you.');
assert.equal(cleanReply('Great question! 🎉 It is **live** now ✅'), 'Great question! It is live now');
assert.equal(cleanReply('## Steps\n1. Open Training'), 'Steps\n1. Open Training');
assert.equal(cleanReply('Give her 5 mg twice daily.'), NO_DOSAGE);
assert.equal(cleanReply('Medication training is 10 hours for a home licensed for 15 or fewer.'), 'Medication training is 10 hours for a home licensed for 15 or fewer.');
ok('replies: owner\'s name replaced, emojis and markdown stripped, dosage refused, training hours kept');

// --------------------------------------------- what she is told --
assert.doesNotMatch(prompt + knowledge, /\bEli\b|infomomtelo|EC RENTAL/i, 'no owner name or address in what the model is given');
assert.doesNotMatch(prompt + knowledge, /\p{Extended_Pictographic}/u, 'no emojis');
for (const fact of [/SCORM course integration is NOT built/, /25 items/, /tested with 300 staff/, /No resident records, no medications, no MAR/,
  /15 or fewer: 10 hours, 6 hands-on/, /16 or more: 24 hours, 16 hands-on/, /Tick "Hands-on training"/, /Lite: \$29 a month/, /Multi-Home: \$79 a month/,
  /Unverified, not included/, /Checked on 2026-10-01/]) assert.match(knowledge, fact);
assert.match(prompt, /I don't want to guess on that\. I've passed your question to the Title22 team\./);
ok('prompt and knowledge: the required facts are present, dated, no names, no emojis');

// knowledge.md's numbers are training-rules.js's numbers
{
  const T = (await import('../../training-rules.js')).default || globalThis.T22Training;
  const R = (T && T.RULES) || (await import('module')).createRequire(import.meta.url)('../../training-rules.js').RULES;
  assert.equal(R.medication.small.total_hours, 10); assert.equal(R.medication.small.hands_on, 6); assert.equal(R.medication.small.max_capacity, 15);
  assert.equal(R.medication.large.total_hours, 24); assert.equal(R.medication.large.hands_on, 16); assert.equal(R.medication.annual_hours, 8);
  assert.equal(R.initial.phases.phase1.hours, 20); assert.equal(R.initial.minimums.hands_on, 16); assert.equal(R.annual.total_hours, 20);
  assert.equal(R.admin_ce.total_hours, 40); assert.equal(R.admin_ce.max_self_paced_hours, 20);
  ok('knowledge.md training hours agree with training-rules.js');
}

// -------------------------------------------------------------- links --
reset();
let r = await call('/api/partner_tello/open', { k: KEY });
assert.equal(r.status, 200); assert.equal(r.body.greeting, GREETING); assert.equal(r.body.footer, FOOTER);
assert.equal(r.body.name, undefined, 'the page is not sent the brief or the row');
for (const k of [undefined, '', 'short', OFF_KEY, 'x'.repeat(32), '<script>' + 'a'.repeat(30)]) {
  r = await call('/api/partner_tello/open', { k });
  assert.equal(r.status, 404); assert.equal(r.body.message, INACTIVE);
}
r = await call('/api/partner_tello/chat', { k: OFF_KEY, conversation_id: CONV, message: 'hi' });
assert.equal(r.status, 404); assert.equal(db.messages.length, 0); assert.equal(anthropic.length, 0);
r = await call('/api/partner_tello/open', { k: 'charise-k7q2xm' });
assert.equal(r.status, 200, 'a short key made on /meet/admin opens');
r = await call('/api/partner_tello/open', { k: 'abc-123' });
assert.equal(r.status, 404, 'under 8 characters is refused before the database');
ok('a valid key opens (long or short); missing, unknown, malformed and inactive keys get "This link isn\'t active", and an inactive key cannot chat');

// --------------------------------------------------------- one exchange --
reset();
script = [text('Title22 tracks staff records, training hours and clearances. 😀')];
r = await chat('What does Title22 track?');
assert.equal(r.status, 200); assert.equal(r.body.stored, true);
assert.equal(r.body.reply, 'Title22 tracks staff records, training hours and clearances.');
assert.deepEqual(db.messages.map((m) => [m.role, m.text]), [['user', 'What does Title22 track?'], ['tello', r.body.reply]]);
{
  const a = anthropic[0];
  assert.equal(a.body.model, 'claude-opus-5-5');
  assert.deepEqual(a.body.output_config, { effort: 'low' });
  assert.equal(a.body.fallbacks, 'default');
  assert.match(a.headers.get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
  assert.equal(a.headers.get('x-api-key'), 'sk-test');
  assert.deepEqual(a.body.system[0].cache_control, { type: 'ephemeral' }, 'prompt + knowledge are cached');
  assert.match(a.body.system[0].text, /# Partner Tello/); assert.match(a.body.system[0].text, /What Partner Tello knows about Title22/);
  assert.match(a.body.system[1].text, /Test Partner from Sample Training Co\./); assert.match(a.body.system[1].text, /Sample row for testing\./);
  assert.equal(a.body.system[1].cache_control, undefined);
  assert.deepEqual(a.body.messages, [{ role: 'user', content: 'What does Title22 track?' }]);
  assert.doesNotMatch(JSON.stringify(a.body), /facility_id|staff_id|profiles/, 'no app data in the request');
}
assert.equal(resend.length, 1);
{
  const e = resend[0];
  assert.deepEqual(e.body.to, ['team@example.test']); assert.equal(e.body.from, 'Tello <noreply@example.test>');
  assert.equal(e.body.subject, 'Partner Tello · Test Partner: What does Title22 track?');
  assert.match(e.body.html, /What does Title22 track\?/); assert.match(e.body.html, /training hours and clearances/);
  assert.equal(e.headers.get('idempotency-key'), 'partner-tello-1');
}
assert.equal(db.messages[0].email_status, 'sent');
ok('a question: stored, answered by Opus 5.5 at low effort with a cached prompt and server-side fallback, reply cleaned and stored, emailed with the subject the owner set');

// second exchange: history goes to the model, the email carries the whole conversation
script = [text('Yes, ARF checklists are live: 25 items.')];
r = await chat('Do you support ARF?');
assert.deepEqual(anthropic[1].body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
assert.match(resend[1].body.html, /What does Title22 track\?[\s\S]*training hours[\s\S]*Do you support ARF\?[\s\S]*25 items/);
assert.equal(resend[1].body.subject, 'Partner Tello · Test Partner: Do you support ARF?');
ok('the next exchange: the model sees the conversation, and the email holds the whole conversation so far');

// long question: subject is the first 60 characters
assert.equal(subjectFor('Test Partner', 'user', 'x'.repeat(70)), 'Partner Tello · Test Partner: ' + 'x'.repeat(60));

// ------------------------------------------------- fixed answers --
reset();
r = await chat('Are you a real person?');
assert.equal(r.body.reply, REAL_PERSON); assert.equal(anthropic.length, 0); assert.equal(resend.length, 1);
r = await chat('Who is behind Title22?');
assert.equal(r.body.reply, WHO_RUNS);
r = await chat('What revenue split would you accept?');
assert.equal(r.body.reply, TERMS); assert.equal(anthropic.length, 0);
assert.equal(db.messages.filter((m) => m.role === 'tello').length, 3);
ok('tests 1, 2, 13: answered in code, stored and emailed, no model call');

// ------------------------------------------------ health information --
reset();
const phi = 'Our resident Maria Lopez was diagnosed with dementia, what should we log?';
r = await chat(phi);
assert.equal(r.status, 200); assert.equal(r.body.reply, HEALTH_WARNING); assert.equal(r.body.removed, true);
assert.equal(anthropic.length, 0, 'never sent to the model');
assert.equal(db.messages[0].text, REMOVED); assert.doesNotMatch(JSON.stringify(db), /Maria|dementia/, 'never stored');
assert.match(resend[0].body.html, /\[removed: possible health information\]/); assert.doesNotMatch(JSON.stringify(resend), /Maria|dementia/);
assert.equal(resend[0].body.subject, 'Partner Tello · Test Partner: [removed: possible health information]');
// and the next question still works, with the removed one shown to her only as a placeholder
script = [text('Sure.')];
await chat('Thanks. What does Title22 NOT hold?');
assert.doesNotMatch(JSON.stringify(anthropic[0].body.messages), /Maria|dementia/);
ok('test 7: a resident name with a diagnosis is warned, not sent to the model, not stored, and the email shows "[removed: possible health information]"');

// -------------------------------------------------- direct to the team --
reset();
r = await call('/api/partner_tello/direct', { k: KEY, conversation_id: CONV, message: 'Please call me about a group of 12 homes.' });
assert.equal(r.status, 200); assert.equal(r.body.message, DIRECT_SENT);
assert.equal(db.messages[0].role, 'direct'); assert.equal(anthropic.length, 0);
assert.equal(resend[0].body.subject, 'PRIORITY · Partner Tello · Test Partner: Please call me about a group of 12 homes.');
assert.match(resend[0].body.html, /PRIORITY/);
ok('Message the team directly: stored, PRIORITY email, confirmation word for word');

// ------------------------------------------ never claims what it did not do --
reset();
dbDown.add('partner_tello_log');
r = await chat('What does Title22 track?');
assert.equal(r.status, 503); assert.doesNotMatch(r.body.message, /sent to the|passed/i); assert.match(r.body.message, /was not sent/);
assert.equal(anthropic.length, 0); assert.equal(resend.length, 0);
r = await call('/api/partner_tello/direct', { k: KEY, conversation_id: CONV, message: 'hello' });
assert.equal(r.status, 503); assert.notEqual(r.body.message, DIRECT_SENT);
ok('a message that could not be stored is never called sent: 503, no model call, no email');

// ------------------------------------------------------------ limits --
reset();
r = await chat('x'.repeat(LIMITS.maxChars + 1));
assert.equal(r.status, 413); assert.equal(db.messages.length, 0);
r = await chat('x'.repeat(LIMITS.maxChars).replace(/^x/, 'Q'));
assert.equal(r.status, 200);
reset();
for (let i = 0; i < LIMITS.perHour; i++) assert.equal((await chat('Who is behind Title22?')).status, 200);
r = await chat('Who is behind Title22?');
assert.equal(r.status, 429); assert.equal(db.messages.filter((m) => m.role === 'user').length, LIMITS.perHour);
r = await call('/api/partner_tello/direct', { k: KEY, conversation_id: CONV, message: 'hello' });
assert.equal(r.status, 429, 'direct messages count too');
assert.equal((await chat('', {})).status, 400);
assert.equal((await chat('hi', { conversation_id: 'nope' })).status, 400);
ok(`limits: ${LIMITS.maxChars.toLocaleString('en-US')} characters (2,001 refused, 2,000 accepted); ${LIMITS.perHour} messages an hour per key, the next refused, direct included`);

// ----------------------------------------------------- model trouble --
reset();
script = [text('', { stop_reason: 'refusal', content: [] })];
r = await chat('Tell me something odd.');
assert.equal(r.body.reply, DONT_GUESS);
script = [res({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks is not supported for this model' } }, 400), text('Answered without the fallback.')];
r = await chat('What does Title22 track?');
assert.equal(r.body.reply, 'Answered without the fallback.');
assert.equal(anthropic.at(-1).body.fallbacks, undefined);
script = [res({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529), res({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529), res({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529)];
r = await chat('What does Title22 track?');
assert.equal(r.status, 200); assert.match(r.body.reply, /stored and passed to the Title22 team/);
assert.equal(db.messages.at(-2).text, 'What does Title22 track?', 'the question is kept when the model is down');
ok('a refusal says "I don\'t want to guess"; a refused fallback option is retried without it; a model outage still stores and emails the question');

// ----------------------------------------------------------- email --
reset();
resendScript = [res({ message: 'busy' }, 500), res({ message: 'busy' }, 503)];
r = await chat('Who is behind Title22?');
assert.equal(resend.length, 3, 'tried three times'); assert.equal(db.messages[0].email_status, 'sent');
assert.ok(resend.every((e) => e.headers.get('idempotency-key') === 'partner-tello-1'), 'retries cannot send twice');
reset();
resendScript = [res({ message: 'down' }, 500), res({ message: 'down' }, 500), res({ message: 'down' }, 500)];
r = await chat('Who is behind Title22?');
assert.equal(r.status, 200); assert.equal(db.messages[0].email_status, 'failed'); assert.match(db.messages[0].email_error, /Resend 500/);
let c = await retryUnsent(env);
assert.deepEqual(c, { tried: 1, sent: 1 }); assert.equal(db.messages[0].email_status, 'sent');
reset();
resendScript = [res({ message: 'The from address is not verified' }, 403)];
await chat('Who is behind Title22?');
assert.equal(resend.length, 1, 'a 403 is not retried at once'); assert.match(db.messages[0].email_error, /not verified/);
reset();
db.config = { notify_to: null, email_from: null };
await chat('Who is behind Title22?');
assert.equal(resend.length, 0); assert.equal(db.messages[0].email_status, 'pending'); assert.equal(db.messages[0].email_attempts, 0);
db.config = { notify_to: 'team@example.test', email_from: 'Tello <noreply@example.test>' };
c = await retryUnsent(env);
assert.equal(c.sent, 1); assert.equal(db.messages[0].email_status, 'sent');
ok('email: retried 3 times with one idempotency key, a failure is logged and resent by the cron run, an unconfigured address waits without losing a try');

// ------------------------------------------------------ configuration --
for (const n of REQUIRED_BINDINGS) {
  r = await call('/api/partner_tello/chat', { k: KEY, conversation_id: CONV, message: 'hi' }, 'POST', { ...env, [n]: '' });
  assert.equal(r.status, 500); assert.deepEqual(r.body.missing, [n]);
}
r = await call('/api/partner_tello/health', null, 'GET');
assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.doesNotMatch(JSON.stringify(r.body), /sk-test|re_test|anon|d{64}/);
r = await call('/api/partner_tello/chat', { k: KEY, conversation_id: CONV, message: 'hi' }, 'POST', { ...env, PARTNER_TELLO_DB_SECRET: 'e'.repeat(64) });
assert.equal(r.status, 500, 'a wrong database secret reaches nothing');
ok('a missing binding is named; /health reports names only; a wrong database secret reaches nothing');

// --------------------------------------------------------- migration --
assert.match(migration, /revoke all on public\.partner_tello_config, public\.partner_tello_links,\s+public\.partner_tello_messages, public\.partner_tello_usage\s+from anon, authenticated/);
assert.doesNotMatch(migration, /infomomtelo|@gmail/i, 'the owner\'s address is set by hand, never in git');
assert.equal((migration.match(/insert into public\.partner_tello_links/g) || []).length, 2, 'one test row (plus the commented example)');
assert.match(migration, /'Test Partner', 'Sample Training Co\.'/);
for (const fn of ['open', 'take', 'log', 'history', 'mark_email', 'unsent', 'mail_config']) {
  assert.match(migration, new RegExp(`function public\\.partner_tello_${fn}\\([\\s\\S]*?perform public\\.partner_tello_check\\(p_secret\\)`), fn + ' checks the secret');
}
assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /\b(facilities|staff|profiles|documents|residents|incidents)\b/, 'no app table is read');
ok('migration: tables closed to anon, every function checks the secret, no app table touched, one invented test row, no owner address');

// --------------------------------------------------------- email body --
{
  const m = buildEmail({ name: '<b>x</b>', org: null, role: 'user', text: 'q', history: [{ role: 'user', text: '<script>alert(1)</script>', created_at: new Date().toISOString() }] });
  assert.doesNotMatch(m.html, /<script>|<b>x<\/b>/); assert.match(m.html, /&lt;script&gt;/);
  ok('email HTML escapes everything a partner typed');
}

console.log(`\nall ${passed} checks passed`);
