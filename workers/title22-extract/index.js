// title22-extract — "Scan to fill" form extraction worker
//
// Takes a photo of a paper form (staff file, resident face sheet, medication
// label) and returns that form's fields as JSON, with a per-field confidence
// flag and an approximate bounding box so the UI can show the photo crop next
// to each extracted value.
//
// This worker NEVER writes to residents/staff/medications. It returns data for
// a human to review in the app; the existing save paths (and the audit-log
// triggers behind them) remain the only way anything is persisted.
//
// Entitlement is namespaced to title22_* columns on the shared nwlhs profiles
// table and draws from the same monthly `ai_usage` bucket as title22-ai.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function getUserFromToken(token, env) {
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return await res.json();
}

// Reads ONLY title22-namespaced columns. profiles.plan is deliberately ignored.
async function getProfile(userId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=title22_plan,title22_plan_expires_at`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Accept': 'application/json'
      }
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Kept in sync with workers/title22-ai/index.js. Unknown -> trial (default deny).
const LIMITS = {
  trial: 50,
  edu: 100000,
  starter: 50,
  pro: 200,
  specialist: 200,
  agency: 500,
};

const PAID_PLANS = ['starter', 'pro', 'specialist', 'agency'];

function resolvePlan(profile) {
  const raw = profile?.title22_plan;
  if (!raw || !(raw in LIMITS)) return 'trial';

  const expires = profile?.title22_plan_expires_at;
  if (expires && new Date(expires) < new Date()) return 'trial';

  return raw;
}

// Same monthly bucket as the chat assistant: a scan costs one AI call.
async function checkAndDeductCredits(userId, plan, env) {
  const SUPABASE = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  const period = currentPeriod();
  const limit = LIMITS[plan] ?? LIMITS.trial;

  const headers = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const usageUrl =
    `${SUPABASE}/rest/v1/ai_usage?user_id=eq.${userId}&app=eq.title22` +
    `&period_start=eq.${period}&select=id,calls_used,calls_limit`;

  const getRes = await fetch(usageUrl, { headers });
  const rows = getRes.ok ? await getRes.json() : [];
  let row = rows[0];

  if (!row) {
    const insertRes = await fetch(`${SUPABASE}/rest/v1/ai_usage`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        app: 'title22',
        calls_used: 1,
        calls_limit: limit,
        period_start: period
      })
    });

    if (insertRes.ok) {
      return { allowed: true, remaining: limit - 1, limit };
    }

    const retryRes = await fetch(usageUrl, { headers });
    const retryRows = retryRes.ok ? await retryRes.json() : [];
    row = retryRows[0];
    if (!row) return { allowed: false, remaining: 0, error: 'usage_row_failed' };
  }

  const used = row.calls_used || 0;
  const rowLimit = limit;
  const limitChanged = row.calls_limit !== limit;

  if (used >= rowLimit) return { allowed: false, remaining: 0, limit: rowLimit };

  const patchBody = { calls_used: used + 1 };
  if (limitChanged) patchBody.calls_limit = limit;

  const patchRes = await fetch(
    `${SUPABASE}/rest/v1/ai_usage?id=eq.${row.id}`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify(patchBody)
    }
  );

  // Fail closed if the deduction failed.
  if (!patchRes.ok) return { allowed: false, remaining: 0, error: 'deduct_failed' };

  return { allowed: true, remaining: rowLimit - used - 1, limit: rowLimit };
}

// ===== FORM SCHEMAS =====
//
// The keys here are the contract with the frontend: index.html maps each key
// onto an input in the matching modal (see SCAN_FORMS in index.html). Adding a
// field means adding it in both places — a key with no mapping is shown in the
// review sheet but has nowhere to go, so keep the two lists aligned.
//
// `type` drives the normalization pass below and the input the review sheet
// renders. `desc` is sent to the model verbatim as the field description.

const DATE_RULE = 'Format as YYYY-MM-DD. If only a month and year are printed, use the first of that month. Leave empty if no date is shown.';
const YESNO_RULE = 'Answer exactly "yes" or "no". Leave empty if the document does not say either way.';

const FORMS = {
  staff: {
    label: 'Staff record',
    docHint: 'a California RCFE employee file page — a personnel record, employment application, TB clearance, CPR/First Aid certificate, LiveScan clearance, or training certificate',
    fields: [
      { key: 'full_name', label: 'Full name', type: 'text', desc: 'The employee\'s full name as printed.' },
      { key: 'role', label: 'Role', type: 'text', desc: 'Job title or position, e.g. Caregiver, Administrator, Cook, Med Tech.' },
      { key: 'hire_date', label: 'Hire date', type: 'date', desc: `Date of hire or employment start date. ${DATE_RULE}` },
      { key: 'phone', label: 'Phone', type: 'phone', desc: 'Primary phone number for the employee.' },
      { key: 'tb_test_date', label: 'TB test date', type: 'date', desc: `Date the TB test / risk assessment was performed or read. ${DATE_RULE}` },
      { key: 'tb_test_due', label: 'TB next due', type: 'date', desc: `Date the next TB test is due or the clearance expires. ${DATE_RULE}` },
      { key: 'cpr_cert_date', label: 'CPR certified on', type: 'date', desc: `Date CPR certification was issued or completed. ${DATE_RULE}` },
      { key: 'cpr_cert_expiry', label: 'CPR expires', type: 'date', desc: `Date CPR certification expires. ${DATE_RULE}` },
      { key: 'first_aid_cert_date', label: 'First Aid certified on', type: 'date', desc: `Date First Aid certification was issued or completed. ${DATE_RULE}` },
      { key: 'first_aid_cert_expiry', label: 'First Aid expires', type: 'date', desc: `Date First Aid certification expires. ${DATE_RULE}` },
      { key: 'livescan_cleared', label: 'LiveScan cleared', type: 'bool', desc: `Whether a LiveScan / criminal record clearance or exemption has been granted. ${YESNO_RULE}` },
      { key: 'livescan_date', label: 'LiveScan date', type: 'date', desc: `Date of the LiveScan submission or clearance. ${DATE_RULE}` },
      { key: 'mandated_reporter_completed', label: 'Mandated Reporter done', type: 'bool', desc: `Whether Mandated Reporter training has been completed. ${YESNO_RULE}` },
      { key: 'mandated_reporter_date', label: 'Mandated Reporter date', type: 'date', desc: `Date Mandated Reporter training was completed. ${DATE_RULE}` },
      { key: 'initial_training_complete', label: '16hr training done', type: 'bool', desc: `Whether the 16-hour initial direct-care training has been completed. ${YESNO_RULE}` },
      { key: 'initial_training_hours', label: 'Training hours', type: 'number', desc: 'Total training hours logged, as a plain number. Leave empty if no hour total is printed.' },
    ],
  },

  resident: {
    label: 'Resident face sheet',
    docHint: 'a California RCFE resident face sheet — most often a LIC 601 Identification and Emergency Information form, an admission record, or a physician\'s report (LIC 602)',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', desc: 'The resident\'s full legal name.' },
      { key: 'preferred_name', label: 'Preferred name', type: 'text', desc: 'Nickname or preferred name, if one is given separately from the legal name.' },
      { key: 'room', label: 'Room / bed', type: 'text', desc: 'Room or bed assignment, if shown.' },
      { key: 'dob', label: 'Date of birth', type: 'date', desc: `The resident\'s date of birth. ${DATE_RULE}` },
      { key: 'admission_date', label: 'Admission date', type: 'date', desc: `Date of admission or move-in. ${DATE_RULE}` },
      { key: 'diagnosis', label: 'Primary diagnosis', type: 'text', desc: 'Primary diagnosis or medical conditions, comma-separated if there are several. Transcribe what is written; do not interpret or expand abbreviations you are unsure of.' },
      { key: 'allergies', label: 'Allergies', type: 'text', desc: 'Known allergies, comma-separated. Use "NKA" or "None" only if the form explicitly says so.' },
      { key: 'lic601', label: 'LIC 601 on file', type: 'bool', desc: `Answer "yes" only if the scanned document IS itself a completed, signed LIC 601. Otherwise leave empty. ${YESNO_RULE}` },
      { key: 'lic602', label: 'LIC 602 on file', type: 'bool', desc: `Answer "yes" only if the scanned document IS itself a completed, signed LIC 602 physician\'s report. Otherwise leave empty. ${YESNO_RULE}` },
      { key: 'isp', label: 'ISP on file', type: 'bool', desc: `Answer "yes" only if the scanned document IS itself a completed individual service plan (ISP) or needs-and-services plan. Otherwise leave empty. ${YESNO_RULE}` },
      { key: 'isp_review_date', label: 'ISP last reviewed', type: 'date', desc: `Date the service plan was last reviewed or updated. ${DATE_RULE}` },
    ],
  },

  medication: {
    label: 'Medication',
    docHint: 'a pharmacy prescription label, a medication list, or a MAR (medication administration record) header',
    fields: [
      { key: 'medication_name', label: 'Medication name', type: 'text', desc: 'The drug name exactly as printed, including the generic name in parentheses if both appear. Do not correct spelling or substitute a name you think was intended.' },
      { key: 'dosage', label: 'Dosage', type: 'text', desc: 'Strength per unit as printed, e.g. "25mg", "10mg/5mL".' },
      { key: 'directions', label: 'Directions', type: 'text', desc: 'The sig / directions for use, transcribed verbatim, e.g. "Take 1 tablet by mouth twice daily".' },
      { key: 'prescriber', label: 'Prescriber', type: 'text', desc: 'Prescribing physician\'s name.' },
      { key: 'rx_number', label: 'Rx number', type: 'text', desc: 'The prescription number, digits only if it is printed with an "Rx#" prefix.' },
      { key: 'pharmacy', label: 'Pharmacy', type: 'text', desc: 'Dispensing pharmacy name.' },
      { key: 'start_date', label: 'Start date', type: 'date', desc: `Date filled, dispensed, or started. ${DATE_RULE}` },
      { key: 'end_date', label: 'End date', type: 'date', desc: `Date the prescription ends or is discontinued. ${DATE_RULE}` },
      { key: 'refill_date', label: 'Refill due', type: 'date', desc: `Date the next refill is due, or the discard/expiry date if that is the only forward date shown. ${DATE_RULE}` },
      { key: 'status', label: 'Status', type: 'enum', options: ['active', 'discontinued'], desc: 'Answer exactly "active" or "discontinued". Use "discontinued" only if the document says the medication was stopped or discontinued. Leave empty if unclear.' },
    ],
  },
};

function buildSchema(form) {
  const props = {};
  const required = [];
  for (const f of form.fields) {
    required.push(f.key);
    props[f.key] = {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'confidence', 'source_text', 'box'],
      properties: {
        value: { type: 'string', description: `${f.label}. ${f.desc}` },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low', 'not_found'],
          description: 'high = printed clearly and unambiguously; medium = legible but inferred, abbreviated, or partly obscured; low = handwriting or image quality left real doubt; not_found = this field does not appear on the page.',
        },
        source_text: {
          type: 'string',
          description: 'The raw text on the page this value came from, transcribed verbatim before any cleanup. Empty when confidence is not_found.',
        },
        box: {
          type: 'array',
          items: { type: 'number' },
          description: 'Approximate location of source_text as exactly four numbers [x0, y0, x1, y1], each 0-1 as a fraction of image width/height, origin at the top-left. Empty array when confidence is not_found.',
        },
      },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['fields', 'notes'],
    properties: {
      fields: { type: 'object', additionalProperties: false, required, properties: props },
      notes: {
        type: 'string',
        description: 'One or two sentences for the reviewer: what kind of document this appears to be, anything illegible, and whether the page looks like it holds more records than the one extracted. Empty string if there is nothing worth flagging.',
      },
    },
  };
}

function systemPrompt(form) {
  return [
    'You transcribe scanned California RCFE (residential care facility for the elderly) paperwork into structured fields.',
    `The image should be ${form.docHint}.`,
    '',
    'Rules:',
    '- Transcribe only what is visibly on the page. Never infer, complete, or guess a value that is not written there — an empty value with confidence "not_found" is always better than a plausible invention.',
    '- Do not carry over knowledge about typical forms of this type. If a field is blank on the page, it is blank.',
    '- Handwriting is common. If a character is genuinely ambiguous, transcribe your best reading and mark the confidence "low" so a human checks it.',
    '- Dates on these forms are US-format (MM/DD/YYYY) unless the page clearly says otherwise.',
    '- If the page is the wrong kind of document for these fields, return not_found for everything and say so in `notes`.',
    '- This output is reviewed by a caregiver before it is saved. Do not add commentary about clinical appropriateness, dosing, or care decisions — transcribe only.',
  ].join('\n');
}

// ===== NORMALIZATION =====
// The model is asked for clean values; this is the belt-and-braces pass so the
// frontend can drop values straight into <input type="date"> / number inputs.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return isoDate(year, +m[1], +m[2]);
  }

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return isoDate(+m[3], mo, +m[2]);
  }

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return isoDate(+m[2], mo, 1);
  }

  return '';
}

function isoDate(y, m, d) {
  if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeValue(field, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  switch (field.type) {
    case 'date':
      return normalizeDate(s);
    case 'bool': {
      const t = s.toLowerCase();
      if (['yes', 'y', 'true', 'cleared', 'complete', 'completed'].includes(t)) return 'yes';
      if (['no', 'n', 'false', 'pending', 'incomplete'].includes(t)) return 'no';
      return '';
    }
    case 'number': {
      const n = parseFloat(s.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? String(n) : '';
    }
    case 'enum':
      return (field.options || []).includes(s.toLowerCase()) ? s.toLowerCase() : '';
    case 'phone': {
      const digits = s.replace(/\D/g, '');
      if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      if (digits.length === 11 && digits[0] === '1') {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
      }
      return s;
    }
    default:
      return s.slice(0, 500);
  }
}

function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [x0, y0, x1, y1] = nums.map((n) => Math.min(1, Math.max(0, n)));
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return [x0, y0, x1, y1];
}

// Shape the model's output into the response contract, dropping anything that
// doesn't survive normalization rather than passing junk to the review sheet.
function shapeResult(form, parsed) {
  const out = {};
  const src = parsed?.fields || {};

  for (const f of form.fields) {
    const raw = src[f.key] || {};
    const value = normalizeValue(f, raw.value);
    let confidence = ['high', 'medium', 'low', 'not_found'].includes(raw.confidence)
      ? raw.confidence
      : 'low';

    // A value the model read but we couldn't normalize (an unparseable date,
    // a bool that wasn't yes/no) is a review problem, not a silent drop.
    const droppedByNormalization = !value && String(raw.value ?? '').trim();
    if (!value) confidence = 'not_found';

    out[f.key] = {
      label: f.label,
      type: f.type,
      value,
      confidence,
      source_text: String(raw.source_text ?? '').trim().slice(0, 300),
      box: normalizeBox(raw.box),
      ...(droppedByNormalization ? { unparsed: String(raw.value).trim().slice(0, 120) } : {}),
    };
  }

  return out;
}

const MAX_IMAGE_B64 = 4_500_000; // ~3.3MB decoded; Anthropic caps a base64 image at 5MB
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check. Reports which bindings are PRESENT — booleans only, never
    // values — because "the script deployed" and "the script is configured"
    // are different questions and only the second one predicts whether a scan
    // will work. A misnamed secret is invisible without this.
    if (request.method === 'GET') {
      const config = {
        SUPABASE_URL: Boolean(env.SUPABASE_URL),
        SUPABASE_SERVICE_KEY: Boolean(env.SUPABASE_SERVICE_KEY),
        ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
      };
      const missing = Object.keys(config).filter((k) => !config[k]);
      return json({
        status: missing.length ? 'misconfigured' : 'ok',
        forms: Object.keys(FORMS),
        model: env.EXTRACT_MODEL || 'claude-opus-5',
        config,
        ...(missing.length ? { missing, hint: `Set ${missing.join(', ')} on this Worker. Names are case-sensitive and must match exactly.` } : {}),
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json();
      const { formType, image, hint } = body || {};

      const form = FORMS[formType];
      if (!form) {
        return json({ error: 'bad_request', message: `Unknown formType. Expected one of: ${Object.keys(FORMS).join(', ')}.` }, 400);
      }
      if (!image?.data || typeof image.data !== 'string') {
        return json({ error: 'bad_request', message: 'image.data (base64, no data: prefix) is required.' }, 400);
      }
      if (!ALLOWED_MEDIA.includes(image.media_type)) {
        return json({ error: 'bad_request', message: `image.media_type must be one of: ${ALLOWED_MEDIA.join(', ')}.` }, 400);
      }
      if (image.data.length > MAX_IMAGE_B64) {
        return json({ error: 'image_too_large', message: 'That photo is too large. Retake it or let the app resize it before sending.' }, 413);
      }

      // Checked before the credit is deducted below. A misconfigured Worker is
      // our problem, not the caller's, and it must not cost them an AI call.
      if (!env.ANTHROPIC_API_KEY) {
        return json({
          error: 'not_configured',
          message: 'This Worker is missing its ANTHROPIC_API_KEY binding. No AI call was used.',
        }, 503);
      }

      const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
      const user = await getUserFromToken(token, env);
      if (!user?.id) {
        // Two very different causes land here, so say which is which rather
        // than making the caller guess from a bare 401.
        return json({
          error: 'unauthorized',
          message: env.SUPABASE_SERVICE_KEY
            ? 'Your session could not be verified. Sign out and back in, then try again.'
            : 'This Worker is missing its SUPABASE_SERVICE_KEY binding, so it cannot verify who you are.',
        }, 401);
      }

      const profile = await getProfile(user.id, env);
      const plan = resolvePlan(profile);
      const isPaid = PAID_PLANS.includes(plan);

      const credits = await checkAndDeductCredits(user.id, plan, env);
      if (!credits.allowed) {
        if (credits.error) {
          return json({
            error: 'credit_system_error',
            message: 'Could not verify AI credits. Please try again.',
            remaining: 0
          }, 500);
        }
        return json({
          error: 'limit_reached',
          message: isPaid
            ? `You've used all ${credits.limit} AI calls on your ${plan} plan this month.`
            : `You've used all your AI calls this month. Upgrade to Pro for 200 calls/month.`,
          plan,
          remaining: 0
        }, 402);
      }

      const userText = [
        `Extract the ${form.label} fields from this image.`,
        hint ? `Context from the caregiver who took the photo: ${String(hint).slice(0, 300)}` : '',
      ].filter(Boolean).join('\n\n');

      const anthropicBody = {
        model: env.EXTRACT_MODEL || 'claude-opus-5',
        // Thinking is ON by default on Claude Opus 5 and max_tokens caps
        // thinking + response together, so this needs real headroom. At 8000 a
        // dense page could spend the whole budget reasoning and return a
        // truncated answer. Unused tokens are not billed.
        max_tokens: 16000,
        system: systemPrompt(form),
        output_config: {
          // Latency is the binding constraint here, not depth of reasoning.
          // This is transcription against a fixed schema — read the marks on
          // the page, don't reason about them — and Claude Opus 5 scopes its
          // work tightly at `low` rather than exploring. A scan that takes two
          // minutes is a scan nobody uses, and at `medium` the call could
          // outlast the caller's patience (and, before the frontend timeout
          // landed, hang the modal outright).
          //
          // Thinking stays ON. Disabling it on Claude Opus 5 risks leaking
          // <thinking> tags into the response text, which would corrupt the
          // JSON this endpoint exists to return.
          effort: 'low',
          format: { type: 'json_schema', schema: buildSchema(form) },
        },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
            { type: 'text', text: userText },
          ],
        }],
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody)
      });

      const data = await response.json();
      if (!response.ok) {
        return json({ error: 'extract_failed', message: data?.error?.message || 'The extraction service rejected the image.' }, 502);
      }

      if (data.stop_reason === 'refusal') {
        return json({ error: 'refused', message: 'The extraction service declined to read this image. Try a clearer photo of the form itself.' }, 422);
      }
      if (data.stop_reason === 'max_tokens') {
        return json({ error: 'truncated', message: 'The page was too dense to read in one pass. Photograph one section at a time.' }, 422);
      }

      const text = (data.content || []).find((b) => b.type === 'text')?.text;
      if (!text) {
        return json({ error: 'empty_result', message: 'Nothing could be read from that image.' }, 422);
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({ error: 'bad_result', message: 'The extraction result could not be read. Please try again.' }, 502);
      }

      return json({
        formType,
        formLabel: form.label,
        fields: shapeResult(form, parsed),
        notes: String(parsed?.notes ?? '').trim().slice(0, 600),
        plan,
        limit: credits.limit,
        remaining: credits.remaining,
        isPaid,
      });

    } catch (err) {
      return json({ error: 'server_error', message: err.message }, 500);
    }
  }
};
