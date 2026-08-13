// title22-ai — Title22 RCFE compliance assistant worker
// Entitlement is namespaced to title22_* columns on the shared nwlhs profiles table.
// This worker NEVER reads or writes profiles.plan (shared across RunP8 products).

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

const SAFE_DOSAGE_MESSAGE = "I can't advise on medication dosages. Ask your prescriber or pharmacist.";
const DOSAGE_PATTERNS = [
  /\b(?:dosage|dosages|dose|doses|frequency|frequencies|prescription|prescriptions)\b[\s\S]{0,40}\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|mL|units?|tablets?|capsules?|pills?)\b/i,
  /\b(?:how much|how many)\b[\s\S]{0,40}\b(?:medication|medicine|dose|dosage|mg|mcg|g|ml|mL|tablet|capsule|pill|units?)\b/i,
  /\bpharma[a-z]*\b[\s\S]{0,40}\b(?:medication|medicine|dose|dosage|mg|mcg|g|ml|mL|tablet|capsule|pill|units?)\b/i,
  /\b(?:take|taking|give|giving|administer|administered|administering)\b[\s\S]{0,60}\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|mL|units?)\b/i,
  /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|mL|units?)\b[\s\S]{0,60}\b(?:once|twice|daily|hourly|every|per day|per week)\b/i,
];

function extractTextContent(payload) {
  if (!Array.isArray(payload?.content)) return '';
  return payload.content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

function containsDosageAdvice(text) {
  if (!text) return false;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return DOSAGE_PATTERNS.some(pattern => pattern.test(normalized));
}

async function logDosageRejection({ userId, facilityId, rejectedText }, env) {
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
  const record = {
    facility_id: facilityId || null,
    table_name: 'ai_guard',
    row_id: crypto.randomUUID(),
    action: 'INSERT',
    actor: userId,
    record: {
      kind: 'dosage_rejected',
      rejected_text: rejectedText,
      user_id: userId,
      facility_id: facilityId || null,
      blocked_at: new Date().toISOString(),
    },
  };

  const auditRes = await fetch(`${env.SUPABASE_URL}/rest/v1/audit_log`, {
    method: 'POST',
    headers,
    body: JSON.stringify(record),
  });
  if (auditRes.ok) return;

  await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user_id: userId,
      facility_id: facilityId || null,
      role: 'system',
      event_name: 'ai_dosage_rejected',
      metadata: {
        rejected_text: rejectedText,
        audit_log_status: auditRes.status,
      },
    }),
  }).catch(() => {});
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
      'Authorization': 'Bearer ' + token,
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
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Every plan value in use must appear here. Unknown -> trial (default deny).
// Aug 2026: AI is available on ALL tiers. trial and starter are capped at 50/mo.
// 'specialist' was retired from title-22.com pricing (folded into the 3-tier
// Starter/Pro/Agency ladder) but is kept here as a legacy mapping so any
// existing or renewing specialist subscription still resolves correctly.
const LIMITS = {
  trial: 50,
  edu: 100000,
  starter: 50,
  pro: 200,
  specialist: 200,
  agency: 500,
};

const PAID_PLANS = ['starter', 'pro', 'specialist', 'agency'];

// Resolve the effective plan: namespaced column, expiry-checked, default deny.
function resolvePlan(profile) {
  const raw = profile?.title22_plan;
  if (!raw || !(raw in LIMITS)) return 'trial';

  const expires = profile?.title22_plan_expires_at;
  if (expires && new Date(expires) < new Date()) return 'trial';

  return raw;
}

async function checkAndDeductCredits(userId, plan, env) {
  const SUPABASE = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  const period = currentPeriod();
  const limit = LIMITS[plan] ?? LIMITS.trial;

  const headers = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const usageUrl =
    `${SUPABASE}/rest/v1/ai_usage?user_id=eq.${userId}&app=eq.title22` +
    `&period_start=eq.${period}&select=id,calls_used,calls_limit`;

  const getRes = await fetch(usageUrl, { headers });
  const rows = getRes.ok ? await getRes.json() : [];
  let row = rows[0];

  // New month or new user: insert a fresh row (old months stay as history)
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

    // Insert conflict (race with a parallel request) — refetch and fall through
    const retryRes = await fetch(usageUrl, { headers });
    const retryRows = retryRes.ok ? await retryRes.json() : [];
    row = retryRows[0];
    if (!row) return { allowed: false, remaining: 0, error: 'usage_row_failed' };
  }

  const used = row.calls_used || 0;

  // The plan is the source of truth, not the stored row. This lets a mid-month
  // upgrade take effect immediately instead of waiting for the next period.
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

  // If the deduction failed, do NOT allow the call — fail closed
  if (!patchRes.ok) return { allowed: false, remaining: 0, error: 'deduct_failed' };

  return { allowed: true, remaining: rowLimit - used - 1, limit: rowLimit };
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight — must be first, before any routing
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check — verifies that all required bindings are present.
    // Returns false for each missing binding so misconfiguration is visible
    // immediately instead of surfacing as a cryptic 401/500 on first use.
    if (request.method === 'GET') {
      return json({
        status: 'ok',
        bindings: {
          SUPABASE_URL: Boolean(env.SUPABASE_URL),
          SUPABASE_SERVICE_KEY: Boolean(env.SUPABASE_SERVICE_KEY),
          ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
        },
      });
      const bindings = {
        anthropic_api_key: !!env.ANTHROPIC_API_KEY,
        supabase_url: !!env.SUPABASE_URL,
        supabase_service_key: !!env.SUPABASE_SERVICE_KEY,
      };
      const ok = Object.values(bindings).every(Boolean);
      return json({ status: ok ? 'ok' : 'misconfigured', bindings }, ok ? 200 : 500);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json();
      const { system, messages, tools, facility_id: facilityId } = body;

      const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
      const user = await getUserFromToken(token, env);
      if (!user?.id) return json({ error: 'Unauthorized' }, 401);

      const profile = await getProfile(user.id, env);
      const plan = resolvePlan(profile);
      const isPaid = PAID_PLANS.includes(plan);
      const isPro = plan === 'pro';

      // ── Dosage / medical-advice safety filter ──────────────────────────────
      // Checked BEFORE credit deduction so a blocked prompt costs nothing.
      // Reject any message that asks for dosage recommendations or tries to
      // jailbreak the assistant into acting as a prescriber. This must be
      // enforced server-side — client-side checks can be bypassed.
      //
      // Only the last user message is inspected: that is what the model acts
      // on. The system prompt is server-controlled and not matched here.
      const lastUserMsg = [...(messages || [])]
        .reverse()
        .find(m => m.role === 'user');
      const userText = (
        typeof lastUserMsg?.content === 'string'
          ? lastUserMsg.content
          : Array.isArray(lastUserMsg?.content)
            ? lastUserMsg.content
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join(' ')
            : ''
      ).toLowerCase();

      const DOSAGE_PATTERNS = [
        /\bhow much\b.{0,60}\b(give|administer|prescribe|take|dose)\b/i,
        /\b(recommend|prescribe|calculate|increase|decrease|adjust)\b.{0,60}\b(dose|dosage|mg|mcg|units?|ml)\b/i,
        /\bwhat (dose|dosage|amount)\b.{0,60}\b(should|can|to)\b/i,
        /\b(dose|dosage)\b.{0,60}\bfor (a |an )?(resident|patient|elderly|senior)\b/i,
        /\bmedical (advice|recommendation|opinion)\b/i,
        /\bpretend (you are|to be).{0,60}\b(doctor|physician|nurse|pharmacist)\b/i,
        /\bignore (your |all )?(previous |prior )?(instructions?|guidelines?|restrictions?|rules?)\b/i,
        /\bact as (a |an )?(doctor|physician|nurse|pharmacist|clinician)\b/i,
      ];

      if (DOSAGE_PATTERNS.some(re => re.test(userText))) {
        // Return in the same shape as a real Anthropic response so the frontend
        // renders it normally (the safety message appears in the chat).
        return json({
          id: 'safety-block',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'text',
            text: "I'm a Title 22 RCFE compliance assistant and can't provide dosage recommendations or prescribing advice — that requires a licensed prescriber. For medication questions, contact the resident's physician or a licensed pharmacist. I can help you document a physician order, look up compliance requirements, or review your MAR policy.",
          }],
          model: 'safety-filter',
          stop_reason: 'safety',
          plan,
          limit: null,
          remaining: null,
          isPaid,
          isPro,
        });
      }
      // ── end safety filter ──────────────────────────────────────────────────
      // Server-side dosage / prescribing safety gate. Patterns mirror the
      // client-side check so a jailbreak that bypasses the frontend still gets
      // refused here before any credit is spent or the model is called.
      const lastUserContent = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
      const DOSAGE_RE = [
        /\bhow much\b.*\b(medication|drug|medicine|pill|tablet|capsule|mg|ml|dose|dosage)\b/i,
        /\b(increase|decrease|change|adjust|modify|double|halve|cut)\b.*\b(dose|dosage|medication|mg|ml)\b/i,
        /\bwhat dose\b/i,
        /\bwhat dosage\b/i,
        /\bmaximum dose\b/i,
        /\blethal dose\b/i,
        /\boverdose\b/i,
        /\bprescribe\b/i,
        /\bshould.*take\b.*\b(mg|ml|pill|tablet|capsule)\b/i,
        /\b(give|administer|prescribing)\b.*\b(how much|amount|quantity)\b/i,
        /\bdrug interaction\b/i,
        /\bmedical advice\b/i,
        /\bdiagnos[ei]\b/i,
      ];
      if (DOSAGE_RE.some(re => re.test(lastUserContent))) {
        return json({
          content: [{ type: 'text', text: "I can't provide dosage recommendations or prescribing advice — that requires a licensed prescriber. I can help with compliance tasks, staff certifications, DSS inspection readiness, and resident documentation." }],
          plan,
          limit: 0,
          remaining: 0,
          blocked: 'dosage_safety'
        });
      }

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

      // Tools are optional and forwarded as-is from the caller (see AI_TOOLS in
      // the frontend's index.html). Anthropic ignores an absent/empty `tools`
      // field, so this is safe for callers that don't send one.
      const anthropicBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: system || 'You are a Title 22 RCFE compliance assistant.',
        messages: messages || [],
      };
      if (Array.isArray(tools) && tools.length) anthropicBody.tools = tools;

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
      if (!response.ok) return json({ error: data }, 500);

      const replyText = extractTextContent(data);
      if (containsDosageAdvice(replyText)) {
        await logDosageRejection({
          userId: user.id,
          facilityId,
          rejectedText: replyText,
        }, env);
        return json({
          content: [{ type: 'text', text: SAFE_DOSAGE_MESSAGE }],
          plan,
          limit: credits.limit,
          remaining: credits.remaining,
          isPaid,
          isPro,
          blocked: true
        });
      }

      return json({
        ...data,
        plan,
        limit: credits.limit,
        remaining: credits.remaining,
        isPaid,
        isPro
      });

    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};
