// title22-voice — Tello's voice (B1, step 0: the match test).
//
// The voice has to match the Tello video, which was made with kokoro-onnx
// (kokoro-v1.0.int8.onnx + voices-v1.0.bin). The settings, all fixed here and
// none taken from the request:
//   model   Kokoro-82M v1.0 (DeepInfra "hexgrad/Kokoro-82M")
//   voice   af_heart, single voice, no blend
//   lang    en-us — Kokoro takes the language from the voice's first letter,
//           'a' = American English, so af_heart IS en-us; the OpenAI-shaped
//           endpoint has no separate language field to set
//   speed   1.0
//   rate    24 kHz (Kokoro's native rate; checked, never resampled)
//   level   peak-normalised to 0.89 (about -1 dBFS). No EQ, reverb or pitch.
//   output  MP3, 160 kbps CBR, mono
//
// Why the Worker does the last two itself: DeepInfra's speech endpoint takes a
// response_format but not a bitrate, and it does not normalise. So we ask for
// WAV, measure the peak, scale to 0.89, and encode the MP3 here at exactly
// 160 kbps. Nothing else is done to the sound.
//
// Two routes cost money. POST /api/tello/briefing-voice is below, with its own
// notes. GET /api/tello/voice-preview: It speaks ONE fixed
// sentence and takes no text from the caller, so it cannot be used as a free
// text-to-speech service. The result is kept in the edge cache, so playing it
// again, or on a second phone, does not call DeepInfra again.
//   ?format=wav   the same audio, normalised, as 16-bit WAV — for comparing
//                 side by side with tello-voice-reference.wav without MP3 in
//                 the way.
//   ?fresh=1      skip the cache and synthesise again.
// GET /health reports which bindings are present (never their values).

import { Mp3Encoder } from '@breezystack/lamejs';
import { prepare } from './speech.js';

const MATCH_TEST_TEXT =
  "Hi, I'm Tello, the compliance assistant inside Title twenty-two. " +
  'Every morning, I tell you what needs attention. ' +
  "Whose certification is about to lapse, and what's overdue.";

const SAMPLE_RATE = 24000;
const PEAK_TARGET = 0.89;
const MP3_KBPS = 160;
const SPEED = 1.0;
// Bump to invalidate every cached preview (e.g. after changing the pipeline).
const PIPELINE_VERSION = 'v1';

const REQUIRED_BINDINGS = ['DEEPINFRA_API_KEY', 'VOICE_MODEL', 'VOICE_ID'];
const BRIEFING_BINDINGS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ALLOWED_ORIGIN', 'VOICE_CACHE'];
// New renders per user per day. A replay from the cache does not count.
const DAILY_LIMIT = 10;
// The day a limit resets is the facility's day, not UTC's.
const LIMIT_TZ = 'America/Los_Angeles';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------- provider --
// DeepInfra's OpenAI-compatible speech endpoint. Returns audio bytes.
async function synthesise(text, env) {
  const res = await fetch('https://api.deepinfra.com/v1/openai/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.DEEPINFRA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.VOICE_MODEL,
      input: text,
      voice: env.VOICE_ID,
      response_format: 'wav',
      speed: SPEED,
    }),
  });
  if (!res.ok) {
    // The body is DeepInfra's error message; it never contains our key.
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    const err = new Error(`DeepInfra answered ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return new Uint8Array(await res.arrayBuffer());
}

// --------------------------------------------------------------------- wav --
// Reads a RIFF/WAVE file into mono Float32 samples. PCM 16/24/32-bit and
// IEEE float 32 are accepted. A data chunk whose size is 0 or 0xFFFFFFFF (how
// streamed WAVs are written) is read to the end of the buffer.
export function readWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Provider did not return a WAV file (first bytes: ' + tag(0) + ')');
  }
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    let size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(body + 24, true);
    } else if (id === 'data') {
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      dataOff = body;
      dataLen = size;
      break;
    }
    off = body + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('WAV has no fmt or data chunk');
  const { format, channels, rate, bits } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bps;
      let v;
      if (format === 3 && bits === 32) v = dv.getFloat32(p, true);
      else if (format === 1 && bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (format === 1 && bits === 24) {
        let x = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
        if (x & 0x800000) x |= ~0xffffff;
        v = x / 8388608;
      } else if (format === 1 && bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else throw new Error(`Unsupported WAV encoding: format ${format}, ${bits}-bit`);
      sum += v;
    }
    out[i] = sum / channels;
  }
  return { samples: out, rate, channels, bits, format };
}

// Scales so the loudest sample sits at PEAK_TARGET. Returns 16-bit PCM.
export function normalise(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) throw new Error('Provider returned silence');
  const gain = PEAK_TARGET / peak;
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.round(samples[i] * gain * 32767);
  }
  return { pcm, peakIn: peak, gain };
}

export function encodeMp3(pcm, rate) {
  const enc = new Mp3Encoder(1, rate, MP3_KBPS);
  const parts = [];
  const BLOCK = 1152;
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + BLOCK));
    if (buf.length) parts.push(buf);
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function writeWav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

// Provider WAV -> the two deliverables, plus the facts that prove the settings.
export function render(wavBytes) {
  const wav = readWav(wavBytes);
  if (wav.rate !== SAMPLE_RATE) {
    // Refuse rather than resample: a different rate means a different model
    // build from the one the video used, which is exactly what this test is for.
    throw new Error(`Provider audio is ${wav.rate} Hz, not ${SAMPLE_RATE} Hz`);
  }
  const { pcm, peakIn, gain } = normalise(wav.samples);
  return {
    mp3: encodeMp3(pcm, wav.rate),
    wav: writeWav(pcm, wav.rate),
    facts: {
      source: `${wav.rate} Hz, ${wav.channels} ch, ${wav.bits}-bit ${wav.format === 3 ? 'float' : 'PCM'}`,
      seconds: +(wav.samples.length / wav.rate).toFixed(2),
      peak_before: +peakIn.toFixed(4),
      gain: +gain.toFixed(4),
    },
  };
}

async function preview(request, env, ctx) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'wav' ? 'wav' : 'mp3';
  const cache = caches.default;
  // Cache key carries every setting, so a change to any of them is a new entry.
  const key = new Request(
    `https://title22-voice.cache/${PIPELINE_VERSION}/${encodeURIComponent(env.VOICE_MODEL)}/${env.VOICE_ID}/${SPEED}/${MP3_KBPS}/${format}`,
  );
  if (url.searchParams.get('fresh') !== '1') {
    const hit = await cache.match(key);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('X-Voice-Cache', 'hit');
      return new Response(hit.body, { status: 200, headers: h });
    }
  }

  let out;
  try {
    out = render(await synthesise(MATCH_TEST_TEXT, env));
  } catch (e) {
    console.error('voice-preview failed:', e.message, e.detail || '');
    return json({ error: e.message, provider_detail: e.detail || undefined }, 502);
  }

  const body = format === 'wav' ? out.wav : out.mp3;
  const headers = {
    ...CORS,
    'Content-Type': format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    'Content-Disposition': `inline; filename="tello-match-test.${format}"`,
    'Cache-Control': 'public, max-age=86400',
    'X-Voice-Settings': `model=${env.VOICE_MODEL}; voice=${env.VOICE_ID}; lang=en-us; speed=${SPEED}; rate=${SAMPLE_RATE}; peak=${PEAK_TARGET}; mp3=${MP3_KBPS}kbps`,
    'X-Voice-Source': out.facts.source,
    'X-Voice-Seconds': String(out.facts.seconds),
    'X-Voice-Peak-Before': String(out.facts.peak_before),
    'X-Voice-Cache': 'miss',
  };
  const res = new Response(body, { status: 200, headers });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------------------------------------------------------------- briefing --
// POST /api/tello/briefing-voice   body: {"text": "<the briefing as shown>"}
//   Authorization: Bearer <the user's Supabase access token>
//
// What this can and cannot promise. It proves WHO is asking (Supabase checks
// the token) and bounds what they can spend: 1,200 characters, 10 new renders
// a day, about a cent a day at DeepInfra's list price. It does NOT prove the
// text is that user's own briefing -- the briefing is written in the browser,
// so no server has it to compare against. Doing that would mean the title22-ai
// Worker signing each briefing, and that Worker is dashboard-deployed; the
// owner agreed on 2026-09-27 to take the bounded version instead.
//
// Only the text goes to DeepInfra: no user id, facility, email or token.
function briefingCors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'X-Voice-Cache, X-Voice-Remaining, X-Voice-Chars',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function briefingJson(env, data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...briefingCors(env), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function userFromToken(token, env) {
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function limitDay(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMIT_TZ }).format(now);
}

export async function briefing(request, env) {
  const user = await userFromToken((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env);
  if (!user) return briefingJson(env, { error: 'Sign in to hear the briefing.' }, 401);

  let text;
  try { ({ text } = await request.json()); } catch (e) { text = null; }
  if (typeof text !== 'string' || !text.trim()) return briefingJson(env, { error: 'No briefing text.' }, 400);
  // Refuse obviously oversized bodies before doing any work; prepare() caps
  // what is actually spoken at 1,200 characters.
  if (text.length > 20000) return briefingJson(env, { error: 'Briefing too long.' }, 413);

  const spoken = prepare(text);
  if (!spoken) return briefingJson(env, { error: 'Nothing to read aloud.' }, 400);

  const key = 'voice/' + (await sha256Hex(`${PIPELINE_VERSION}|${env.VOICE_MODEL}|${env.VOICE_ID}|${SPEED}|${spoken}`)) + '.mp3';
  const audioHeaders = (cache, remaining) => ({
    ...briefingCors(env),
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'private, max-age=86400',
    'X-Voice-Cache': cache,
    'X-Voice-Chars': String(spoken.length),
    ...(remaining != null ? { 'X-Voice-Remaining': String(remaining) } : {}),
  });

  const hit = await env.VOICE_CACHE.get(key);
  if (hit) return new Response(hit.body, { headers: audioHeaders('hit') });

  // Count BEFORE synthesising, so a burst cannot all slip under the limit.
  // R2 is not transactional; two requests in the same instant could both read
  // 9. At 10 a day that is a rounding error, not a hole.
  const rateKey = `rate/${limitDay()}/${user.id}`;
  const rateObj = await env.VOICE_CACHE.get(rateKey);
  const used = rateObj ? parseInt(await rateObj.text(), 10) || 0 : 0;
  if (used >= DAILY_LIMIT) {
    return briefingJson(env, { error: `Tello has read ${DAILY_LIMIT} new briefings aloud today. The text is still here.`, limit: DAILY_LIMIT }, 429);
  }
  await env.VOICE_CACHE.put(rateKey, String(used + 1), { httpMetadata: { contentType: 'text/plain' } });

  let out;
  try {
    out = render(await synthesise(spoken, env));
  } catch (e) {
    // Logged with the user id and the length only -- never the text.
    console.error('briefing-voice failed', { user: user.id, chars: spoken.length, error: e.message, detail: e.detail || '' });
    // Our failure, not theirs: give the render back.
    await env.VOICE_CACHE.put(rateKey, String(used), { httpMetadata: { contentType: 'text/plain' } }).catch(() => {});
    return briefingJson(env, { error: 'Tello could not read this aloud right now.' }, 502);
  }
  await env.VOICE_CACHE.put(key, out.mp3, {
    httpMetadata: { contentType: 'audio/mpeg' },
    customMetadata: { seconds: String(out.facts.seconds) },
  });
  return new Response(out.mp3, { headers: audioHeaders('miss', DAILY_LIMIT - used - 1) });
}

export default {
  async fetch(request, env, ctx) {
    const missing = REQUIRED_BINDINGS.filter((k) => !env[k]);
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS' && pathname !== '/api/tello/briefing-voice') return new Response(null, { headers: CORS });

    if (pathname === '/health') {
      const all = [...missing, ...BRIEFING_BINDINGS.filter((k) => !env[k])];
      return json({ status: all.length ? 'misconfigured' : 'ok', missing: all }, all.length ? 500 : 200);
    }
    if (pathname === '/api/tello/briefing-voice') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: briefingCors(env) });
      if (request.method !== 'POST') return briefingJson(env, { error: 'Method not allowed' }, 405);
      const gone = [...missing, ...BRIEFING_BINDINGS.filter((k) => !env[k])];
      if (gone.length) return briefingJson(env, { error: 'Missing binding: ' + gone.join(', ') }, 500);
      return briefing(request, env);
    }
    if (pathname !== '/api/tello/voice-preview') return json({ error: 'Not found' }, 404);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    // Named in the body, because the body is what the person testing sees.
    if (missing.length) return json({ error: 'Missing binding: ' + missing.join(', ') }, 500);
    return preview(request, env, ctx);
  },
};
