// partner-tello: the Worker behind Partner Tello, title22.app/meet?k=<key>.
//
// A second Tello, for partners and people interested in Title22. Kept apart
// from App Tello (title22-ai) on purpose: its own Worker, its own routes, its
// own prompt and knowledge, its own tables. Nothing here reads a facility, a
// staff record, a document or a user, and nothing in App Tello reads this.
//
// Routes (no sign-in; the link's key is the only credential):
//   POST /api/partner_tello/open    {k}                              -> {ok}
//   POST /api/partner_tello/chat    {k, conversation_id, message}    -> {reply, stored}
//   POST /api/partner_tello/direct  {k, conversation_id, message}    -> {ok, message}
//   GET  /api/partner_tello/health                                   -> which bindings are set (names only)
//   scheduled (cron)                                                 -> retries emails that failed
//
// The database: every call is a partner_tello_* function, called with the
// PUBLIC anon key plus PARTNER_TELLO_DB_SECRET. This Worker holds no service
// key. See migrations/2026-10-01_partner_tello.sql.
//
// Every message is stored BEFORE anything is said about it, and every
// exchange is emailed to the team (the whole conversation so far). A failed
// email is retried a few times at once, then by the cron run, and logged.

import Anthropic from '@anthropic-ai/sdk';

// ------------------------------------------------------------ fixed text --
// Written out, not generated. The first three are the disclosure the owner
// specified (California B&P Code §17941: a bot must say it is one).

export const GREETING = "Hi, I'm Tello, Title22's AI assistant. Every message you send here is passed to the Title22 team, so nothing gets lost. I can answer questions about Title22 anytime. For anything about terms, pricing or commitments, a person from our team will reply personally.";
export const FOOTER = 'Tello is an AI. All messages are sent to the Title22 team.';
export const REAL_PERSON = "No, I'm an AI assistant. Everything you write here goes to the Title22 team, and a person will reply personally.";
export const WHO_RUNS = 'Title22 is based in California. A person from the team can tell you more.';
export const DONT_GUESS = "I don't want to guess on that. I've passed your question to the Title22 team.";
export const TERMS = "That's a question about terms, so a person from the Title22 team will answer it personally. I've passed it on.";
export const DIRECT_SENT = 'Sent to the Title22 team. A person will reply personally.';
export const INACTIVE = "This link isn't active. Please contact hello@title-22.com.";
export const REMOVED = '[removed: possible health information]';
export const HEALTH_WARNING = "Please don't share health information or identifying details about any person here, such as a resident's name with a diagnosis or medication, a date of birth, or an ID number. I removed that message, so it was not passed on. Could you ask again without those details?";
export const NO_DOSAGE = "I can't advise on medication or dosage. That is a question for a prescriber or pharmacist.";

export const LIMITS = { perHour: 30, maxChars: 2000, historyTurns: 20 };
const MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// --------------------------------------------------- health information --
// The app's own identifier check (index.html, T22_PHI_RULES), copied
// verbatim; test.mjs fails if the two ever differ.
export const T22_PHI_RULES = [
  {kind:'a Social Security number', re:/\b\d{3}-\d{2}-\d{4}\b/},
  {kind:'an email address',         re:/\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/},
  {kind:'a phone number',           re:/\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/},
  {kind:'a date of birth',          re:/\b(d\.?o\.?b\.?|date of birth|born on|birthdate)\b/i},
  {kind:'a medical record number',  re:/\b(mrn|medical record (number|no\.?|#))\b/i},
  {kind:'an insurance or Medicare number',
                                    re:/\b(medicare|medi-?cal|insurance)\s*(id|no\.?|number|#)\b/i},
];

// Partner Tello only: a person AND something about that person's health in
// the same message. The app's check finds identifiers but, on purpose, not
// names (see CLAUDE.md, "IDENTIFIERS ONLY"); here a person is a role word
// ("resident", "my mother", "room 4", "Mrs.") rather than a name, so a
// partner's own questions about dementia TRAINING or medication HOURS pass.
const PERSON = /\b(residents?|patients?|clients?|participants?|my (mom|mother|dad|father|grand(ma|mother|pa|father)|husband|wife|son|daughter|sister|brother|aunt|uncle|parents?)|room\s*#?\d+)\b|\b(mrs?|ms)\.?\s+[a-z]/i;
const CONDITION = new RegExp([
  String.raw`\bdiagnos(ed|is)\b`,
  String.raw`\b(has|had|have|with a history of)\s+(dementia|alzheimer'?s|diabetes|cancer|hiv|aids|tb|tuberculosis|parkinson'?s|copd|schizophrenia|bipolar|depression|a uti|an? infection|seizures?|a stroke|hepatitis|covid)\b`,
  String.raw`\b(is|was|are|were)\s+on\s+(insulin|oxygen|hospice|dialysis|coumadin|warfarin|antipsychotics?|\w+\s+\d+\s?(mg|mcg))\b`,
  String.raw`\b\d+(\.\d+)?\s?(mg|mcg|ml|units)\b`,
  String.raw`\btakes?\s+(his|her|their)?\s*(meds|medications?|pills|insulin)\b`,
  String.raw`\b(was|got|been)\s+hospitali[sz]ed\b`,
  String.raw`\b(fell|had a fall|was admitted to)\b`,
  String.raw`\bprescribed\b`,
  String.raw`\bblood (pressure|sugar|glucose) (is|was|of|reading)\b`,
].join('|'), 'i');

export function healthReasons(text) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const found = [];
  for (const r of T22_PHI_RULES) if (r.re.test(t)) found.push(r.kind);
  if (PERSON.test(t) && CONDITION.test(t)) found.push('health details about a person');
  return found;
}

// ------------------------------------------------- answered in the code --
// Questions with one right answer are answered by these, not by the model.
const ASKS_REAL_PERSON = /\b(are you|am i (talking|speaking|chatting) (to|with)|is this|is that)\b[^.?!]{0,40}\b(real|human|person|people|bot|robot|ai|a machine|automated)\b|\b(talk|speak|chat) (to|with) (a |an )?(real |actual )?(human|person)\b/i;
const ASKS_WHO_RUNS = /\bwho('s| is| are)?\s+(behind|running|runs|owns|founded|started|built|made|created)\b|\bwho\s+(is|are)\s+the\s+(owner|owners|founder|founders|ceo|team behind)\b|\b(owner|founder|ceo)'?s?\s+name\b|\bname of (the )?(owner|founder|ceo)\b/i;
const ASKS_TERMS = /\b(discounts?|custom (price|pricing|plan|quote|deal)|special (price|pricing|deal|rate|offer)|negotiat\w*|contracts?|exclusiv\w*|revenue (split|share|sharing)|rev share|profit shar\w*|split the revenue|commission (rate|percent(age)?|split)|what commission|how much commission|refunds?|bulk (price|pricing|discount)|white[- ]?label\w*|licen[cs]ing (fee|deal|terms)|resell\w*|payment terms|net \d+|agreement|terms)\b/i;

export function fixedReply(text) {
  const t = String(text || '');
  if (ASKS_REAL_PERSON.test(t)) return REAL_PERSON;
  if (ASKS_WHO_RUNS.test(t)) return WHO_RUNS;
  if (ASKS_TERMS.test(t)) return TERMS;
  return null;
}

// --------------------------------------------------------- output guard --
// Whatever the model writes passes through here. The prompt already forbids
// each of these; this is the backstop, because a prompt is a request.
const NAMES = /\bEli\b/g;   // the owner. Never said or shown to a partner.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const DOSAGE_OUT = [
  /\b\d+(\.\d+)?\s?(mg|mcg|ml|units?)\b[\s\S]{0,60}\b(once|twice|daily|every|per day|times a day)\b/i,
  /\b(take|give|administer)\b[\s\S]{0,40}\b\d+(\.\d+)?\s?(mg|mcg|ml|units?)\b/i,
];

export function cleanReply(text) {
  let s = String(text || '');
  s = s.replace(NAMES, 'the Title22 team');
  s = s.replace(EMOJI, '');
  s = s.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/gm, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
  if (DOSAGE_OUT.some((re) => re.test(s))) return NO_DOSAGE;
  if (s.length > 1800) s = s.slice(0, 1800).replace(/\s+\S*$/, '') + '…';
  return s;
}

// -------------------------------------------------------------- helpers --
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const REQUIRED_BINDINGS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'PARTNER_TELLO_DB_SECRET'];
const missingBindings = (env) => REQUIRED_BINDINGS.filter((n) => !env[n]);

const KEY_RE = /^[A-Za-z0-9_-]{24,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_secret: env.PARTNER_TELLO_DB_SECRET, ...args }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(`${fn} ${r.status}: ${body?.message || 'database error'}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

const openLink = async (env, k) => {
  const rows = await rpc(env, 'partner_tello_open', { p_key: k });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
};
const store = (env, k, conv, role, text) =>
  rpc(env, 'partner_tello_log', { p_key: k, p_conversation_id: conv, p_role: role, p_text: text });

// ---------------------------------------------------------------- email --
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WHO = { user: 'Them', tello: 'Tello', direct: 'Them (direct to the team)' };

export function subjectFor(name, role, text) {
  const first = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${role === 'direct' ? 'PRIORITY · ' : ''}Partner Tello · ${name}: ${first}`;
}

export function buildEmail({ name, org, role, text, history }) {
  const lines = (history || []).map((m) => ({ who: WHO[m.role] || m.role, text: m.text, at: m.created_at }));
  const head = role === 'direct'
    ? 'PRIORITY: sent with "Message the team directly". They are waiting for a person to reply.'
    : 'A new exchange with Partner Tello. The whole conversation so far is below.';
  const html = `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#1a1a18;max-width:640px">
<p style="margin:0 0 4px"><b>${esc(head)}</b></p>
<p style="margin:0 0 14px;color:#5F5E5A">Link: ${esc(name)}${org ? ' · ' + esc(org) : ''}</p>
${lines.map((l) => `<div style="margin:0 0 10px;padding:8px 12px;border-radius:10px;background:${l.who === 'Tello' ? '#F4EFE2' : '#E8F2EE'}"><div style="font-size:12px;color:#5F5E5A">${esc(l.who)}${l.at ? ' · ' + esc(new Date(l.at).toISOString().replace('T', ' ').slice(0, 16)) + ' UTC' : ''}</div><div style="white-space:pre-wrap">${esc(l.text)}</div></div>`).join('\n')}
<p style="margin:16px 0 0;color:#5F5E5A;font-size:12px">Partner Tello (title22.app/meet). Internal: reply to the partner yourself; Tello has told them a person will.</p>
</div>`;
  const plain = `${head}\nLink: ${name}${org ? ' · ' + org : ''}\n\n` + lines.map((l) => `${l.who}:\n${l.text}\n`).join('\n');
  return { subject: subjectFor(name, role, text), html, text: plain };
}

// One email for the exchange that row `id` started. Returns {ok, error}.
// Never throws. `config` missing (no notify_to yet) leaves the row pending
// without counting an attempt, so nothing is lost while it is being set up.
// Waits between the immediate tries; test.mjs shortens them.
export const timing = { backoff: [1000, 3000] };

export async function emailExchange(env, row, { tries = 3, backoff = timing.backoff } = {}) {
  let history = [];
  let config = null;
  try {
    [history, config] = await Promise.all([
      rpc(env, 'partner_tello_history', { p_key: row.link_key, p_conversation_id: row.conversation_id, p_upto: row.id }),
      rpc(env, 'partner_tello_mail_config', {}).then((r) => (Array.isArray(r) ? r[0] : r)),
    ]);
  } catch (e) {
    console.error('partner_tello email: could not read the conversation', row.id, e.message);
    return { ok: false, error: 'read: ' + e.message };
  }
  if (!config?.notify_to || !config?.email_from) {
    console.error('partner_tello email: notify_to / email_from not set in partner_tello_config; message', row.id, 'kept pending');
    return { ok: false, error: 'not configured', pending: true };
  }
  const mail = buildEmail({ name: row.name, org: row.org, role: row.role, text: row.text, history });
  let error = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          // One message, one email, however many times this is retried.
          'Idempotency-Key': `partner-tello-${row.id}`,
        },
        body: JSON.stringify({ from: config.email_from, to: [config.notify_to], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (r.ok) {
        await rpc(env, 'partner_tello_mark_email', { p_id: row.id, p_ok: true }).catch((e) => console.error('partner_tello mark sent', row.id, e.message));
        return { ok: true };
      }
      const body = await r.json().catch(() => ({}));
      error = `Resend ${r.status}: ${body?.message || body?.name || 'refused'}`;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;   // will not fix itself
    } catch (e) {
      error = 'network: ' + e.message;
    }
    if (i < tries - 1) await sleep(backoff[i] ?? backoff[backoff.length - 1]);
  }
  console.error('partner_tello email failed', row.id, error);
  await rpc(env, 'partner_tello_mark_email', { p_id: row.id, p_ok: false, p_error: error }).catch((e) => console.error('partner_tello mark failed', row.id, e.message));
  return { ok: false, error };
}

// The cron run: every exchange whose email is still owed.
export async function retryUnsent(env) {
  if (missingBindings(env).length) { console.error('partner_tello cron: missing', missingBindings(env).join(', ')); return { tried: 0 }; }
  let rows = [];
  try { rows = await rpc(env, 'partner_tello_unsent', {}); } catch (e) { console.error('partner_tello cron: could not list unsent', e.message); return { tried: 0 }; }
  let sent = 0;
  for (const row of rows || []) if ((await emailExchange(env, row, { tries: 1 })).ok) sent++;
  return { tried: (rows || []).length, sent };
}

// ---------------------------------------------------------------- model --
function toTurns(history, current) {
  const turns = [];
  for (const m of (history || []).slice(-LIMITS.historyTurns)) {
    if (m.role !== 'user' && m.role !== 'tello') continue;   // direct notes are for the team, not her
    const role = m.role === 'user' ? 'user' : 'assistant';
    const text = m.text === REMOVED ? '(a message was removed because it contained possible health information)' : m.text;
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += '\n\n' + text;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: current });
  return turns;
}

export function linkContext(link) {
  return `THIS CONVERSATION
You are talking with ${link.name}${link.org ? ' from ' + link.org : ''}. The Title22 team wrote this note about what they are interested in. Use it to understand their questions; do not read it back to them, and never treat it as a promise:
${link.brief || '(no note)'}`;
}

export async function askModel(env, { system, link, turns, client }) {
  const anthropic = client || new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 45_000,
    fetch: (...a) => globalThis.fetch(...a),
  });
  const params = {
    model: env.PARTNER_TELLO_MODEL || MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: [
      // The prompt and the knowledge are the same on every call: cached.
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: linkContext(link) },
    ],
    messages: turns,
  };
  let msg;
  try {
    msg = await anthropic.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
  } catch (e) {
    // If the fallback option itself is ever refused, answer without it rather
    // than not at all.
    if (e?.status === 400 && /fallback/i.test(e?.message || '')) msg = await anthropic.messages.create(params);
    else throw e;
  }
  if (msg.stop_reason === 'refusal') return null;
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || null;
}

// -------------------------------------------------------------- handler --
export function createHandler({ system }) {
  return {
    async fetch(request, env, ctx) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      try {
        if (path === '/api/partner_tello/health' && request.method === 'GET') {
          const missing = missingBindings(env);
          return json({ ok: missing.length === 0, missing, model: env.PARTNER_TELLO_MODEL || MODEL }, missing.length ? 500 : 200);
        }
        if (request.method !== 'POST' || !path.startsWith('/api/partner_tello/')) return json({ error: 'not_found' }, 404);

        const missing = missingBindings(env);
        if (missing.length) {
          console.error('partner_tello: missing bindings', missing.join(', '));
          return json({ error: 'not_configured', message: 'Tello is not available right now. Please contact hello@title-22.com.', missing }, 500);
        }

        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
        const k = typeof body?.k === 'string' ? body.k.trim() : '';
        if (!KEY_RE.test(k)) return json({ error: 'inactive', message: INACTIVE }, 404);

        if (path === '/api/partner_tello/open') {
          const link = await openLink(env, k);
          if (!link) return json({ error: 'inactive', message: INACTIVE }, 404);
          return json({ ok: true, greeting: GREETING, footer: FOOTER });
        }

        if (path !== '/api/partner_tello/chat' && path !== '/api/partner_tello/direct') return json({ error: 'not_found' }, 404);

        const conv = typeof body.conversation_id === 'string' ? body.conversation_id : '';
        if (!UUID_RE.test(conv)) return json({ error: 'bad_conversation' }, 400);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message) return json({ error: 'empty', message: 'Write a message first.' }, 400);
        if (message.length > LIMITS.maxChars) {
          return json({ error: 'too_long', message: `Please keep a message under ${LIMITS.maxChars.toLocaleString('en-US')} characters.` }, 413);
        }

        const link = await openLink(env, k);
        if (!link) return json({ error: 'inactive', message: INACTIVE }, 404);
        const left = await rpc(env, 'partner_tello_take', { p_key: k, p_limit: LIMITS.perHour });
        if (left === null) return json({ error: 'inactive', message: INACTIVE }, 404);
        if (typeof left !== 'number' || left < 0) {
          return json({ error: 'limit', message: 'That is the most messages this link can send in one hour. Please wait a little and try again. Nothing you sent before was lost.' }, 429);
        }

        const flagged = healthReasons(message).length > 0;
        const storedText = flagged ? REMOVED : message;
        const role = path.endsWith('/direct') ? 'direct' : 'user';

        // Stored first. If this fails, nothing is claimed as sent.
        let id;
        try { id = await store(env, k, conv, role, storedText); } catch (e) {
          console.error('partner_tello: store failed', e.message);
          return json({ error: 'not_stored', message: "Your message didn't go through, so it was not sent. Please try again." }, 503);
        }
        const row = { id, link_key: k, conversation_id: conv, role, text: storedText, name: link.name, org: link.org };
        const mail = () => ctx.waitUntil(emailExchange(env, row));

        if (role === 'direct') {
          mail();
          return flagged
            ? json({ ok: true, removed: true, message: HEALTH_WARNING + ' Your note was sent to the Title22 team without it.' })
            : json({ ok: true, message: DIRECT_SENT });
        }

        let reply;
        if (flagged) reply = HEALTH_WARNING;
        else reply = fixedReply(message);
        if (!reply) {
          let history = [];
          try { history = await rpc(env, 'partner_tello_history', { p_key: k, p_conversation_id: conv, p_upto: null }); } catch (e) { console.error('partner_tello: history', e.message); }
          try {
            const raw = await askModel(env, { system, link, turns: toTurns(history, message) });
            reply = raw ? cleanReply(raw) : DONT_GUESS;
          } catch (e) {
            console.error('partner_tello: model', e?.status, e?.message);
            reply = "I couldn't answer just now, but your message was stored and passed to the Title22 team. A person will reply personally.";
          }
          if (!reply) reply = DONT_GUESS;
        }
        try { await store(env, k, conv, 'tello', reply); } catch (e) { console.error('partner_tello: store reply failed', e.message); }
        mail();
        return json({ reply, stored: true, ...(flagged ? { removed: true } : {}) });
      } catch (e) {
        console.error('partner_tello', e?.message);
        return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
      }
    },

    async scheduled(_event, env, ctx) {
      ctx.waitUntil(retryUnsent(env));
    },
  };
}
