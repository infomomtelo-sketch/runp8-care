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
      return json({ status: ok ? 'ok' : 'misconfigured', bindings }, ok ? 200 : 500);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
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
