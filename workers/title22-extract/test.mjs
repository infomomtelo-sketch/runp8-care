// node workers/title22-extract/test.mjs
// Checks what the scan Worker will and will not read, with fetch mocked: no
// network, no key, no model call.
import worker, { STAFF_DOCS, scanForm } from './index.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

const env = {
  SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_KEY: 'service',
  ANTHROPIC_API_KEY: 'key',
};

let calls, anthropicBody, plan;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push(url);
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/auth/v1/user')) return j({ id: 'u1' });
  if (url.includes('/rest/v1/profiles')) return j([{ title22_plan: plan, title22_plan_expires_at: null }]);
  if (url.includes('/rest/v1/ai_usage') && (init.method || 'GET') === 'GET') return j([]);
  if (url.includes('/rest/v1/ai_usage')) return j([{}], 201);
  if (url.startsWith('https://api.anthropic.com/')) {
    anthropicBody = JSON.parse(init.body);
    const keys = anthropicBody.output_config.format.schema.properties.fields.items.properties.key.enum;
    // The model answers every key it is given, and one it is NOT given, to
    // prove an extra key cannot reach the app.
    const fields = keys.map((k) => ({ key: k, value: k === 'full_name' ? 'Maria Lopez' : (k.endsWith('_cleared') || k.endsWith('_completed') || k.endsWith('_complete')) ? 'yes' : k.endsWith('_hours') ? '16' : '03/14/2026', confidence: 'high', source_text: 'x', box: [0.1, 0.1, 0.2, 0.2] }));
    fields.push({ key: 'tb_test_date', value: '01/01/2026', confidence: 'high', source_text: 'x', box: [] });
    return j({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ fields, notes: '' }) }] });
  }
  return j({ error: 'unexpected ' + url }, 500);
};

async function post(body) {
  calls = []; anthropicBody = null;
  const r = await worker.fetch(new Request('https://w.example/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  }), env);
  return { status: r.status, data: await r.json(), calls: calls.slice(), anthropicBody };
}

const image = { media_type: 'image/jpeg', data: 'AAAA' };
plan = 'lite';

// Refusals: before any network call, so nothing is charged or sent.
for (const [what, body] of [
  ['resident', { formType: 'resident', image }],
  ['medication', { formType: 'medication', image }],
  ['TB', { formType: 'staff', docType: 'tb_test', image }],
]) {
  const r = await post(body);
  ok(r.status === 403 && r.data.error === 'scan_not_allowed', `${what} refused with 403`);
  ok(r.calls.length === 0, `${what}: no network call at all`);
}
for (const [what, docType] of [['no slot', undefined], ['unknown slot', 'cert'], ['__proto__', '__proto__'], ['toString', 'toString']]) {
  const r = await post({ formType: 'staff', docType, image });
  ok(r.status === 400 && r.calls.length === 0, `staff scan with ${what} refused with 400, nothing sent`);
}

// Each certificate: the model is asked for its own fields and the name, and
// the reply carries nothing else.
for (const [docType, doc] of Object.entries(STAFF_DOCS)) {
  const r = await post({ formType: 'staff', docType, image });
  const want = ['full_name', ...doc.fields];
  ok(r.status === 200, `${docType}: 200`);
  const asked = r.anthropicBody?.output_config.format.schema.properties.fields.items.properties.key.enum || [];
  ok(JSON.stringify(asked) === JSON.stringify(want), `${docType}: model asked for exactly ${want.join(', ')}`);
  ok(r.anthropicBody && !/tb_test|dob|diagnos|medication_name/.test(r.anthropicBody.system), `${docType}: prompt names no TB, resident or medication field`);
  ok(r.anthropicBody?.system.includes(`Return exactly ${want.length} entries`), `${docType}: prompt asks for ${want.length} entries`);
  ok(JSON.stringify(Object.keys(r.data.fields)) === JSON.stringify(want), `${docType}: reply has only ${want.join(', ')} (the extra tb_test_date is dropped)`);
  ok(r.data.docType === docType, `${docType}: reply names its slot`);
}

// Values come through normalised.
const cpr = await post({ formType: 'staff', docType: 'cpr_card', image });
ok(cpr.data.fields.cpr_cert_date.value === '2026-03-14', 'CPR date normalised to 2026-03-14');
const tr = await post({ formType: 'staff', docType: 'training_cert', image });
ok(tr.data.fields.initial_training_complete.value === 'yes' && tr.data.fields.initial_training_hours.value === '16', 'training: yes and 16 hours');

// Lite and Multi-Home are metered as the paid plans they are, not as trials.
for (const [p, limit] of [['lite', 200], ['Multi-Home', 500], ['trial', 50], ['nonsense', 50]]) {
  plan = p;
  const r = await post({ formType: 'staff', docType: 'cpr_card', image });
  ok(r.data.limit === limit, `plan ${p}: limit ${limit}`);
}

ok(scanForm('staff', 'tb_test') === null, 'scanForm has no TB form');
ok(!('tb_test' in STAFF_DOCS), 'STAFF_DOCS has no tb_test');

// Health check lists what can be scanned.
const h = await (await worker.fetch(new Request('https://w.example/'), env)).json();
ok(JSON.stringify(h.scannable) === JSON.stringify({ staff: Object.keys(STAFF_DOCS) }), 'health lists only the five staff certificates');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
