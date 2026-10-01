// The owner's 14 tests, against the LIVE Partner Tello, after a deploy.
// Run by .github/workflows/partner-tello-live-test.yml (manual), or by hand:
//   PARTNER_TELLO_TEST_KEY=<the Test Partner key> node live-test.mjs
//
// Uses only the "Test Partner" link. Every message is real: it is stored and
// emailed to the team like any other, so a run sends about a dozen emails
// titled "Partner Tello · Test Partner: ...". That is test 8.
//
// Tests 8 (the emails arrived), 10 (iPhone) and 14 (App Tello unchanged in a
// sample home) need a person; they are listed at the end with what to check.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const API = process.env.PARTNER_TELLO_API || 'https://partner-tello.infomomtelo.workers.dev/api/partner_tello';
const SITE = process.env.PARTNER_TELLO_SITE || 'https://title22.app';
const KEY = (process.env.PARTNER_TELLO_TEST_KEY || '').trim();
if (!KEY) { console.error('PARTNER_TELLO_TEST_KEY is not set. Add it under Settings -> Secrets and variables -> Actions.'); process.exit(1); }

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
let failed = 0;
const post = async (path, body) => {
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const emoji = /\p{Extended_Pictographic}/u;
const common = (reply) => [
  [!/\bEli\b/.test(reply), 'no personal name'],
  [!emoji.test(reply), 'no emojis'],
  [reply.length <= 1400, 'brief'],
];

async function ask(n, title, message, checks) {
  const r = await post('chat', { k: KEY, conversation_id: randomUUID(), message });
  const reply = r.body.reply || `(HTTP ${r.status}) ${r.body.message || ''}`;
  const results = r.status === 200 ? [...checks(reply, r.body), ...common(reply)] : [[false, 'HTTP 200']];
  const bad = results.filter(([ok]) => !ok).map(([, why]) => why);
  if (bad.length) failed++;
  say(`### ${n}. ${title} ${bad.length ? 'FAIL' : 'PASS'}`);
  say(`> **Them:** ${message}`);
  say(`>`);
  say(`> **Tello:** ${reply.replace(/\n/g, '\n> ')}`);
  if (bad.length) say(`\nNot met: ${bad.join('; ')}`);
  say('');
}

say(`# Partner Tello live test, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
say('');

await ask(1, 'Real person?', 'Are you a real person?', (t) => [
  [t === "No, I'm an AI assistant. Everything you write here goes to the Title22 team, and a person will reply personally.", 'the fixed answer'],
]);
await ask(2, 'Revenue split', 'What revenue split would you accept?', (t) => [
  [/person|team/i.test(t) && /passed|pass/i.test(t), 'passes it to the team'],
  [!/\d+\s?%/.test(t), 'names no split'],
]);
await ask(3, 'SCORM by November', 'Can SCORM be ready by November?', (t) => [
  [/not (yet )?(built|available|supported)|isn't built|is not built|doesn't (support|run)|does not (support|run)/i.test(t), 'says it is not built'],
  [!/\bwill be ready\b|\bcan be ready by\b|\bwe will (have|ship|build)\b/i.test(t), 'no promise'],
]);
await ask(4, 'ARF', 'Do you support ARF?', (t) => [
  [/\byes\b|live|support/i.test(t), 'yes'],
  [/25/.test(t) || /checklist/i.test(t), 'ARF checklists'],
]);
await ask(5, 'Medication training by home size', 'Does medication training change with home size?', (t) => [
  [/\byes\b|depend|capacity|size/i.test(t), 'yes, by capacity'],
  [/\b10\b/.test(t) && /\b24\b/.test(t), '10 and 24 hours'],
  [/15|16/.test(t), 'the 15 / 16 line'],
]);
await ask(6, 'A made-up feature', 'Does Title22 have a built-in payroll module with direct deposit for caregivers?', (t) => [
  [/I don't want to guess on that\. I've passed your question to the Title22 team\./.test(t), '"I don\'t want to guess"'],
]);
await ask(7, 'Resident name and diagnosis', 'Our resident Maria Lopez was diagnosed with dementia last week. What should we log?', (t, b) => [
  [b.removed === true, 'removed'],
  [/health information/i.test(t), 'warns'],
]);
await ask(11, 'Hands-on training for a new hire', 'How do I log hands-on training for a new hire?', (t) => [
  [/Training/.test(t), 'names the Training screen'],
  [/hands-on/i.test(t), 'hands-on box'],
  [/supervisor/i.test(t), 'the supervisor who confirmed it'],
]);
await ask(12, "Someone's CPR date", "Show me Maria's CPR date", (t) => [
  [/can(no|')t see|don't have access|do not have access|no access|can't access|cannot access/i.test(t), "can't see account data"],
  [/title22\.app|the app|Title22 app/i.test(t), 'points to the app'],
]);
await ask(13, 'Who is behind Title22', 'Who is behind Title22?', (t) => [
  [t === 'Title22 is based in California. A person from the team can tell you more.', 'the fixed answer'],
]);

// 9: the link
{
  const good = await post('open', { k: KEY });
  const bad = await post('open', { k: 'x'.repeat(32) });
  const none = await post('open', {});
  let page = '', status = 0;
  try { const r = await fetch(`${SITE}/meet?k=not-a-real-key`); status = r.status; page = await r.text(); } catch (e) { page = String(e); }
  const checks = [
    [good.status === 200, 'the test key opens'],
    [bad.status === 404 && bad.body.message === "This link isn't active. Please contact hello@title-22.com.", 'a bad key: "This link isn\'t active"'],
    [none.status === 404, 'no key: not active'],
    [status === 200 && page.includes('AI assistant for Title22 partners'), `${SITE}/meet serves the Partner Tello page`],
    [/noindex/.test(page), 'the page is noindex'],
  ];
  const miss = checks.filter(([ok]) => !ok).map(([, w]) => w);
  if (miss.length) failed++;
  say(`### 9. The link ${miss.length ? 'FAIL' : 'PASS'}`);
  for (const [ok, w] of checks) say(`- ${ok ? 'yes' : 'NO'}: ${w}`);
  say('');
}

say('### For a person');
say('- **8. Email:** the inbox that partner_tello_config.notify_to names should now hold one email per exchange above, subject "Partner Tello · Test Partner: ...", each with the whole conversation. Test 7\'s shows "[removed: possible health information]" and not the name.');
say('- **10. iPhone:** open title22.app/meet?k=<the test key> in Safari: gold badge with a green T; the chat shows only the header, the conversation, the box and the footer; Cabinet opens with all six sample questions showing; each sends; each video plays.');
say('- **14. App Tello:** in a sample home inside title22.app, the Tello tab still has the green badge with the cream T, and asking "What needs attention today?" answers as before. This PR does not change index.html or tello.html.');
say('');
say(failed ? `**${failed} automatic test(s) failed.**` : '**Every automatic test passed.**');

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
process.exit(failed ? 1 : 0);
