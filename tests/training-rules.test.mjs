// node tests/training-rules.test.mjs
// The training arithmetic: the annual 20 hours and the 8-hour dementia gap,
// initial training, and administrator renewal hours. Also checks the
// migration's stored numbers match training-rules.js, so the two cannot drift.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const T = require('../training-rules.js');
const here = path.dirname(fileURLToPath(import.meta.url));

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

const row = (training_date, hours, topic_area, extra = {}) => ({ training_date, hours, topic_area, ...extra });
const HIRE = '2025-03-10';

// ── C. Annual: 20 hours with 8 of dementia and 4 postural/hospice ─────────
{
  const today = '2026-06-01';               // period 2026-03-10 .. 2027-03-09
  // 20 hours, but only 5 of dementia: the total is met and the dementia is not.
  const rows = [
    row('2026-04-01', 5, 'dementia'),
    row('2026-05-01', 4, 'postural_hospice'),
    row('2026-05-15', 11, 'residents_rights'),
  ];
  const s = T.annualStatus(rows, HIRE, today);
  eq(s.start, '2026-03-10', 'annual period starts on the hire anniversary');
  eq(s.due, '2027-03-09', 'annual due the day before the next anniversary');
  eq(s.hours.total, 20, 'annual total counts all 20 hours');
  eq(s.hours.dementia, 5, 'annual dementia counts only dementia-tagged hours');
  ok(s.status !== 'complete', '20 hours with 5 dementia is NOT complete');
  eq(s.gaps, ['3 more dementia care hours (8 needed)'], 'the only gap is 3 dementia hours');

  // Exactly 20 with 8 dementia and 4 postural: complete.
  const full = [row('2026-04-01', 8, 'dementia'), row('2026-05-01', 4, 'postural_hospice'), row('2026-05-15', 8, 'emergency')];
  const f = T.annualStatus(full, HIRE, today);
  eq(f.status, 'complete', '20 hours incl. 8 dementia and 4 postural is complete');
  eq(f.gaps, [], 'no gaps when complete');

  // 8 dementia but only 12 hours total: short on the total, not on dementia.
  const short = [row('2026-04-01', 8, 'dementia'), row('2026-05-01', 4, 'postural_hospice')];
  eq(T.annualStatus(short, HIRE, today).gaps, ['8 more hours to reach 20'], '12 hours with the minimums met: 8 more hours');

  // Hours from last year's period do not count toward this one.
  const old = [...full.map(r => ({ ...r, training_date: '2026-01-15' }))];
  const o = T.annualStatus(old, HIRE, today);
  eq(o.hours.total, 0, 'hours before the anniversary belong to the previous period');
  eq(o.previous && o.previous.hours.total, 20, 'and are reported in the previous period');

  // Training in the first four weeks after hire is initial, not annual.
  const early = [row('2025-03-20', 8, 'dementia')];
  eq(T.annualStatus(early, HIRE, '2025-06-01').hours.dementia, 0, 'first-four-weeks hours do not count as annual');

  // Legacy rows (category only) still count: dementia and special_care.
  const legacy = [{ training_date: '2026-04-01', hours: 8, category: 'dementia' }, { training_date: '2026-04-02', hours: 4, category: 'special_care' }, { training_date: '2026-04-03', hours: 8, category: 'general' }];
  eq(T.annualStatus(legacy, HIRE, today).status, 'complete', 'legacy category rows map onto the new topics');

  // Administrator CE rows never count toward a caregiver's annual 20.
  eq(T.annualStatus([row('2026-04-01', 20, 'dementia', { counts_toward: 'admin_ce' })], HIRE, today).hours.total, 0, 'admin CE rows are not direct-care hours');

  eq(T.annualStatus([], null, today).status, 'needs_hire_date', 'no hire date: says so');
}

// ── B. Initial: 40 hours, 16 hands-on, 12 dementia, 4 postural ───────────
{
  const rows = [
    row('2025-03-05', 10, 'dementia'),                        // before hire counts
    row('2025-03-11', 16, 'personal_care', { hands_on: true }),
    row('2025-03-20', 4, 'postural_hospice'),
    row('2025-04-01', 8, 'medication'),
  ];
  const s = T.initialStatus(rows, HIRE, '2025-04-01');
  eq(s.due, '2025-04-07', 'initial training due 4 weeks after hire');
  eq(s.hours.total, 38, 'initial counts 38 hours');
  eq(s.hours.hands_on, 16, 'hands-on counted separately');
  eq(s.gaps, ['2 more hours to reach 40', '2 more dementia care hours (12 needed)'], 'initial gaps: 2 hours and 2 dementia');
  eq(T.initialStatus(rows, HIRE, '2025-05-01').status, 'overdue', 'past four weeks and short: overdue');
  eq(T.initialStatus([...rows, row('2025-04-02', 2, 'dementia')], HIRE, '2025-04-03').status, 'complete', '40 with 12 dementia, 16 hands-on, 4 postural: complete');
}

// ── A. Administrator renewal: 40 in 2 years, 20 live, ≤20 self-paced ─────
{
  const ce = (d, h, topic, delivery) => row(d, h, topic, { counts_toward: 'admin_ce', delivery });
  const exp = '2027-01-31';
  const rows = [
    ce('2025-06-01', 8, 'dementia', 'live'),
    ce('2025-07-01', 4, 'laws_regs', 'live'),
    ce('2025-08-01', 8, 'other', 'live'),
    ce('2026-01-01', 25, 'other', 'self_paced'),
  ];
  const s = T.adminCeStatus(rows, exp, '2026-06-01');
  eq(s.start, '2025-01-31', 'renewal window is the 2 years before expiry');
  eq(s.hours.live, 20, 'live hours counted');
  eq(s.hours.self_paced, 25, 'self-paced hours logged');
  eq(s.hours.counted, 40, 'only 20 self-paced count: 20 live + 20 = 40');
  ok(s.warnings.some(w => /25 self-paced hours logged: only 20 can count/.test(w)), 'warns when self-paced passes 20');
  eq(s.gaps, [], 'minimums met: no gaps');
  eq(s.status, 'complete', 'complete');

  const noLive = [ce('2025-06-01', 8, 'dementia', 'self_paced'), ce('2025-07-01', 4, 'laws_regs', 'self_paced'), ce('2025-08-01', 28, 'other', 'self_paced')];
  const n = T.adminCeStatus(noLive, exp, '2026-06-01');
  ok(n.gaps.includes('20 more live hours, in person or live-stream (20 needed)'), 'all self-paced: 20 live hours short');
  ok(n.gaps.includes('20 more countable hours to reach 40'), 'and only 20 of 40 count');
  eq(T.adminCeStatus([], null).status, 'needs_expiry', 'no expiry: says so');
  eq(T.adminCeStatus(rows, '2025-07-15', '2026-06-01').status, 'overdue', 'past expiry and short (12 of 40 in the window): overdue');
}

// ── D. Hours per topic ───────────────────────────────────────────────────
{
  const h = T.hoursByTopic([row('2026-01-01', 2, 'dementia'), row('2026-01-02', 1.5, 'dementia'), row('2026-01-03', 1, null)]);
  eq(h.dementia, 3.5, 'hours summed per topic');
  eq(h.untagged, 1, 'untagged hours kept apart');
  ok(T.TOPICS.some(t => t.key === 'lgbt_cultural') && T.TOPICS.some(t => t.key === 'emergency'), 'topic list includes the requested areas');
}

// ── RCFE only ────────────────────────────────────────────────────────────
ok(T.appliesTo(T.RULES.annual, 'rcfe') && T.appliesTo(T.RULES.annual, null), 'RCFE items apply to RCFE (and to an untyped facility)');
ok(!T.appliesTo(T.RULES.annual, 'arf') && !T.appliesTo(T.RULES.admin_ce, 'arf'), 'RCFE items do not apply to ARF');

// ── The migration stores the same numbers ────────────────────────────────
{
  const sqlPath = path.join(here, '..', 'migrations', '2026-09-29_title22_training_requirements.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  for (const r of Object.values(T.RULES)) {
    const m = sql.match(new RegExp("'" + r.code + "'[^;]*?rule_json\\s*=>\\s*'([^']+)'", 's')) || sql.match(new RegExp("\\('" + r.code + "',[\\s\\S]*?'(\\{[^']+\\})'::jsonb", 's'));
    ok(!!m, 'migration has a row for ' + r.code);
    if (!m) continue;
    const j = JSON.parse(m[1]);
    eq(j.total_hours, r.total_hours, r.code + ': total hours match');
    eq(j.minimums, r.minimums, r.code + ': minimums match');
    if (r.max_self_paced_hours) eq(j.max_self_paced_hours, r.max_self_paced_hours, r.code + ': self-paced cap matches');
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
