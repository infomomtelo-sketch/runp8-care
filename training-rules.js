/* Title22 training requirements for RCFEs — the numbers, as data, and the
 * arithmetic that checks a person's logged hours against them.
 *
 * Loaded by index.html (<script src="/training-rules.js">) and by
 * tests/training-rules.test.mjs. Pure: no DOM, no database, no network.
 *
 * SOURCES, and how each number was checked (2026-09-29). This environment
 * could not reach leginfo.legislature.ca.gov, so the statute text was not
 * read directly. Every number below was instead confirmed against CDSS's own
 * publications, which cite the statute section by section:
 *   - "Reference Guide to RCFE Administrator, Staff, and Volunteer Training
 *     Requirements", CDSS Community Care Licensing, updated January 2025
 *     (cdss.ca.gov/Portals/9/CCLD/RCFE-Training-Requirements.pdf).
 *   - CDSS Administrator Certification renewal page (cdss.ca.gov,
 *     .../administrator-information/renewal), read 2026-09-29.
 *   - PIN 23-14-CCLD (live-stream counts as live; up to half self-paced).
 *   - 22 CCR §87407 and §87411, current text from the CDSS regulation files
 *     (rcfeman3.docx, manual letters through CCL-25-02).
 * If the law changes, change it here. index.html and the migration read from
 * the same figures (the migration's are checked against these by the test).
 *
 * RULE OF THE PRODUCT: these describe what the app tracks. The app never tells
 * anyone they are compliant, and never states a requirement beyond what is
 * written here with its source.
 */
(function (root) {
  'use strict';

  // D. Topic areas a training entry can be tagged with.
  // aging..dementia follow 22 CCR §87411(c)(3)(A)-(F). postural_hospice and
  // laws_regs exist because a minimum below is counted in them.
  const TOPICS = [
    { key: 'aging',             label: 'Aging, physical limitations and needs of the elderly' },
    { key: 'personal_care',     label: 'Personal care services (ADLs)' },
    { key: 'infection_control', label: 'Infectious disease and infection control' },
    { key: 'residents_rights',  label: "Residents' rights" },
    { key: 'medication',        label: 'Medication policies and procedures' },
    { key: 'psychosocial',      label: 'Psychosocial needs' },
    { key: 'dementia',          label: 'Dementia care' },
    { key: 'postural_hospice',  label: 'Postural supports, restricted health conditions and hospice care' },
    { key: 'emergency',         label: 'Fire safety and emergency response' },
    { key: 'elder_abuse',       label: 'Recognizing and reporting elder abuse' },
    { key: 'lgbt_cultural',     label: 'Cultural competency and sensitivity for the aging LGBT community' },
    { key: 'first_aid',         label: 'First aid' },
    { key: 'laws_regs',         label: 'Laws, regulations, policies and procedural standards' },
    { key: 'other',             label: 'Other' },
  ];

  const RULES = {
    // A. Administrator certificate renewal (RCFE).
    admin_ce: {
      code: 'rcfe_admin_ce',
      facility_types: ['rcfe', 'cbrc'],
      label: 'Administrator certificate renewal: continuing education',
      total_hours: 40,
      period_months: 24,
      due: 'certificate_expiry',
      minimums: { dementia: 8, laws_regs: 4 },
      max_self_paced_hours: 20,   // no more than half may be self-paced
      min_live_hours: 20,         // in person or live-stream
      // A certificate holder with a valid Nursing Home Administrator licence
      // needs 20, not 40 (22 CCR §87407(g); CDSS renewal page). Not modelled.
      citation: 'HSC §1569.616(f); 22 CCR §87407',
    },
    // B. Direct care staff: initial training (RCFE).
    initial: {
      code: 'rcfe_dcs_initial',
      facility_types: ['rcfe', 'cbrc'],
      label: 'Direct care staff: 40 hours of initial training',
      total_hours: 40,
      before_independent: { hours: 20, dementia: 6, postural_hospice: 4 },
      within_days_of_hire: 28,    // "within the first four weeks of employment"
      minimums: { hands_on: 16, dementia: 12, postural_hospice: 4 },
      // The two phases, as the CDSS reference guide sets them out: 20 hours
      // (6 dementia, 4 postural / restricted / hospice) before working
      // independently with residents; the remaining 20 (6 dementia) within
      // the first four weeks. Hands-on: 16 of the 40, no phase of its own.
      phases: {
        phase1: { hours: 20, minimums: { dementia: 6, postural_hospice: 4 }, when: 'before working with residents on their own' },
        phase2: { hours: 20, minimums: { dementia: 6 }, when: 'within the first 4 weeks' },
      },
      // Topics the training must include, with no hours set in the law
      // (HSC §1569.625(c); 22 CCR §87411(c)(3)(A)-(F)). Checked as covered or
      // not. First aid is §87411(c)(1) and is read from the staff record too.
      // The LGBT cultural competency component is part of HSC §1569.625(c)(1).
      // Not verified, so NOT enforced: hour minimums for LGBT (1), personal
      // care (3) and physical limitations (2). No source reachable from here
      // states them; they appear in a training partner's curriculum.
      required_topics: ['aging', 'personal_care', 'infection_control', 'residents_rights', 'medication', 'psychosocial', 'emergency', 'lgbt_cultural', 'first_aid'],
      citation: 'HSC §§1569.625, 1569.626, 1569.696; 22 CCR §87411(c)',
    },
    // Elder and dependent adult abuse reporting: all staff, within 60 days of
    // the first day of employment (WIC §15655(a)).
    elder_abuse: { code: 'elder_abuse_training', within_days_of_hire: 60, citation: 'WIC §15655(a)' },
    // Direct care staff who assist residents with self-administration of
    // medication (HSC §1569.69(a)), by the home's licensed capacity. Hands-on
    // shadowing comes before the person assists; the other hours within 2
    // weeks (15 or fewer) or 4 weeks (16 or more). The course must cover
    // antipsychotics and the adverse effects of psychotropic drugs. Then 8
    // hours every year after (HSC §1569.69(b)).
    medication: {
      code: 'rcfe_dcs_medication',
      facility_types: ['rcfe', 'cbrc'],
      small: { max_capacity: 15, total_hours: 10, hands_on: 6, other: 4, other_within_days: 14 },
      large: { min_capacity: 16, total_hours: 24, hands_on: 16, other: 8, other_within_days: 28 },
      annual_hours: 8,
      must_cover: 'antipsychotics and the adverse effects of psychotropic drugs used to control the behavior of persons with dementia',
      citation: 'HSC §1569.69(a), (b); 22 CCR §87411(c)(3)(D)',
    },
    // C. Direct care staff: annual training (RCFE).
    annual: {
      code: 'rcfe_dcs_annual',
      facility_types: ['rcfe', 'cbrc'],
      label: 'Direct care staff: 20 hours of annual training',
      total_hours: 20,
      period_months: 12,
      due: 'hire_anniversary',
      minimums: { dementia: 8, postural_hospice: 4 },
      citation: 'HSC §§1569.625, 1569.626, 1569.696; 22 CCR §87411(c)',
    },
  };

  const DAY = 86400000;

  // Calendar dates only. 'YYYY-MM-DD' parsed as local noon, so a timezone can
  // never move a training onto the day before.
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12);
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12);
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addMonths(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0, 12).getDate();
    r.setDate(Math.min(d.getDate(), last));
    return r;
  }
  function round(n) { return Math.round(n * 100) / 100; }

  // One staff_trainings row, in the shape the arithmetic reads. Rows logged
  // before topic_area / hands_on / delivery existed carry only `category`; it
  // maps across where it can. 'general' maps to 'other': there is no general
  // minimum in the law (an earlier version of the app invented an 8-hour one).
  function normalise(row) {
    const legacy = row && row.category;
    let topic = row && row.topic_area;
    if (!topic && legacy === 'dementia') topic = 'dementia';
    if (!topic && legacy === 'special_care') topic = 'postural_hospice';
    if (!topic && legacy === 'general') topic = 'other';
    const handsOn = row && (row.hands_on === true || legacy === 'hands_on');
    const counts = row && row.counts_toward === 'admin_ce' ? 'admin_ce' : 'direct_care';
    const delivery = row && (row.delivery === 'live' || row.delivery === 'self_paced') ? row.delivery : null;
    const phase = row && (row.phase === 'phase1' || row.phase === 'phase2') ? row.phase : null;
    return {
      date: toDate(row && row.training_date),
      hours: Math.max(0, parseFloat(row && row.hours) || 0),
      topic: topic || null,
      hands_on: !!handsOn,
      delivery,
      counts_toward: counts,
      phase,
      supervisor: (row && row.supervisor) || null,
    };
  }

  function sumBy(entries, pred) { return round(entries.filter(pred).reduce((a, e) => a + e.hours, 0)); }

  function hoursByTopic(rows) {
    const out = {};
    TOPICS.forEach(t => { out[t.key] = 0; });
    out.untagged = 0;
    rows.map(normalise).forEach(e => {
      if (e.topic && out[e.topic] !== undefined) out[e.topic] = round(out[e.topic] + e.hours);
      else out.untagged = round(out.untagged + e.hours);
    });
    return out;
  }

  // B. Initial training for one direct care staff member.
  // Counts direct-care entries dated on or before hire + 4 weeks (training
  // taken before the hire date counts too). Everything later is annual.
  function initialStatus(rows, hireDate, today, opts) {
    const R = RULES.initial;
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code: R.code, status: 'needs_hire_date', gaps: ['Add a hire date to track initial training.'] };
    const dueBy = new Date(hire.getTime() + R.within_days_of_hire * DAY);
    const es = rows.map(normalise).filter(e => e.counts_toward === 'direct_care' && e.date && e.date <= dueBy);
    const s = {
      total: sumBy(es, () => true),
      hands_on: sumBy(es, e => e.hands_on),
      dementia: sumBy(es, e => e.topic === 'dementia'),
      postural_hospice: sumBy(es, e => e.topic === 'postural_hospice'),
    };
    const gaps = [];
    if (s.total < R.total_hours) gaps.push(round(R.total_hours - s.total) + ' more hours to reach ' + R.total_hours);
    if (s.hands_on < R.minimums.hands_on) gaps.push(round(R.minimums.hands_on - s.hands_on) + ' more hands-on hours (' + R.minimums.hands_on + ' needed)');
    if (s.dementia < R.minimums.dementia) gaps.push(round(R.minimums.dementia - s.dementia) + ' more dementia care hours (' + R.minimums.dementia + ' needed)');
    if (s.postural_hospice < R.minimums.postural_hospice) gaps.push(round(R.minimums.postural_hospice - s.postural_hospice) + ' more hours on postural supports, restricted health conditions and hospice (' + R.minimums.postural_hospice + ' needed)');
    // Phases. An entry tagged with a phase stays in it. Untagged entries fill
    // phase 1 in date order until it holds 20 hours, then phase 2.
    const byDate = es.slice().sort((a, b) => a.date - b.date);
    let p1 = sumBy(byDate, e => e.phase === 'phase1');
    const ph = { phase1: [], phase2: [] };
    byDate.forEach(e => {
      if (e.phase) { ph[e.phase].push(e); return; }
      if (p1 < R.phases.phase1.hours) { ph.phase1.push(e); p1 = round(p1 + e.hours); } else ph.phase2.push(e);
    });
    const phase = (key) => {
      const P = R.phases[key], list = ph[key];
      const h = { hours: sumBy(list, () => true), dementia: sumBy(list, e => e.topic === 'dementia'), postural_hospice: sumBy(list, e => e.topic === 'postural_hospice') };
      const g = [];
      if (h.hours < P.hours) g.push(round(P.hours - h.hours) + ' more hours (' + P.hours + ' needed)');
      if (h.dementia < P.minimums.dementia) g.push(round(P.minimums.dementia - h.dementia) + ' more dementia care hours (' + P.minimums.dementia + ' needed)');
      if (P.minimums.postural_hospice && h.postural_hospice < P.minimums.postural_hospice) g.push(round(P.minimums.postural_hospice - h.postural_hospice) + ' more hours on postural supports, restricted health conditions and hospice (' + P.minimums.postural_hospice + ' needed)');
      return Object.assign(h, { done: !g.length, gaps: g });
    };
    const phases = { phase1: phase('phase1'), phase2: phase('phase2') };
    // Required topics with no hours set: covered or not.
    const covered = {};
    es.forEach(e => { if (e.topic) covered[e.topic] = true; });
    // First aid can also be on the staff record (a certificate), not the log.
    if (opts && opts.firstAidOnFile) covered.first_aid = true;
    const topicsMissing = R.required_topics.filter(k => !covered[k]);
    if (topicsMissing.length) gaps.push('No hours yet on: ' + topicsMissing.map(k => TOPICS.find(t => t.key === k).label).join('; '));
    const daysLeft = Math.max(0, Math.round((dueBy - now) / DAY));
    const status = !gaps.length ? 'complete' : (now > dueBy ? 'overdue' : 'in_progress');
    return { code: R.code, status, due: iso(dueBy), days_left: daysLeft, hours: s, gaps, phases, topics_missing: topicsMissing };
  }

  // Elder abuse reporting training within 60 days of hire (WIC §15655(a)).
  function elderAbuseStatus(rows, hireDate, today) {
    const R = RULES.elder_abuse;
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code: R.code, status: 'needs_hire_date' };
    const dueBy = new Date(hire.getTime() + R.within_days_of_hire * DAY);
    const done = rows.map(normalise).some(e => e.topic === 'elder_abuse' && e.date && e.date <= dueBy);
    return { code: R.code, status: done ? 'complete' : (now > dueBy ? 'overdue' : 'in_progress'), due: iso(dueBy) };
  }

  // Medication training for a staff member who assists with self-administration,
  // sized by the home's licensed capacity. Entries tagged 'medication' count.
  function medicationStatus(rows, hireDate, capacity, today) {
    const R = RULES.medication;
    const cap = parseInt(capacity, 10);
    if (!cap) return { code: R.code, status: 'needs_capacity', gaps: ["Add the home's licensed capacity (Facility tab) to size medication training."] };
    const size = cap >= R.large.min_capacity ? R.large : R.small;
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code: R.code, status: 'needs_hire_date', size, gaps: ['Add a hire date to track medication training.'] };
    const dueBy = new Date(hire.getTime() + size.other_within_days * DAY);
    const es = rows.map(normalise).filter(e => e.topic === 'medication' && e.date);
    const s = {
      hands_on: sumBy(es, e => e.hands_on),
      other: sumBy(es, e => !e.hands_on && e.date <= dueBy),
      other_late: sumBy(es, e => !e.hands_on && e.date > dueBy),
    };
    s.total = round(s.hands_on + s.other);
    const gaps = [];
    if (s.hands_on < size.hands_on) gaps.push(round(size.hands_on - s.hands_on) + ' more hands-on shadowing hours before assisting with medication (' + size.hands_on + ' needed)');
    if (s.other < size.other) gaps.push(round(size.other - s.other) + ' more hours of other medication training by ' + iso(dueBy) + ' (' + size.other + ' needed)');
    const status = !gaps.length ? 'complete' : (now > dueBy ? 'overdue' : 'in_progress');
    return { code: R.code, status, due: iso(dueBy), size, hours: s, gaps };
  }

  // A course from a training partner, as data: credit hours split by topic.
  // Logging it for a person makes one entry per topic, all carrying the
  // course id, so the hours land in the right minimums. Ready for a catalog
  // (and later SCORM completions) without a second path through the arithmetic.
  function courseToEntries(course, staffId, date) {
    const split = (course && course.topic_hours) || {};
    const keys = Object.keys(split).filter(k => (parseFloat(split[k]) || 0) > 0);
    const base = { staff_id: staffId, training_date: date, course_id: course.id || null,
      delivery: course.delivery || null, counts_toward: course.counts_toward || 'direct_care', phase: course.phase || null };
    if (!keys.length) return [Object.assign({}, base, { topic: course.title, hours: course.credit_hours, topic_area: 'other', hands_on: false })];
    return keys.map(k => Object.assign({}, base, { topic: course.title, hours: parseFloat(split[k]), topic_area: k, hands_on: false }));
  }

  // C. Annual training for one direct care staff member, on a 12-month cycle
  // from the hire date. The current period is the one containing `today`;
  // the previous one is reported too, so a year that ended short still shows.
  // Hours inside the first four weeks count toward initial training instead.
  function annualStatus(rows, hireDate, today) {
    const R = RULES.annual;
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code: R.code, status: 'needs_hire_date', gaps: ['Add a hire date to track annual training.'] };
    const initialEnd = new Date(hire.getTime() + RULES.initial.within_days_of_hire * DAY);
    const es = rows.map(normalise).filter(e => e.counts_toward === 'direct_care' && e.date && e.date > initialEnd);
    let k = 0;
    while (addMonths(hire, (k + 1) * R.period_months) <= now) k++;
    const period = n => {
      const start = addMonths(hire, n * R.period_months), end = addMonths(hire, (n + 1) * R.period_months);
      const inP = es.filter(e => e.date >= start && e.date < end);
      const s = {
        total: sumBy(inP, () => true),
        dementia: sumBy(inP, e => e.topic === 'dementia'),
        postural_hospice: sumBy(inP, e => e.topic === 'postural_hospice'),
      };
      const gaps = [];
      if (s.total < R.total_hours) gaps.push(round(R.total_hours - s.total) + ' more hours to reach ' + R.total_hours);
      if (s.dementia < R.minimums.dementia) gaps.push(round(R.minimums.dementia - s.dementia) + ' more dementia care hours (' + R.minimums.dementia + ' needed)');
      if (s.postural_hospice < R.minimums.postural_hospice) gaps.push(round(R.minimums.postural_hospice - s.postural_hospice) + ' more hours on postural supports, restricted health conditions and hospice (' + R.minimums.postural_hospice + ' needed)');
      return { start: iso(start), due: iso(new Date(end.getTime() - DAY)), hours: s, gaps };
    };
    const cur = period(k);
    const prev = k > 0 ? period(k - 1) : null;
    const status = !cur.gaps.length ? 'complete' : 'in_progress';
    return { code: R.code, status, due: cur.due, start: cur.start, hours: cur.hours, gaps: cur.gaps, previous: prev };
  }

  // A. Administrator continuing education for one administrator, over the two
  // years ending on the certificate's expiry date. Self-paced hours above 20
  // do not count toward the 40. Hours with no delivery recorded count toward
  // the total but not toward the live minimum, and are named as such.
  function adminCeStatus(rows, certExpiry, today) {
    const R = RULES.admin_ce;
    const exp = toDate(certExpiry);
    const now = toDate(today) || toDate(new Date());
    if (!exp) return { code: R.code, status: 'needs_expiry', gaps: ['Add the certificate expiry date to track renewal hours.'], warnings: [] };
    const start = addMonths(exp, -R.period_months);
    const es = rows.map(normalise).filter(e => e.counts_toward === 'admin_ce' && e.date && e.date > start && e.date <= exp);
    const s = {
      logged: sumBy(es, () => true),
      live: sumBy(es, e => e.delivery === 'live'),
      self_paced: sumBy(es, e => e.delivery === 'self_paced'),
      delivery_unknown: sumBy(es, e => !e.delivery),
      dementia: sumBy(es, e => e.topic === 'dementia'),
      laws_regs: sumBy(es, e => e.topic === 'laws_regs'),
    };
    const selfPacedCounted = Math.min(s.self_paced, R.max_self_paced_hours);
    s.counted = round(s.live + selfPacedCounted + s.delivery_unknown);
    const gaps = [], warnings = [];
    if (s.self_paced > R.max_self_paced_hours) warnings.push(round(s.self_paced) + ' self-paced hours logged: only ' + R.max_self_paced_hours + ' can count toward the ' + R.total_hours + '. The other ' + round(s.self_paced - R.max_self_paced_hours) + ' need to be live.');
    if (s.delivery_unknown > 0) warnings.push(s.delivery_unknown + ' hours have no delivery recorded (live or self-paced).');
    if (s.counted < R.total_hours) gaps.push(round(R.total_hours - s.counted) + ' more countable hours to reach ' + R.total_hours);
    if (s.live < R.min_live_hours) gaps.push(round(R.min_live_hours - s.live) + ' more live hours, in person or live-stream (' + R.min_live_hours + ' needed)');
    if (s.dementia < R.minimums.dementia) gaps.push(round(R.minimums.dementia - s.dementia) + ' more dementia hours (' + R.minimums.dementia + ' needed)');
    if (s.laws_regs < R.minimums.laws_regs) gaps.push(round(R.minimums.laws_regs - s.laws_regs) + ' more hours on laws, regulations, policies and procedural standards (' + R.minimums.laws_regs + ' needed)');
    const status = !gaps.length ? 'complete' : (now > exp ? 'overdue' : 'in_progress');
    return { code: R.code, status, start: iso(start), due: iso(exp), hours: s, gaps, warnings };
  }

  // The RCFE-only items apply to RCFE facilities only. A facility with no
  // type recorded is treated as RCFE: onboarding defaults to it.
  function appliesTo(rule, facilityType) {
    return rule.facility_types.includes(facilityType || 'rcfe');
  }

  const api = { TOPICS, RULES, normalise, hoursByTopic, initialStatus, annualStatus, adminCeStatus, elderAbuseStatus, medicationStatus, courseToEntries, appliesTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.T22Training = api;
})(typeof window !== 'undefined' ? window : globalThis);
