// Offline test of the preview route. DeepInfra and the edge cache are stubbed;
// everything else is the real Worker. Run: node test.mjs [input.wav]
// With an input WAV (e.g. real Kokoro output), that file stands in for the
// provider's response; otherwise a 24 kHz float tone is generated.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker, { readWav } from './index.js';

function toneWav({ rate = 24000, seconds = 1, amp = 0.5, float = true }) {
  const n = rate * seconds, bps = float ? 4 : 2;
  const buf = Buffer.alloc(44 + n * bps);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * bps, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(float ? 3 : 1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * bps, 28);
  buf.writeUInt16LE(bps, 32); buf.writeUInt16LE(bps * 8, 34);
  // Streamed-style header: data size 0xFFFFFFFF, which readWav must tolerate.
  buf.write('data', 36); buf.writeUInt32LE(0xffffffff, 40);
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin(2 * Math.PI * 220 * i / rate);
    float ? buf.writeFloatLE(v, 44 + i * 4) : buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

const input = process.argv[2] ? new Uint8Array(fs.readFileSync(process.argv[2])) : toneWav({});
let providerCalls = 0, lastBody = null, lastAuth = null, providerStatus = 200;
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://api.deepinfra.com/v1/openai/audio/speech');
  providerCalls++; lastBody = JSON.parse(init.body); lastAuth = init.headers.Authorization;
  if (providerStatus !== 200) return new Response('{"detail":"bad key"}', { status: providerStatus });
  return new Response(input, { status: 200, headers: { 'Content-Type': 'audio/wav' } });
};
const store = new Map();
globalThis.caches = { default: {
  match: async (k) => store.get(k.url)?.clone(),
  put: async (k, r) => { store.set(k.url, r); },
} };
const env = { DEEPINFRA_API_KEY: 'test-key', VOICE_MODEL: 'hexgrad/Kokoro-82M', VOICE_ID: 'af_heart' };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const get = async (path, e = env) => { const r = await worker.fetch(new Request('https://x' + path), e, ctx); await Promise.all(waits); return r; };

// 1. MP3, exact request to the provider
let r = await get('/api/tello/voice-preview');
assert.equal(r.status, 200, await r.clone().text());
assert.equal(r.headers.get('Content-Type'), 'audio/mpeg');
assert.deepEqual(lastBody, {
  model: 'hexgrad/Kokoro-82M', voice: 'af_heart', response_format: 'wav', speed: 1,
  input: "Hi, I'm Tello, the compliance assistant inside Title twenty-two. Every morning, I tell you what needs attention. Whose certification is about to lapse, and what's overdue.",
});
assert.equal(lastAuth, 'Bearer test-key');
const mp3 = new Uint8Array(await r.arrayBuffer());
fs.writeFileSync('out/preview.mp3', mp3);
console.log('mp3', mp3.length, 'bytes;', r.headers.get('X-Voice-Settings'));
console.log('   ', r.headers.get('X-Voice-Source'), '| peak before', r.headers.get('X-Voice-Peak-Before'), '|', r.headers.get('X-Voice-Seconds'), 's');

// 2. second play is served from cache, no provider call
r = await get('/api/tello/voice-preview');
assert.equal(r.headers.get('X-Voice-Cache'), 'hit'); assert.equal(providerCalls, 1);

// 3. WAV variant, normalised to 0.89 peak
r = await get('/api/tello/voice-preview?format=wav');
const w = readWav(new Uint8Array(await r.arrayBuffer()));
fs.writeFileSync('out/preview.wav', new Uint8Array(await (await get('/api/tello/voice-preview?format=wav')).arrayBuffer()));
const peak = w.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
assert.equal(w.rate, 24000); assert.ok(Math.abs(peak - 0.89) < 0.001, 'peak ' + peak);
console.log('wav peak', peak.toFixed(4), 'rate', w.rate);

// 4. wrong sample rate is refused, not resampled
store.clear();
const saved = input.slice();
input.set(toneWav({ rate: 22050 }).subarray(0, 44));
r = await get('/api/tello/voice-preview?fresh=1');
assert.equal(r.status, 502); console.log('22050 Hz ->', r.status, (await r.json()).error);
input.set(saved);

// 5. provider error surfaces, key never echoed
providerStatus = 401;
r = await get('/api/tello/voice-preview?fresh=1');
const body = await r.text();
assert.equal(r.status, 502); assert.ok(!body.includes('test-key')); console.log('provider 401 ->', r.status, JSON.parse(body).error);
providerStatus = 200;

// 6. missing secret named; health; no text parameter accepted
r = await get('/api/tello/voice-preview', { ...env, DEEPINFRA_API_KEY: undefined });
assert.equal(r.status, 500); assert.match(await r.text(), /DEEPINFRA_API_KEY/);
r = await get('/health'); assert.equal(r.status, 200);
const before = providerCalls;
r = await get('/api/tello/voice-preview?fresh=1&text=anything%20else');
assert.equal(lastBody.input.startsWith("Hi, I'm Tello"), true); assert.equal(providerCalls, before + 1);
r = await worker.fetch(new Request('https://x/api/tello/voice-preview', { method: 'POST', body: '{}' }), env, ctx);
assert.equal(r.status, 405);
console.log('all checks passed');
