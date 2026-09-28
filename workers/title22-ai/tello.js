// Tello's own routes, behind title22.app/tello.
//
//   GET  /api/tello/me        who am I talking to: mode, credits, memory
//   POST /api/tello           one message in, Tello's reply out
//   POST /api/tello/new       "new conversation" (earlier messages still happened)
//   GET  /api/tello/snapshot  live counts                        partner mode only
//   POST /api/tello/brief     today's brief / the Monday review  partner mode only
//
// The rule this file exists to keep: THE SERVER DECIDES WHO TELLO IS.
// /api/chat (the in-app Tello) takes its instructions from the page, because
// they carry that facility's context. Here the browser sends only what the
// person typed. Partner mode is chosen from the signed-in user's id against
// public.tello_founders, which nothing in a browser can read or write — there
// is no button, URL or request field that turns it on. Anything uncertain
// (table missing, read failed) answers as customer mode.

import { TELLO_CORE, CUSTOMER_PAGE, PARTNER_FALLBACK, PARTNER_TOOLS, PARTNER_LAST, BRIEF_TODAY, BRIEF_WEEKLY } from './tello/core.js';
import { TITLE22_KNOWLEDGE } from './tello/title22-knowledge.js';
import { TITLE22_HISTORY } from './tello/title22-history.js';

// A business Tello works for. Title22 is the first; the next one is another
// entry here with its own knowledge and its own snapshot function.
export const TELLO_CLIENTS = {
  // history: what has happened, what is decided, what is open. Partner only.
  title22: { name: 'Title22', knowledge: TITLE22_KNOWLEDGE, history: TITLE22_HISTORY, snapshotRpc: 'tello_business_snapshot' },
};
const CLIENT = TELLO_CLIENTS.title22;

const CUSTOMER_MODEL = 'claude-haiku-4-5-20251001';
// The owner's own partner. Sonnet 5, the owner's choice (2026-09-27): Opus
// 5.5 writes better but still cannot act, so it was not worth twice the
// price. Customers stay on Haiku.
const PARTNER_MODEL = 'claude-sonnet-5';
// Sonnet 5 thinks by default, and thinking tokens count against max_tokens.
// The first build capped partner answers at 1,500 tokens (900 for briefs),
// which thinking alone can use up, leaving an empty or cut-off reply. Hence
// the room below, with effort set explicitly.
const PARTNER_MAX_TOKENS = 8000;
const PARTNER_EFFORT = 'medium';
const PARTNER_MONTHLY_LIMIT = 1500;
const MAX_INPUT = 4000;
const MARKER = '[New conversation.]';
const MARKER_FOR_MODEL = '[New conversation. Earlier messages still happened, but this is a fresh start. Do not continue the previous topic unless I bring it up.]';
// How much of the conversation she sees: the opening, then the most recent
// turns. The owner's partner sees far more of it.
const KEEP_LAST = { customer: 16, partner: 40 };
const NOTE_MAX = 500, NOTES_MAX = 100;
// Photos and PDFs are read for one answer and never stored.
const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const ATTACH_MAX_B64 = 7_000_000; // about 5 MB
const GAP_FOR_MODEL = '[Some earlier messages are left out here. What follows is the most recent part of the conversation.]';

// ----------------------------------------------------------------- REST --
function rest(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
}
async function restRows(env, path) {
  const r = await rest(env, path);
  if (!r.ok) return null;
  return r.json();
}

// ------------------------------------------------------------- the mode --
export async function isFounder(env, userId) {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return false;
  try {
    const rows = await restRows(env, `tello_founders?user_id=eq.${userId}&select=user_id`);
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}

async function partnerInstructions(env) {
  try {
    const rows = await restRows(env, `tello_private?key=eq.founder&select=body`);
    const body = rows?.[0]?.body;
    return typeof body === 'string' && body.trim() ? { text: body, loaded: true } : { text: PARTNER_FALLBACK, loaded: false };
  } catch {
    return { text: PARTNER_FALLBACK, loaded: false };
  }
}

// ----------------------------------------------------------------- time --
const LA = 'America/Los_Angeles';
export function laDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LA }).format(d);
}
function laLong(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: LA, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
// The Monday that starts the LA week containing d, as YYYY-MM-DD.
export function laMonday(d = new Date()) {
  const [y, m, day] = laDate(d).split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, day, 12));
  const dow = (noon.getUTCDay() + 6) % 7; // Monday = 0
  noon.setUTCDate(noon.getUTCDate() - dow);
  return noon.toISOString().slice(0, 10);
}

// --------------------------------------------------------------- memory --
function memoryTable(founder) { return founder ? 'tello_founder_messages' : 'tello_messages'; }

async function loadMemory(env, userId, founder) {
  const kind = founder ? '&kind=in.(chat,marker)' : '';
  const r = await rest(env, `${memoryTable(founder)}?user_id=eq.${userId}${kind}&select=role,content,created_at&order=created_at.desc&limit=400`);
  if (!r.ok) return { ok: false, rows: [] };
  const rows = await r.json();
  return { ok: true, rows: rows.reverse() };
}

async function remember(env, userId, founder, rows) {
  const body = rows.map((x) => ({ user_id: userId, role: x.role, content: x.content, ...(founder ? { kind: x.kind || 'chat', ...(x.data ? { data: x.data } : {}) } : {}) }));
  const r = await rest(env, memoryTable(founder), { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  return r.ok;
}

// The window keeps the OPENING as well as the recent turns: names are said
// once at the start and never again, so a plain last-N window forgets the
// name first. The gap is marked so the two halves are not read as one.
export function contextFrom(rows, message, keepLast = KEEP_LAST.customer) {
  let turns = rows.map((r) => ({ role: r.role, content: r.content === MARKER ? MARKER_FOR_MODEL : r.content }));
  if (turns.length > keepLast + 6) turns = [...turns.slice(0, 6), { role: 'user', content: GAP_FOR_MODEL }, ...turns.slice(-keepLast)];
  turns.push({ role: 'user', content: message });
  // The API wants user first and strict alternation.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const out = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content;
    else out.push({ ...t });
  }
  return out;
}

// ---------------------------------------------------------------- model --
function textOf(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
}
// Belt and braces for "no markdown": the page shows text as-is.
export function plain(s) {
  return String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '').trim();
}

async function callModel(env, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('anthropic', r.status, JSON.stringify(data).slice(0, 300));
    throw new Error('model_error_' + r.status);
  }
  return data;
}

const SNAPSHOT_TOOL = {
  name: 'business_snapshot',
  description: 'Live business numbers for Title22, counts only: signups (7/30 days, all time), trials (active, ending in 7 days, expired), classroom accounts, paying accounts by plan, MRR estimate at list price, failed payments, where new accounts stall, active users in 7 days, and signups/paid per partner code. Takes no input.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function snapshot(env) {
  const r = await rest(env, `rpc/${CLIENT.snapshotRpc}`, { method: 'POST', body: '{}' });
  if (!r.ok) return { error: 'snapshot_unavailable', status: r.status };
  return r.json();
}

// Runs the conversation, letting partner-mode Tello look up the numbers.
// At most three rounds, so a confused model cannot loop on the tool.
async function converse(env, { model, system, messages, tools, maxTokens, effort }) {
  const msgs = messages.slice();
  let snap = null, used = false;
  for (let round = 0; round < 3; round++) {
    const body = { model, max_tokens: maxTokens, system, messages: msgs };
    if (tools) body.tools = tools;
    if (effort) body.output_config = { effort };
    const data = await callModel(env, body);
    if (data.stop_reason !== 'tool_use') return { text: plain(textOf(data)), usedSnapshot: used };
    msgs.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const b of data.content.filter((x) => x.type === 'tool_use')) {
      if (b.name === 'business_snapshot') {
        snap = snap || await snapshot(env);
        used = true;
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(snap) });
      } else {
        results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Unknown tool.', is_error: true });
      }
    }
    msgs.push({ role: 'user', content: results });
  }
  // Out of rounds: ask once more with no tools, so there is always an answer.
  const data = await callModel(env, { model, max_tokens: maxTokens, system, messages: msgs.concat([{ role: 'user', content: 'Answer now from what you have.' }]), ...(effort ? { output_config: { effort } } : {}) });
  return { text: plain(textOf(data)), usedSnapshot: used };
}

async function latestBrief(env, userId) {
  const rows = await restRows(env, `tello_founder_messages?user_id=eq.${userId}&kind=in.(today,weekly)&select=kind,content,created_at&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

// Things the owner asked her to remember, in his words. She cannot add to
// this list herself: a note exists only because he said "Remember" or tapped
// Remember this.
async function loadNotes(env, userId) {
  const rows = await restRows(env, `tello_founder_messages?user_id=eq.${userId}&kind=eq.note&select=id,content,created_at&order=created_at.asc&limit=${NOTES_MAX}`);
  return Array.isArray(rows) ? rows : [];
}
async function addNote(env, userId, text) {
  const note = String(text || '').trim().slice(0, NOTE_MAX);
  if (!note) return { ok: false, error: 'empty' };
  const existing = await loadNotes(env, userId);
  if (existing.length >= NOTES_MAX) return { ok: false, error: 'full', message: `She is holding ${NOTES_MAX} notes already. Delete one first.` };
  if (existing.some((n) => n.content === note)) return { ok: true, note, duplicate: true };
  const r = await rest(env, 'tello_founder_messages', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, role: 'user', kind: 'note', content: note }) });
  // A check violation means the 'note' kind is not in the table yet: the
  // migration that adds it has not been run. Say so rather than fail quietly.
  if (!r.ok) return { ok: false, error: 'notes_not_enabled', message: 'Notes are not switched on yet: run migrations/2026-09-28_tello_notes.sql.' };
  return { ok: true, note };
}
export function rememberFrom(message) {
  const m = String(message || '').match(/^\s*remember(?:\s+this)?\s*[:,\-–—]\s*([\s\S]+)$/i);
  return m ? m[1].trim() : null;
}

async function systemFor(env, founder, userId) {
  const now = `It is now ${laLong()} in California.`;
  if (!founder) return [TELLO_CORE, CUSTOMER_PAGE, 'THE BUSINESS YOU WORK FOR: ' + CLIENT.name + '\n\n' + CLIENT.knowledge, now].join('\n\n');
  const p = await partnerInstructions(env);
  const brief = await latestBrief(env, userId).catch(() => null);
  const notes = await loadNotes(env, userId).catch(() => []);
  return [
    TELLO_CORE,
    p.text,
    PARTNER_TOOLS,
    'THE BUSINESS: ' + CLIENT.name + '. This is what customers are told about it; hold the owner to the same facts.\n\n' + CLIENT.knowledge,
    CLIENT.history ? 'WHAT YOU KNOW ABOUT ITS HISTORY (from the owner\'s own records; dated lines may have changed since, and the live numbers win over anything here)\n\n' + CLIENT.history : '',
    notes.length ? 'THINGS THE OWNER ASKED YOU TO REMEMBER (his words, oldest first; he can delete any of them)\n' + notes.map((n) => `- (${laDate(new Date(n.created_at))}) ${n.content}`).join('\n') : '',
    brief ? `THE LAST BRIEF YOU GAVE THEM (${brief.kind}, ${brief.created_at}):\n${brief.content}` : '',
    PARTNER_LAST,
    now,
  ].filter(Boolean).join('\n\n');
}

// -------------------------------------------------------------- credits --
async function peekCredits(env, userId, plan, founder, limits) {
  const app = founder ? 'tello-partner' : 'title22';
  const limit = founder ? PARTNER_MONTHLY_LIMIT : (limits[plan] ?? limits.trial);
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const rows = await restRows(env, `ai_usage?user_id=eq.${userId}&app=eq.${app}&period_start=eq.${period}&select=calls_used`);
  const used = rows?.[0]?.calls_used || 0;
  return { limit, remaining: Math.max(0, limit - used) };
}

// ---------------------------------------------------------------- route --
export async function handleTello(request, env, deps) {
  const { json, getUserFromToken, getProfile, resolvePlan, checkAndDeductCredits, LIMITS,
    inputIsBlocked, DOSAGE_REFUSAL, containsDosageAdvice, SAFE_DOSAGE_MESSAGE, logDosageRejection } = deps;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');

  const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
  const user = await getUserFromToken(token, env);
  if (!user?.id) return json({ error: 'Unauthorized' }, 401);

  const founder = await isFounder(env, user.id);
  const mode = founder ? 'partner' : 'customer';
  const profile = await getProfile(user.id, env);
  const plan = resolvePlan(profile);

  if (path === '/api/tello/me' && request.method === 'GET') {
    const credits = await peekCredits(env, user.id, plan, founder, LIMITS);
    const mem = await rest(env, `${memoryTable(founder)}?user_id=eq.${user.id}&select=role&limit=1`);
    const out = { mode, client: CLIENT.name, ...credits, memory: mem.ok };
    if (founder) out.instructions_loaded = (await partnerInstructions(env)).loaded;
    return json(out);
  }

  if (path === '/api/tello/snapshot' && request.method === 'GET') {
    if (!founder) return json({ error: 'not_available' }, 403);
    return json(await snapshot(env));
  }

  if (path === '/api/tello/remember' && request.method === 'POST') {
    if (!founder) return json({ error: 'not_available' }, 403);
    const body = await request.json().catch(() => ({}));
    const out = await addNote(env, user.id, body.text);
    return json(out, out.ok ? 200 : (out.error === 'empty' ? 400 : 409));
  }

  if (path === '/api/tello/new' && request.method === 'POST') {
    const ok = await remember(env, user.id, founder, [{ role: 'user', content: MARKER, kind: 'marker' }]);
    return json({ ok });
  }

  if (path === '/api/tello/brief' && request.method === 'POST') {
    if (!founder) return json({ error: 'not_available' }, 403);
    const body = await request.json().catch(() => ({}));
    const kind = body.kind === 'weekly' ? 'weekly' : 'today';
    const since = kind === 'weekly' ? laMonday() : laDate();
    // One per day / one per week: reuse it unless they asked for a fresh one.
    const rows = await restRows(env, `tello_founder_messages?user_id=eq.${user.id}&kind=eq.${kind}&select=content,created_at,data&order=created_at.desc&limit=2`) || [];
    const current = rows.find((r) => laDate(new Date(r.created_at)) >= since);
    const snap = await snapshot(env);
    if (current && !body.fresh) return json({ kind, content: current.content, created_at: current.created_at, cached: true, snapshot: snap });

    const credits = await checkAndDeductCredits(user.id, plan, env, { app: 'tello-partner', limit: PARTNER_MONTHLY_LIMIT });
    if (!credits.allowed) return json({ error: 'limit_reached', message: 'Partner mode has used its calls for this month.' }, 402);

    const previous = rows.find((r) => r !== current && r.data) || (current?.data ? current : null);
    const ask = [
      kind === 'weekly' ? BRIEF_WEEKLY : BRIEF_TODAY,
      'NUMBERS NOW:\n' + JSON.stringify(snap),
      previous ? `PREVIOUS NUMBERS (${previous.created_at}):\n` + JSON.stringify(previous.data) : 'There are no previous numbers to compare with.',
    ].join('\n\n');
    const system = await systemFor(env, true, user.id);
    const model = env.TELLO_PARTNER_MODEL || PARTNER_MODEL;
    let text;
    try {
      ({ text } = await converse(env, { model, system, messages: [{ role: 'user', content: ask }], maxTokens: PARTNER_MAX_TOKENS, effort: PARTNER_EFFORT }));
    } catch (e) {
      return json({ error: 'model_unavailable', message: 'Tello could not write the brief just now.', snapshot: snap }, 502);
    }
    const created_at = new Date().toISOString();
    await remember(env, user.id, true, [{ role: 'assistant', content: text, kind, data: snap.error ? null : snap }]);
    return json({ kind, content: text, created_at, cached: false, snapshot: snap, remaining: credits.remaining });
  }

  if (path === '/api/tello' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const typed = typeof body.message === 'string' ? body.message.trim() : '';
    const att = body.attachment && typeof body.attachment === 'object' ? body.attachment : null;
    if (att) {
      if (!ATTACH_TYPES.includes(att.media_type) || typeof att.data !== 'string' || !att.data)
        return json({ error: 'bad_attachment', message: 'Tello can read a photo (JPEG, PNG, GIF, WebP) or a PDF.' }, 400);
      if (att.data.length > ATTACH_MAX_B64) return json({ error: 'too_big', message: 'That file is too big. Try a smaller photo, or a PDF under 5 MB.' }, 413);
    }
    const isPdf = att?.media_type === 'application/pdf';
    const message = typed || (att ? (isPdf ? 'Read this PDF and tell me what it says, briefly.' : 'Read this photo and tell me what it says, briefly.') : '');
    if (!message) return json({ error: 'empty' }, 400);
    if (message.length > MAX_INPUT) return json({ error: 'too_long', message: `Keep it under ${MAX_INPUT} characters.` }, 413);

    // Refused before any credit is spent or the model is called, and not
    // written to memory: the refusal is shown, the question is not kept.
    if (inputIsBlocked(message)) return json({ reply: DOSAGE_REFUSAL, mode, blocked: 'dosage_safety' });

    const credits = founder
      ? await checkAndDeductCredits(user.id, plan, env, { app: 'tello-partner', limit: PARTNER_MONTHLY_LIMIT })
      : await checkAndDeductCredits(user.id, plan, env);
    if (!credits.allowed) {
      if (credits.error) return json({ error: 'credit_system_error', message: 'Could not check your Tello credits. Please try again.' }, 500);
      return json({ error: 'limit_reached', message: `You've used all ${credits.limit} Tello messages for this month. They reset on the 1st.`, remaining: 0 }, 402);
    }

    // "Remember: ..." in partner mode keeps the note, then she answers as usual.
    const toRemember = founder ? rememberFrom(message) : null;
    const noted = toRemember ? await addNote(env, user.id, toRemember) : null;

    const mem = await loadMemory(env, user.id, founder);
    const messages = contextFrom(mem.rows, message, founder ? KEEP_LAST.partner : KEEP_LAST.customer);
    if (att) {
      // The file rides on this one request only. It is not written anywhere:
      // memory keeps a one-line mention, never the file.
      const last = messages[messages.length - 1];
      const block = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: att.media_type, data: att.data } }
        : { type: 'image', source: { type: 'base64', media_type: att.media_type, data: att.data } };
      last.content = [block, { type: 'text', text: last.content }];
    }
    const system = await systemFor(env, founder, user.id);
    let reply;
    try {
      ({ text: reply } = await converse(env, {
        model: founder ? (env.TELLO_PARTNER_MODEL || PARTNER_MODEL) : (env.TELLO_MODEL || CUSTOMER_MODEL),
        system, messages,
        tools: founder ? [SNAPSHOT_TOOL] : undefined,
        maxTokens: founder ? PARTNER_MAX_TOKENS : 800,
        effort: founder ? PARTNER_EFFORT : undefined,   // Haiku 4.5 rejects effort
      }));
    } catch (e) {
      return json({ error: 'model_unavailable', message: 'Tello could not answer just now. Please try again in a moment.' }, 502);
    }
    if (!reply) reply = "I'm sorry, I lost my words there. Could you ask me again?";

    if (containsDosageAdvice(reply)) {
      await logDosageRejection({ userId: user.id, facilityId: null, rejectedText: reply }, env).catch(() => {});
      return json({ reply: SAFE_DOSAGE_MESSAGE, mode, blocked: true, limit: credits.limit, remaining: credits.remaining });
    }

    const kept = att ? `[Shared ${isPdf ? 'a PDF' : 'a photo'}${att.name ? ': ' + String(att.name).slice(0, 80) : ''}] ${typed}`.trim() : message;
    const saved = mem.ok ? await remember(env, user.id, founder, [
      { role: 'user', content: kept }, { role: 'assistant', content: reply },
    ]).catch(() => false) : false;
    return json({ reply, mode, limit: credits.limit, remaining: credits.remaining, memory: saved, ...(noted ? { noted } : {}) });
  }

  return json({ error: 'Not found' }, 404);
}
