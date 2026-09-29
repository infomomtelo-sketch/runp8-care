// "Talk to my assistant": a public page where a visitor talks to an AI that
// stands in for the owner, instead of a meeting (2026-09-29). The first one is
// Charrise, for Title22, at title22.app/meet. She speaks as the business and
// never names the person behind it.
//
// Routes (no sign-in; a visitor has no account):
//   POST /api/assistant/chat  {assistant, messages:[{role,content}], lang}
//   POST /api/assistant/lead  {assistant, kind, name, contact, business, message, lang, transcript}
//
// What keeps a public, unauthenticated model endpoint safe to leave open:
// - a per-visitor and a per-assistant daily limit, counted in the database
//   (assistant_take); the visitor key is a hash of the IP, never the IP;
// - the chat is not stored. The page keeps it; the server sees the last few
//   turns for one answer. Only a lead is kept, and only as the visitor's own
//   fields plus a short summary;
// - she says she is an AI, never a person, names nobody, and promises nothing.
//
// Adding another business is another ASSISTANTS entry with its own knowledge.

import { TITLE22_KNOWLEDGE } from './tello/title22-knowledge.js';
import { rest, callModel } from './tello.js';

// speaksFor: who she represents and who a lead goes to. For Title22 that is
// the business itself: the owner does not want his name on it (2026-09-29),
// and there is no team, so she names neither a person nor a team.
export const ASSISTANTS = {
  title22: {
    name: 'Charrise',
    business: 'Title22',
    speaksFor: 'Title22',
    whoRunsIt: 'Title22 is a small, independent business in California.',
    knowledge: TITLE22_KNOWLEDGE,
  },
  // Tello for visitors who have not signed in on title22.app/tello
  // (2026-09-29, the owner: no sign-up pressure). Same rules and limits as
  // Charrise; signing in is what gives her memory and the full Tello.
  tello: {
    name: 'Tello',
    business: 'Title22',
    speaksFor: 'Title22',
    whoRunsIt: 'Title22 is a small, independent business in California.',
    knowledge: TITLE22_KNOWLEDGE,
  },
};

const MODEL = 'claude-haiku-4-5-20251001';
export const LIMITS = { visitorChat: 40, assistantChat: 1500, visitorLead: 5 };
const MAX_TURNS = 16;       // turns of the chat she sees for one answer
const MAX_TURN_CHARS = 1500;
const MAX_TOTAL_CHARS = 12000;

export function assistantPrompt(a) {
  const to = a.speaksFor;
  return `You are ${a.name}, ${a.business}'s AI assistant. You take first conversations, so people can learn about ${a.business} and get a reply from ${to} without a meeting.

WHO YOU ARE
You are an AI assistant. Say so in your first reply, and whenever anyone asks or seems unsure. Never say or suggest that you are a person.
Do not name anyone behind ${a.business}, and do not describe a team or staff: there is none to describe. If someone asks who runs it or who they will hear from, say: "${a.whoRunsIt} I can pass your question on." Never invent a name, a person, a title or a team.

LANGUAGE
Reply in the language the visitor writes in. If they switch languages, switch with them. Keep names, prices and form numbers as they are.

WHAT YOU KNOW
Only the facts below about ${a.business}. If something is not in them, say you are not sure and offer to pass the question on. Never invent a feature, a number, a customer, a review or a result.${a.name === 'Tello' ? '' : ` The facts were written for Tello, the AI assistant inside the ${a.business} app: they apply to you too, and Tello is a real part of the product you can mention.`}

NO PROMISES
Never agree to anything on ${to}'s behalf: no price other than the published plans, no discount, no custom feature, no date, no call time, no contract, no refund. Say ${to} will confirm, and invite them to tap "Send to ${to}" below the chat.

WHEN THEY WANT A REPLY
When they want a demo, a price for many homes, a partnership, or anything you cannot answer, ask them to tap "Send to ${to}" and leave their name and how to reach them. Replies come by text or email. Do not ask for an email or phone number in the chat itself: the form is where it goes.

HEALTH INFORMATION
Do not ask for it. If someone shares a resident's name or health details, ask them kindly to leave those out. No medical, medication or dosage advice about anyone.

RULES AND INSPECTIONS
Never state a licensing requirement, a deadline or an inspection outcome as fact. For regulatory questions, say to check with their licensing analyst.

HOW YOU SOUND
Warm, plain and short: two to four sentences, because your reply may be read aloud. No markdown symbols, no headings. A list only if they ask for one. Answer, then stop; ask at most one question, and only when you need it.

THE FACTS ABOUT ${a.business.toUpperCase()}

${a.knowledge}`;
}

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Counts one use. true = allowed. If the counter itself fails, refuse: an open
// model endpoint must fail closed, not free.
async function take(env, key, limit) {
  try {
    const r = await rest(env, 'rpc/assistant_take', { method: 'POST', body: JSON.stringify({ p_key: key, p_limit: limit }) });
    if (!r.ok) return false;
    const left = await r.json();
    return typeof left === 'number' && left >= 0;
  } catch {
    return false;
  }
}

async function visitorKey(request, slug) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return 'v:' + slug + ':' + (await sha('assistant|' + ip)).slice(0, 32);
}

export function cleanTurns(messages) {
  if (!Array.isArray(messages)) return null;
  const turns = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_TURN_CHARS) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  // The API needs alternating roles: merge any two in a row.
  const out = [];
  for (const t of turns) {
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1].content += '\n' + t.content;
    else out.push({ ...t });
  }
  let total = out.reduce((n, t) => n + t.content.length, 0);
  while (total > MAX_TOTAL_CHARS && out.length > 1) { total -= out.shift().content.length; if (out[0] && out[0].role !== 'user') total -= out.shift().content.length; }
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

const textOf = (data) => (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
const plainText = (s) => String(s || '').replace(/\*\*|__|^#+\s*/gm, '').trim();

export async function handleAssistant(request, env, deps) {
  const { json, inputIsBlocked, DOSAGE_REFUSAL, containsDosageAdvice, SAFE_DOSAGE_MESSAGE } = deps;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const slug = typeof body.assistant === 'string' ? body.assistant : '';
  const a = ASSISTANTS[slug];
  if (!a) return json({ error: 'no_such_assistant' }, 404);
  const who = await visitorKey(request, slug);

  if (path === '/api/assistant/chat') {
    const turns = cleanTurns(body.messages);
    if (!turns) return json({ error: 'bad_messages', message: 'Say something first.' }, 400);
    const last = turns[turns.length - 1].content;
    if (inputIsBlocked(last)) return json({ reply: DOSAGE_REFUSAL, blocked: true });
    if (!(await take(env, who + ':chat', LIMITS.visitorChat))) {
      return json({ error: 'limit', message: `That is all the questions I can take from you today. Tap "Send to ${a.speaksFor}" for a reply.` }, 429);
    }
    if (!(await take(env, 'all:' + slug, LIMITS.assistantChat))) {
      return json({ error: 'busy', message: `I am very busy today. Tap "Send to ${a.speaksFor}" for a reply.` }, 429);
    }
    let reply;
    try {
      reply = plainText(textOf(await callModel(env, { model: env.ASSISTANT_MODEL || MODEL, max_tokens: 600, system: assistantPrompt(a), messages: turns })));
    } catch {
      return json({ error: 'model_unavailable', message: 'I could not answer just now. Please try again in a moment.' }, 502);
    }
    if (!reply) reply = 'Sorry, I lost my words there. Could you ask me again?';
    if (containsDosageAdvice(reply)) reply = SAFE_DOSAGE_MESSAGE;
    return json({ reply });
  }

  if (path === '/api/assistant/lead') {
    const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const kind = body.kind === 'wants-own' ? 'wants-own' : 'follow-up';
    const name = s(body.name, 120), contact = s(body.contact, 200);
    if (!name || contact.length < 3) return json({ error: 'missing', message: 'Please leave your name and how to reach you.' }, 400);
    if (!/@|\d{3}/.test(contact)) return json({ error: 'contact', message: 'Please leave an email or a phone number.' }, 400);
    if (!(await take(env, who + ':lead', LIMITS.visitorLead))) {
      return json({ error: 'limit', message: 'We already have your message. Thank you.' }, 429);
    }
    // A short summary for the owner, written from the chat, which is then
    // dropped. If the model is unavailable the lead is kept without one.
    let summary = null;
    const turns = cleanTurns(Array.isArray(body.transcript) ? body.transcript.concat([{ role: 'user', content: '(end of chat)' }]) : null);
    if (turns && turns.length > 1) {
      try {
        summary = plainText(textOf(await callModel(env, {
          model: env.ASSISTANT_MODEL || MODEL, max_tokens: 300,
          system: `Summarise this chat between a visitor and ${a.name}, ${a.business}'s AI assistant, for the business owner, in English, in at most three short lines: what they asked, what they need, and anything ${a.name} could not answer. No names of residents, no health details, no contact details.`,
          messages: turns,
        }))).slice(0, 2000) || null;
      } catch { summary = null; }
    }
    const row = {
      assistant: slug, kind, name, contact,
      business: s(body.business, 200) || null,
      message: s(body.message, 2000) || null,
      summary,
      language: s(body.lang, 20) || null,
    };
    const r = await rest(env, 'assistant_leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) return json({ error: 'save_failed', message: 'Sorry, that did not go through. Please try again.' }, 502);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}
