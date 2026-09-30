/* Title22 training requirements for RCFEs and ARFs — the numbers, as data,
 * and the arithmetic that checks a person's logged hours against them.
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
 * ARF (adult residential facilities), checked 2026-09-30 against:
 *   - "Reference Guide to Adult Residential Facilities Administrator, Staff,
 *     and Volunteer Training Requirements", CDSS, December 2025
 *     (cdss.ca.gov/Portals/9/CCLD/ACL/Provider Resources/ARF-Training-Requirements.pdf),
 *     announced by PIN 25-11-ASC.
 *   - CDSS Administrator Certification FAQ (cdss.ca.gov, .../faq-administrators).
 *   - 22 CCR §§80065, 80066, 80075, 85064, 85064.2, 85064.3, 85065.6, 85066
 *     and 85095.5, current text from the CDSS regulation files (arfman.docx,
 *     genman1-4.docx).
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
  // `types`, when present, limits which facility types are offered the topic
  // (topicsFor). hiv and tb are the ARF administrator's HSC §1562.5 training.
  // Hours already logged under any topic are always counted and shown.
  const TOPICS = [
    { key: 'aging',             label: 'Aging, physical limitations and needs of the elderly', types: ['rcfe', 'cbrc'] },
    { key: 'personal_care',     label: 'Personal care services (ADLs)' },
    { key: 'infection_control', label: 'Infectious disease and infection control' },
    { key: 'residents_rights',  label: "Residents' rights" },
    { key: 'medication',        label: 'Medication policies and procedures' },
    { key: 'psychosocial',      label: 'Psychosocial needs' },
    { key: 'dementia',          label: 'Dementia care', types: ['rcfe', 'cbrc'] },
    { key: 'postural_hospice',  label: 'Postural supports, restricted health conditions and hospice care' },
    { key: 'emergency',         label: 'Fire safety and emergency response' },
    { key: 'elder_abuse',       label: 'Recognizing and reporting elder and dependent adult abuse' },
    { key: 'lgbt_cultural',     label: 'Cultural competency and sensitivity for the aging LGBT community' },
    { key: 'first_aid',         label: 'First aid' },
    { key: 'laws_regs',         label: 'Laws, regulations, policies and procedural standards' },
    { key: 'hiv',               label: 'HIV: needs of residents who may be infected', types: ['arf'] },
    { key: 'tb',                label: 'Tuberculosis (TB): basic information', types: ['arf'] },
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
    // Applies to ARF staff too: CDSS's ARF reference guide (Dec 2025) lists it
    // under "All Staff: On-the-Job Training", citing WIC §15655(a)(1), (a)(2).
    elder_abuse: { code: 'elder_abuse_training', facility_types: ['rcfe', 'cbrc', 'arf'], within_days_of_hire: 60, citation: 'WIC §15655(a)' },
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

    // ── ARF (22 CCR §80000 general + §85000 ARF). No dementia hours, no
    // 40-hour initial training in phases and no medication hours by home
    // size: those are RCFE law (HSC §1569.x) and do not apply here.

    // ARF administrator certificate renewal. 40 hours every 2-year period, at
    // least 4 on laws, regulations, policies and procedural standards; no more
    // than half (20) self-paced, so at least 20 live (in person or
    // live-stream). HSC §1562.3(f)(1); 22 CCR §85064.3(a); CDSS FAQ.
    // Initial certification: 35 hours of interactive instruction (in person or
    // live-stream, no self-paced) and the state exam within 60 days of
    // finishing it. HSC §1562.3(c)(1), (c)(3); 22 CCR §85064.2(b).
    // Known and NOT modelled: up to 24 Regional Center (DDS) CE hours may
    // count, not toward the 4 laws-and-regulations hours (§85064.3(b)(2); CDSS
    // FAQ, updated 7/1/2026); no more than 10 hours counted from one day
    // (§85064.3(c)(1)); 1 hour on the aging LGBT community if it was not in
    // the person's initial program (§85064.3(a)(2)).
    arf_admin_ce: {
      code: 'arf_admin_ce',
      facility_types: ['arf'],
      label: 'ARF administrator certificate renewal: continuing education',
      total_hours: 40,
      period_months: 24,
      due: 'certificate_expiry',
      minimums: { laws_regs: 4 },
      max_self_paced_hours: 20,
      min_live_hours: 20,
      initial_certification: { hours: 35, live_only: true, exam_within_days: 60 },
      citation: 'HSC §1562.3(c), (f)(1); 22 CCR §§85064.2, 85064.3',
    },
    // ARF administrator: 4 hours (3 on HIV, 1 on TB) within 6 months of
    // becoming administrator, then an update every 2 years. HSC §1562.5(a);
    // 22 CCR §85064(k). Counted from the administrator's hire date.
    arf_admin_hiv_tb: {
      code: 'arf_admin_hiv_tb',
      facility_types: ['arf'],
      hours: { hiv: 3, tb: 1 },
      within_months: 6,
      update_every_months: 24,
      citation: 'HSC §1562.5(a); 22 CCR §85064(k)',
    },
    // All ARF staff: training on the facility's Infection Control Plan from the
    // Infection Control Lead within 10 calendar days of employment.
    // 22 CCR §85095.5(c)(1)(C)1.
    arf_infection_control: {
      code: 'arf_infection_control',
      facility_types: ['arf'],
      within_days_of_hire: 10,
      topic: 'infection_control',
      citation: '22 CCR §85095.5(c)(1)(C)',
    },
    // All ARF staff: training on the Emergency and Disaster Plan upon hire and
    // every year after. HSC §1565(b), as CDSS's ARF reference guide cites it.
    arf_emergency_plan: {
      code: 'arf_emergency_plan',
      facility_types: ['arf'],
      period_months: 12,
      topic: 'emergency',
      citation: 'HSC §1565(b)',
    },
    // ARF direct care staff: first aid training from persons qualified by an
    // agency such as the American Red Cross. No hours set. 22 CCR §80075(f).
    // Read from the staff record's first aid certificate.
    arf_first_aid: { code: 'arf_first_aid', facility_types: ['arf'], citation: '22 CCR §80075(f)' },
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

  // One training on a topic, logged within N days of hire.
  function withinDaysStatus(code, topic, days, rows, hireDate, today) {
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code, status: 'needs_hire_date' };
    const dueBy = new Date(hire.getTime() + days * DAY);
    const done = rows.map(normalise).some(e => e.topic === topic && e.date && e.date <= dueBy);
    return { code, status: done ? 'complete' : (now > dueBy ? 'overdue' : 'in_progress'), due: iso(dueBy) };
  }

  // Elder abuse reporting training within 60 days of hire (WIC §15655(a)).
  function elderAbuseStatus(rows, hireDate, today) {
    const R = RULES.elder_abuse;
    return withinDaysStatus(R.code, 'elder_abuse', R.within_days_of_hire, rows, hireDate, today);
  }

  // ARF: Infection Control Plan training within 10 calendar days of hire.
  function arfInfectionControlStatus(rows, hireDate, today) {
    const R = RULES.arf_infection_control;
    return withinDaysStatus(R.code, R.topic, R.within_days_of_hire, rows, hireDate, today);
  }

  // ARF: Emergency and Disaster Plan training upon hire, then every year. One
  // entry tagged 'emergency' in each 12-month period from the hire date. A
  // period that ended with none is reported as overdue.
  function arfEmergencyPlanStatus(rows, hireDate, today) {
    const R = RULES.arf_emergency_plan;
    const hire = toDate(hireDate);
    const now = toDate(today) || toDate(new Date());
    if (!hire) return { code: R.code, status: 'needs_hire_date' };
    const es = rows.map(normalise).filter(e => e.topic === R.topic && e.date);
    let k = 0;
    while (addMonths(hire, (k + 1) * R.period_months) <= now) k++;
    const has = n => {
      const start = addMonths(hire, n * R.period_months), end = addMonths(hire, (n + 1) * R.period_months);
      // Training taken before the first day counts as "upon hire".
      return es.some(e => (n === 0 || e.date >= start) && e.date < end);
    };
    const cur = has(k), prev = k > 0 ? has(k - 1) : true;
    const due = iso(new Date(addMonths(hire, (k + 1) * R.period_months).getTime() - DAY));
    const gaps = [];
    if (!prev) gaps.push('None logged in the year ending ' + iso(new Date(addMonths(hire, k * R.period_months).getTime() - DAY)) + '.');
    if (!cur) gaps.push(k === 0 ? 'Not logged yet. Due upon hire.' : 'Not logged yet this year.');
    const status = cur && prev ? 'complete' : (!prev ? 'overdue' : 'in_progress');
    return { code: R.code, status, due, gaps };
  }

  // ARF administrator: HIV (3 h) and TB (1 h) within 6 months of becoming
  // administrator, then again within every 2 years after the last completed
  // round. `startDate` is when they became administrator (their hire date).
  function arfHivTbStatus(rows, startDate, today) {
    const R = RULES.arf_admin_hiv_tb;
    const start = toDate(startDate);
    const now = toDate(today) || toDate(new Date());
    if (!start) return { code: R.code, status: 'needs_hire_date', gaps: ['Add a hire date to track HIV and TB training.'] };
    const es = rows.map(normalise).filter(e => (e.topic === 'hiv' || e.topic === 'tb') && e.date).sort((a, b) => a.date - b.date);
    let from = null, due = addMonths(start, R.within_months), round_ = 'initial';
    for (;;) {
      const inWin = es.filter(e => (!from || e.date > from) && e.date <= due);
      let hiv = 0, tb = 0, doneOn = null;
      for (const e of inWin) {
        if (e.topic === 'hiv') hiv = round(hiv + e.hours); else tb = round(tb + e.hours);
        if (!doneOn && hiv >= R.hours.hiv && tb >= R.hours.tb) doneOn = e.date;
      }
      if (doneOn) {
        const next = addMonths(doneOn, R.update_every_months);
        // Completed, and the next round is not yet due: report it as done.
        if (now <= next) return { code: R.code, status: 'complete', round: round_, completed_on: iso(doneOn), due: iso(next), hours: { hiv, tb }, gaps: [] };
        from = doneOn; due = next; round_ = 'update';
        continue;
      }
      const gaps = [];
      if (hiv < R.hours.hiv) gaps.push(round(R.hours.hiv - hiv) + ' more hours on HIV (' + R.hours.hiv + ' needed)');
      if (tb < R.hours.tb) gaps.push(round(R.hours.tb - tb) + ' more hour on TB (' + R.hours.tb + ' needed)');
      return { code: R.code, status: now > due ? 'overdue' : 'in_progress', round: round_, due: iso(due), hours: { hiv, tb }, gaps };
    }
  }

  // Topics offered when logging an entry at this facility type.
  function topicsFor(facilityType) {
    const t = facilityType || 'rcfe';
    return TOPICS.filter(x => !x.types || x.types.includes(t));
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
  // `rule` picks the facility type's renewal rule (RULES.admin_ce for RCFE,
  // RULES.arf_admin_ce for ARF); omitted, it is the RCFE one.
  function adminCeStatus(rows, certExpiry, today, rule) {
    const R = rule || RULES.admin_ce;
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
    if (R.minimums.dementia && s.dementia < R.minimums.dementia) gaps.push(round(R.minimums.dementia - s.dementia) + ' more dementia hours (' + R.minimums.dementia + ' needed)');
    if (s.laws_regs < R.minimums.laws_regs) gaps.push(round(R.minimums.laws_regs - s.laws_regs) + ' more hours on laws, regulations, policies and procedural standards (' + R.minimums.laws_regs + ' needed)');
    const status = !gaps.length ? 'complete' : (now > exp ? 'overdue' : 'in_progress');
    return { code: R.code, status, start: iso(start), due: iso(exp), hours: s, gaps, warnings };
  }

  // The RCFE-only items apply to RCFE facilities only. A facility with no
  // type recorded is treated as RCFE: onboarding defaults to it.
  function appliesTo(rule, facilityType) {
    return rule.facility_types.includes(facilityType || 'rcfe');
  }

  const api = { TOPICS, RULES, normalise, hoursByTopic, initialStatus, annualStatus, adminCeStatus, elderAbuseStatus, medicationStatus, courseToEntries, appliesTo,
    topicsFor, arfInfectionControlStatus, arfEmergencyPlanStatus, arfHivTbStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.T22Training = api;
})(typeof window !== 'undefined' ? window : globalThis);
