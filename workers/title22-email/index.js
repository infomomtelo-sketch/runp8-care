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

function displayName(user, fallbackName) {
  return fallbackName || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'there';
}

function normalizePlan(plan) {
  const labels = {
    starter: 'Starter',
    pro: 'Facility',
    specialist: 'Multi-Facility',
    agency: 'Agency',
    edu: 'Education',
  };
  return labels[String(plan || '').toLowerCase()] || 'paid';
}

function emailTemplate(template, payload) {
  const appUrl = payload.app_url || 'https://title22.app/';
  const name = payload.name || 'there';
  if (template === 'welcome') {
    return {
      subject: 'Welcome to Title22',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Welcome to Title22, ${name}.</h2>
          <p>Your free trial is ready. Add your facility, invite your team, and start tracking the records an inspector will ask to see.</p>
          <p><a href="${payload.onboarding_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
        </div>
      `,
    };
  }
  if (template === 'trial_warning') {
    const daysLeft = Number(payload.days_left) || 3;
    return {
      subject: `Your Title22 trial ends in ${daysLeft} days`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Your trial is almost up.</h2>
          <p>Hi ${name}, your Title22 trial ends in <strong>${daysLeft} days</strong>.</p>
          <p>Upgrade to keep access to your facility records, AI help, and billing tools.</p>
          <p><a href="${payload.upgrade_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Upgrade now</a></p>
        </div>
      `,
    };
  }
  if (template === 'subscription_confirmed') {
    return {
      subject: `Your Title22 ${normalizePlan(payload.plan)} plan is active`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Subscription confirmed.</h2>
          <p>Hi ${name}, your <strong>${normalizePlan(payload.plan)}</strong> plan is now active.</p>
          <p>You can go straight back into Title22 and keep working.</p>
          <p><a href="${payload.access_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
        </div>
      `,
    };
  }
  if (template === 'payment_failed') {
    return {
      subject: 'Your Title22 payment needs attention',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">We could not process your payment.</h2>
          <p>Hi ${name}, please update your billing details to keep your Title22 access active.</p>
          <p><a href="${payload.retry_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review billing</a></p>
        </div>
      `,
    };
  }
  return null;
}

// ─── Signup notifications ──────────────────────────────────────────────────
//
// A Supabase Database Webhook on public.profiles POSTs here, and this mails
// the OWNER — not the customer. It is a different shape from every template
// above: no JWT, because a database cannot hold one, so it authenticates on a
// shared secret set as a custom header on the webhook.
//
// WATCH public.profiles, NOT auth.users, and subscribe to INSERT **AND**
// UPDATE. Both halves of that matter:
//
//  - profiles is SHARED with the other apps on this Supabase project, so a
//    plain INSERT there may be a TheJudgy or Thelo signup and not a Title22
//    one. And somebody who already used one of those apps gets an UPDATE when
//    they join Title22, never an INSERT — an INSERT-only webhook misses them
//    silently, which is the worst kind of missing.
//  - profiles carries referred_by. That is how a trainer's student is
//    attributed, and finding out at payout instead of on the day is how a
//    partner relationship goes quiet.
//
// So the row transition is what decides, not the event type.
const T22_PAID_PLANS = ['lite', 'multi', 'starter', 'pro', 'specialist', 'agency'];

// Constant-time compare. The secret is short and the endpoint is public, so a
// naive === leaks its length and prefix to anyone willing to time it.
function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Returns null when this row change is not a Title22 signup or conversion —
// which is most of them, and is NOT an error. See the 200 in the handler.
function signupEvent(record, oldRecord) {
  const now = record && record.title22_plan;
  const before = oldRecord && oldRecord.title22_plan;
  if (!now) return null;                                   // not a Title22 user
  if (!before) {
    return T22_PAID_PLANS.includes(now)
      ? { kind: 'signup_paid', plan: now }                 // paid before they signed up
      : { kind: 'signup', plan: now };
  }
  if (before === now) return null;                         // unrelated column changed
  if (T22_PAID_PLANS.includes(now) && !T22_PAID_PLANS.includes(before)) {
    return { kind: 'converted', plan: now, from: before };
  }
  return null;                                             // trial -> trial, plan relabel, etc.
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function signupEmail(event, record) {
  const ref = record.referred_by;
  const subject =
    event.kind === 'converted'   ? `Title22: ${record.email || 'someone'} upgraded to ${event.plan}` :
    event.kind === 'signup_paid' ? `Title22: new PAID signup (${event.plan})` :
                                   `Title22: new signup${ref ? ' via ' + ref : ''}`;
  const rows = [
    ['Email',       record.email || '(not on the profile row)'],
    ['Plan',        event.plan + (event.from ? ` (was ${event.from})` : '')],
    ['Referred by', ref ? ref + '  ← trainer code' : '—'],
    ['UTM source',  record.title22_utm_source || '—'],
    ['UTM campaign',record.title22_utm_campaign || '—'],
    ['Trial ends',  record.title22_trial_ends_at || '—'],
    ['Profile id',  record.id || '—'],
  ];
  return {
    subject,
    html:
      '<div style="font-family:-apple-system,Arial,sans-serif;line-height:1.55;color:#16312b">' +
      `<h2 style="margin:0 0 4px;font-size:18px">${esc(subject)}</h2>` +
      `<p style="margin:0 0 14px;color:#5b6b66;font-size:13px">${esc(new Date().toISOString())}</p>` +
      '<table style="border-collapse:collapse;font-size:14px">' +
      rows.map(([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#5b6b66;vertical-align:top">${esc(k)}</td>` +
        `<td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('') +
      '</table></div>',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === 'GET') {
      const bindings = {
        resend_api_key: !!env.RESEND_API_KEY,
        email_from: !!env.EMAIL_FROM,
        supabase_url: !!env.SUPABASE_URL,
        supabase_service_key: !!env.SUPABASE_SERVICE_KEY,
      };
      const ok = Object.values(bindings).every(Boolean);
      // Reported separately, and deliberately NOT folded into `ok`: the signup
      // notifier is an optional route, and a health check that goes red because
      // an unused feature is unconfigured is a health check people stop reading.
      const signupNotify = {
        secret: !!env.SIGNUP_WEBHOOK_SECRET,
        notify_to: !!env.SIGNUP_NOTIFY_TO,
      };
      return json({
        status: ok ? 'ok' : 'misconfigured',
        bindings,
        signup_notify_ready: Object.values(signupNotify).every(Boolean),
        signup_notify: signupNotify,
      }, ok ? 200 : 500);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Signup notification from the Supabase Database Webhook. Checked BEFORE
    // the JWT path below, because this caller has no JWT and never will.
    if (new URL(request.url).pathname.endsWith('/notify-signup')) {
      return notifySignup(request, env);
    }

    try {
      const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
      const user = await getUserFromToken(token, env);
      if (!user?.id || !user?.email) return json({ error: 'Unauthorized' }, 401);

      const body = await request.json();
      const template = body?.template;
      const message = emailTemplate(template, {
        ...body,
        name: displayName(user, body?.name),
      });
      if (!message) return json({ error: 'Unknown template' }, 400);

      const to = String(body?.email || user.email || '').trim().toLowerCase();
      if (!to || to !== String(user.email || '').trim().toLowerCase()) {
        return json({ error: 'Email mismatch' }, 403);
      }

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [to],
          subject: message.subject,
          html: message.html,
        }),
      });
      const resendData = await resendRes.json().catch(() => ({}));
      if (!resendRes.ok) return json({ error: resendData }, 502);

      return json({ ok: true, id: resendData.id || null });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};


async function notifySignup(request, env) {
  // Fail closed and say which binding is missing, in the BODY. Supabase records
  // the response against the delivery, and a Worker that answers "misconfigured"
  // is findable; one that answers 500 "error" is four days of guessing. That
  // lesson cost a week on stripe-webhook — see CLAUDE.md.
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'SIGNUP_WEBHOOK_SECRET', 'SIGNUP_NOTIFY_TO']
    .filter(name => !env[name]);
  if (missing.length) {
    return json({ error: 'Worker misconfigured — missing binding(s): ' + missing.join(', ') }, 500);
  }

  const given = request.headers.get('X-Title22-Signup-Secret') || '';
  if (!secretMatches(given, env.SIGNUP_WEBHOOK_SECRET)) {
    return json({ error: 'Bad or missing X-Title22-Signup-Secret' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Body is not JSON' }, 400); }

  const record = body && body.record;
  if (!record) return json({ error: 'No record in payload' }, 400);

  const event = signupEvent(record, body.old_record);
  if (!event) {
    // 200 ON PURPOSE. Most row changes on this shared table are not a Title22
    // signup — another app's user, a column touched by something else, a trial
    // re-stamp. Answering with an error would make pg_net retry a non-event and
    // fill the webhook log with red, and a log that is always red is a log
    // nobody reads. Distinguishing "not ours" from "ours and broken" is the
    // whole point; see the same split in workers/stripe-webhook.
    return json({ ok: true, skipped: 'not a Title22 signup or conversion' });
  }

  const message = signupEmail(event, record);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [env.SIGNUP_NOTIFY_TO],
      subject: message.subject,
      html: message.html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: 'Resend refused', detail: data }, 502);
  return json({ ok: true, kind: event.kind, id: data.id || null });
}
