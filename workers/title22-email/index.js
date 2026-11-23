const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title22-Signup-Secret, X-Title22-Service-Secret',
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

// The packages (Nov 19, 2026): ONE price covering tracking + staff training.
// The pkg keys are what profiles.title22_package carries and what
// stripe-webhook passes on a payment notification. A subscriber with no
// package (a legacy plan) falls back to the tier their plan key names, at
// the same headline prices — the package prices replaced the old ones
// dollar for dollar.
// The offer story (Nov 20, 2026, Eli's decision): the front door is the
// FREE home — 1 home, records, no online courses, no time limit, never
// locked. A package is the step up an owner takes when they need the
// staff training; $29 (1 home) is the gate price.
const PACKAGE_INFO = {
  pkg1: { label: 'Title22 package — 1 home + training', price: '$29/month', training: true },
  pkg2: { label: 'Title22 package — 2–5 homes + training', price: '$79/month', training: true },
  pkg3: { label: 'Title22 package — 6+ homes + training', price: '$139/month', training: true },
};

// The Staff Training Add-On tiers (CTC agreement, Exhibit A), keyed by
// the tier keys stripe-webhook passes as payload.addon (added 2026-11-22
// with the add-on activation fix). An add-on is NOT a plan and NOT a
// package, so planInfo answers it ahead of both, with training on: the
// confirmation can then say plainly that training is now on in the
// account, and the payment-failure email never tells an add-on buyer
// their "package" ended.
const ADDON_INFO = {
  small:  { label: 'Staff Training Add-On — Small (1–6 licensed beds)', price: '$20/month' },
  medium: { label: 'Staff Training Add-On — Medium (7–15 licensed beds)', price: '$35/month' },
  large:  { label: 'Staff Training Add-On — Large (16–49 licensed beds)', price: '$60/month' },
  xl:     { label: 'Staff Training Add-On — Extra Large (50+ licensed beds)', price: '$100/month' },
};

function planInfo(payload) {
  const addon = ADDON_INFO[String(payload.addon || '').toLowerCase()];
  if (addon) return { ...addon, training: true, addon: true };
  const pkg = PACKAGE_INFO[String(payload.package || '').toLowerCase()];
  if (pkg) return pkg;
  const legacy = {
    lite: { label: 'Title22 — 1 home', price: '$29/month' },
    multi: { label: 'Title22 — 2–5 homes', price: '$79/month' },
  };
  const base = legacy[String(payload.plan || '').toLowerCase()] ||
    { label: 'Title22 plan', price: null };
  return { ...base, training: !!payload.training_included };
}

function emailTemplate(template, payload) {
  const appUrl = payload.app_url || 'https://title22.app/';
  const name = payload.name || 'there';
  if (template === 'welcome') {
    return {
      subject: 'Welcome to Title22 — your home is free',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Welcome to Title22, ${name}.</h2>
          <p>Your home is free — no time limit, no card taken, and nothing will be charged. Add your facility, invite your team, and start tracking the records an inspector will ask to see. Your home stays free for as long as you use it.</p>
          <p><a href="${payload.onboarding_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
          <p>The one step up is staff training. When your team needs their courses, that is the moment a package starts — one price covering tracking <strong>and</strong> staff training. Until then, nothing is owed and nothing expires: the free home is yours, records and all.</p>
          <div style="border:1px solid #d8e2dc;border-radius:10px;padding:14px 16px;margin-top:20px">
            <p style="margin:0 0 6px"><strong>Staff training is built in.</strong> The courses inside Title22 come from our partner CTC, a CDSS-approved training provider. Pick any package and your staff train online, and each completion files itself into their Title22 staff record — no separate system, no chasing certificates.</p>
            <p style="margin:0"><a href="https://title22-addon-pay.pages.dev/">See the training courses</a></p>
          </div>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'trial_warning') {
    const daysLeft = Number(payload.days_left) || 3;
    const dayWord = daysLeft === 1 ? 'day' : 'days';
    return {
      subject: `Your Title22 home stays free — the full-access window ends in ${daysLeft} ${dayWord}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Your home stays free.</h2>
          <p>Hi ${name}, your 30-day full-access window ends in <strong>${daysLeft} ${dayWord}</strong> — and that is all that changes.</p>
          <p>Your home stays on the <strong>Free plan</strong>: one home, your records keep working, and everything you entered stays right where you left it. There is no card on file, so nothing will be charged and there is nothing to cancel. Nothing is taken away, and nothing is locked.</p>
          <p>What pauses is the extras from the full-access window: the online training courses (they are part of the paid packages), and Tello Staff's free proof period ends.</p>
          <p>When your team needs their training, that is the step up — one price for tracking + staff training.</p>
          <p><a href="${payload.upgrade_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">See the packages</a></p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'subscription_confirmed') {
    const info = planInfo(payload);
    if (info.addon) {
      // The add-on confirmation (2026-11-22): its own copy, because the
      // package wording would lie twice over — there is no package, and
      // "nothing else is charged unless you choose an add-on" makes no
      // sense to someone who just chose one. What the buyer is owed,
      // said plainly: training is now ON in their account. The one step
      // that is still done by a person — the by-hand order check before
      // staff are enrolled on CTC's platform — is named as exactly
      // that, the same promise the checkout page itself makes.
      return {
        subject: `Your ${info.label} is active`,
        html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Training is on.</h2>
          <p>Hi ${name}, your <strong>${info.label}</strong> is now active at <strong>${info.price}</strong>. It renews monthly until you cancel.</p>
          <p>Staff training is now on in your Title22 account. The courses are provided by CTC, a CDSS-approved training provider, and every certificate goes straight onto the staff record in Title22.</p>
          <p>One step is still done by a person: we check each order by hand before staff are enrolled on the course platform. You will hear from us at this email when your staff can start.</p>
          <p><a href="${payload.access_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
      };
    }
    return {
      subject: `Your ${info.label} is active`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Subscription confirmed.</h2>
          <p>Hi ${name}, your <strong>${info.label}</strong> is now active${info.price ? ` at <strong>${info.price}</strong>` : ''}. It renews monthly until you cancel — and nothing else is charged unless you choose an add-on yourself.</p>
          ${info.training ? '<p>Staff training is included in your package: your team can start the courses inside Title22, and every completion files itself into their staff record.</p>' : ''}
          <p>One more thing, only if you want it: Tello Staff — the schedule board for your homes — is free during a 30-day proof, then $10/month per home, and only if you turn it on.</p>
          <p><a href="${payload.access_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'payment_failed') {
    const info = planInfo(payload);
    const amount = payload.amount_due != null && Number.isFinite(Number(payload.amount_due))
      ? `$${Number(payload.amount_due).toFixed(2)}` : null;
    return {
      subject: 'Your Title22 payment didn\'t go through',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">We could not process your payment.</h2>
          <p>Hi ${name}, the latest payment for your <strong>${info.label}</strong>${amount ? ` (${amount})` : ''} didn't go through. Nothing is cancelled and nothing is deleted.</p>
          <p>Stripe retries automatically over the next few days. Updating your card now is the fastest fix:</p>
          <p><a href="${payload.retry_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review billing</a></p>
          ${info.addon
            ? '<p>If the payment still can\'t be collected, the add-on ends and staff training pauses — your Title22 account and your records are not affected.</p>'
            : '<p>If the payment still can\'t be collected, your paid package ends and your account returns to the Free plan — your home stays free, your records stay in place, and training pauses until you restart a package.</p>'}
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'offers_followup') {
    // The one offers email (Nov 20, 2026, Eli's funnel decision): sent once
    // to a free account ~10 days after signup. Unlike welcome and
    // trial_warning, this IS a money moment, so prices are stated plainly
    // (decision 0b protects the free-home offer, not an offers email) —
    // but the free home is never threatened: it opens and closes on the
    // home staying free. MAR and ADL are deliberately absent — MAR is
    // gated (no payment link), ADL is built-but-removed (no payment
    // link); no fake doors. See DESIGN.md decision 0c.
    return {
      subject: 'Your home is running — here\'s what Title22 can take off your plate next',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Your home is running, ${name}.</h2>
          <p>Your records are in one place now, and your home stays free for as long as you use it — that does not change. This is just the short list of what else Title22 can carry when you want it carried. Nothing here is required, and nothing is on a timer.</p>
          <div style="border:1px solid #d8e2dc;border-radius:10px;padding:14px 16px;margin-top:20px">
            <p style="margin:0 0 6px"><strong>1. Staff training, handled.</strong> The courses inside Title22 come from our partner CTC, a CDSS-approved training provider. Your staff train online, and every completion files itself into their Title22 staff record — no separate system, no chasing certificates.</p>
            <p style="margin:0 0 6px">Training comes with a package — one price covering tracking <strong>and</strong> staff training: <strong>$29/month for 1 home, $79/month for 2–5 homes, $139/month for 6 or more</strong>.</p>
            <p style="margin:0"><a href="${payload.upgrade_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">See the packages</a></p>
          </div>
          <div style="border:1px solid #d8e2dc;border-radius:10px;padding:14px 16px;margin-top:16px">
            <p style="margin:0 0 6px"><strong>2. Tello Staff, the daily board.</strong> The schedule and today's shifts in one place, with clock-ins checked by a selfie and a location stamp — so hours are never a guess, and the schedule questions come to the board instead of to you.</p>
            <p style="margin:0 0 6px">It is free during a 30-day proof, then <strong>$10/month per home</strong> — and only if you turn it on.</p>
            <p style="margin:0"><a href="https://staff.tello.live">See Tello Staff</a></p>
          </div>
          <p style="margin-top:20px">Take any of it, or none of it. Your home stays free either way — these are only here for the day they save you a headache.</p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'refund_training_removed') {
    // The buyer's half of Eli's refund rule (Nov 23, 2026): a FULL
    // refund cancels ONLY the training. What the copy may say is set by
    // what stripe-webhook actually did and passes in — for a package,
    // records_renewal is true only when the subscription really sits on
    // the $9 records-only price afterwards (swapped, or already there).
    // When the swap failed, the $9 renewal is NOT promised here: the
    // refund and the training cancellation are stated, the records are
    // stated safe, and the owner alert names the failed swap for a
    // by-hand fix. The add-on variant has no subscription to continue:
    // the add-on WAS the training, so its copy says the account itself
    // is untouched. Both variants keep the door open in words, matching
    // the app: with the flag off, the training add-on is offered again.
    const info = planInfo(payload);
    const amount = payload.refund_amount != null && Number.isFinite(Number(payload.refund_amount))
      ? `$${Number(payload.refund_amount).toFixed(2)}` : (info.price || null);
    if (payload.refund_kind === 'addon' || info.addon) {
      return {
        subject: 'Your add-on refund is complete',
        html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Your refund is complete.</h2>
          <p>Hi ${name}, the full refund${amount ? ` of <strong>${amount}</strong>` : ''} for your <strong>${info.label}</strong> is complete. The add-on is cancelled, and staff training is now off.</p>
          <p>Your Title22 account itself is untouched: your home, your records, and everything you entered stay right where they are.</p>
          <p>You can add training back any time — the training add-on is still offered inside Title22 whenever your team needs it.</p>
          <p><a href="${payload.access_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
      };
    }
    return {
      subject: 'Your refund is complete — training is cancelled',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16312b">
          <h2 style="margin:0 0 12px">Your refund is complete.</h2>
          <p>Hi ${name}, the full refund${amount ? ` of <strong>${amount}</strong>` : ''} for your <strong>${info.label}</strong> is complete. Staff training is cancelled, and it is now off in your account.</p>
          ${payload.records_renewal
            ? '<p>Your subscription itself continues — as records only. From your next renewal it is <strong>$9/month</strong>: your home, your records, and everything you entered stay right where they are. Only the training is gone.</p>'
            : '<p>Your home, your records, and everything you entered stay right where they are. Only the training is gone.</p>'}
          <p>You can add training back any time — the training add-on is still offered inside Title22 whenever your team needs it.</p>
          <p><a href="${payload.access_url || appUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Title22</a></p>
          <p style="font-size:13px;color:#5b6a63;margin-top:20px">Follow Title22: title-22.com/follow</p>
        </div>
      `,
    };
  }
  if (template === 'addon_owner_alert') {
    // Not a customer template: the OWNER's task notice for a training
    // add-on activation, built by addonOwnerAlertEmail() below and sent
    // only by /notify-addon-owner to SIGNUP_NOTIFY_TO. It lives here so
    // it rides sendOnce — the one claim-before-send path — like every
    // other phase-2 email.
    return addonOwnerAlertEmail(payload);
  }
  if (template === 'refund_owner_alert') {
    // Likewise not a customer template: the OWNER's task notice for a
    // refund, built by refundOwnerAlertEmail() below and sent only by
    // /notify-refund-owner to SIGNUP_NOTIFY_TO — the mirror of the
    // activation alert above (activation enrolls by hand; a refund
    // UNenrolls by hand).
    return refundOwnerAlertEmail(payload);
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

// The add-on owner alert (2026-11-22, the owner-alert addition to the
// add-on fix): when a Staff Training Add-On activates, the buyer's
// confirmation promises them a by-hand order check before their staff
// are enrolled on CTC's platform. That promise is a job for the OWNER,
// and until this existed nothing told him the job was due — no admin
// screen, no email; he would have had to notice a Stripe subscription.
// This is that notice, in the signup alert's shape (owner mail, not
// customer mail): who bought, which tier, which subscription, and the
// job stated plainly. It renders through emailTemplate like every other
// send so it rides the same claim-before-send path (sendOnce) — its
// dedupe key is its own (addon_owner_alert:<subscription id>), so it
// can neither block nor be blocked by the buyer's confirmation.
function addonOwnerAlertEmail(payload) {
  const info = ADDON_INFO[String(payload.addon || '').toLowerCase()] ||
    { label: 'Staff Training Add-On', price: null };
  const buyer = payload.buyer_email || '(buyer email not supplied)';
  const subject = `Training add-on active: ${buyer} — enrollment check due`;
  const rows = [
    ['Buyer account', buyer],
    ['Add-on', info.label],
    ['Price', info.price || '—'],
    ['Stripe subscription', payload.subscription_id || '—'],
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
      '</table>' +
      `<p style="margin:14px 0 0;font-size:14px">The job: check this order by hand, enroll the home's staff on CTC's LearnUpon platform, then email the buyer at <strong>${esc(buyer)}</strong> when their staff can start. That by-hand check is what the buyer's confirmation email promised them.</p>` +
      '</div>',
  };
}

// The refund owner alert (2026-11-23, Eli's refund rule): the mirror of
// the activation alert above. Activation's by-hand half is enrolling the
// home's staff on CTC's LearnUpon platform; a full refund's by-hand half
// is UNenrolling them, and until this existed nothing told the owner
// that job was due either. Same shape as the activation alert (owner
// mail, not customer mail), same claim-before-send path, its own dedupe
// key (refund_owner_alert:<charge id>). When the package price swap
// failed, the Subscription row says so in as many words — this alert is
// the by-hand fix list, not just a notification.
function refundOwnerAlertEmail(payload) {
  const isAddon = payload.kind === 'addon';
  const info = isAddon
    ? (ADDON_INFO[String(payload.addon || '').toLowerCase()] || { label: 'Staff Training Add-On', price: null })
    : (PACKAGE_INFO[String(payload.package || '').toLowerCase()] || { label: 'Title22 package', price: null });
  const buyer = payload.buyer_email || '(buyer email not supplied)';
  const subject = `Refund: ${buyer} — training off, enrollment check due`;
  const subscriptionRow = isAddon
    ? 'No package subscription — nothing to swap'
    : payload.swap_failed
      ? 'PRICE SWAP FAILED — ' + (payload.swap_note || 'see the stripe-webhook delivery log') + ' — swap it to the $9 records-only price by hand'
      : 'Continues at $9/month, records only, from the next renewal';
  const rows = [
    ['Buyer account', buyer],
    ['Refunded', info.label + (info.price ? ` (${info.price})` : '')],
    ['Training', 'Cancelled — now off in their account'],
    ['Subscription', subscriptionRow],
    ['Stripe subscription', payload.subscription_id || '—'],
    ['Stripe charge', payload.charge_id || '—'],
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
      '</table>' +
      `<p style="margin:14px 0 0;font-size:14px">The job: UNENROLL the home's staff on CTC's LearnUpon platform — this refund cancelled their training, and their course access ends with it. The refund, the training flag and the buyer's email are already handled; the unenrollment is the by-hand half.</p>` +
      '</div>',
  };
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

// ─── Phase 2: customer email triggers (Nov 20, 2026) ───────────────────────
//
// The four templates above finally get callers, and a fifth template —
// offers_followup, new in this pack — rides the trial scan's cron:
//
//   welcome                 <- POST /notify-welcome, fired by a pg_net
//                              trigger on public.profiles — the same rail,
//                              the same secret, as the owner signup alert,
//                              but its OWN trigger and endpoint, so a bug
//                              here can never break the proven alert.
//   subscription_confirmed  <- POST /notify-payment, called by
//   payment_failed             workers/stripe-webhook, which holds the
//                              payment context but no user session. It
//                              authenticates on a shared secret of its own
//                              (EMAIL_SERVICE_SECRET, set on BOTH Workers).
//   addon_owner_alert       <- POST /notify-addon-owner, called by the
//                              same stripe-webhook on the same secret,
//                              at the moment a training add-on activates:
//                              the OWNER's notice (to SIGNUP_NOTIFY_TO)
//                              that the by-hand CTC enrollment check the
//                              buyer's confirmation promised is now due.
//   refund_training_removed <- POST /notify-payment (the same route, a
//                              third template), called by stripe-webhook
//                              reacting to a FULL charge.refunded: the
//                              training is off, and a package buyer is
//                              told their subscription continues at $9
//                              records-only — only when it really does.
//   refund_owner_alert      <- POST /notify-refund-owner, the refund's
//                              sibling of the activation alert: the
//                              OWNER's notice (to SIGNUP_NOTIFY_TO) that
//                              the home's staff must be UNENROLLED on
//                              CTC's platform, and — when the price swap
//                              failed — that the swap is his to do by
//                              hand.
//   trial_warning           <- this Worker's own cron (see [triggers] in
//                              wrangler.toml): a daily scan of profiles for
//                              trials ending within 3 days.
//   offers_followup         <- the same cron: a daily scan for free
//                              accounts ~10 days after signup, mailed the
//                              other offers (training packages, Tello
//                              Staff) exactly once per account.
//
// Every send first CLAIMS a row in public.title22_email_log. The claim is
// the send: dedupe_key is that table's primary key, so a second claim for
// the same key inserts nothing and the send is skipped. That one mechanism
// is what makes "exactly once" survive pg_net refires, Stripe redeliveries
// and cron re-runs. If Resend refuses after a successful claim, the claim
// is released, so the next retry (or the next day's scan) can try again.

function serviceHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

// The customer's email and name live on the AUTH user, not the profiles row
// — profiles has no email column, which is why the owner alert above prints
// "(not on the profile row)" when it reaches for one. The service key reads
// any auth user by id.
async function lookupAuthUser(env, userId) {
  if (!userId) return null;
  const res = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers: serviceHeaders(env) }
  );
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

async function claimEmail(env, dedupeKey, userId, template) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/title22_email_log`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'Prefer': 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ dedupe_key: dedupeKey, user_id: userId || null, template }),
  });
  if (!res.ok) throw new Error('title22_email_log claim failed: HTTP ' + res.status);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;   // empty = already claimed = already sent
}

async function releaseClaim(env, dedupeKey) {
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/title22_email_log?dedupe_key=eq.${encodeURIComponent(dedupeKey)}`,
    { method: 'DELETE', headers: serviceHeaders(env) }
  ).catch(() => {});
}

async function stampClaim(env, dedupeKey, resendId) {
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/title22_email_log?dedupe_key=eq.${encodeURIComponent(dedupeKey)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ resend_id: resendId }),
    }
  ).catch(() => {});
}

async function sendEmail(env, to, message) {
  const res = await fetch('https://api.resend.com/emails', {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data };
  return { ok: true, id: data.id || null };
}

// Claim -> send -> stamp, the one path every phase-2 email takes. Returns
// { sent: true, id } or { sent: false, skipped: <why> }. Throws only on a
// broken claim (a missing log table must be LOUD, not a silent no-send).
async function sendOnce(env, { dedupeKey, userId, template, to, payload }) {
  if (!(await claimEmail(env, dedupeKey, userId, template))) {
    return { sent: false, skipped: 'already sent (' + dedupeKey + ')' };
  }
  const message = emailTemplate(template, payload);
  if (!message) {
    await releaseClaim(env, dedupeKey);
    return { sent: false, skipped: 'unknown template' };
  }
  const result = await sendEmail(env, to, message);
  if (!result.ok) {
    await releaseClaim(env, dedupeKey);
    const err = new Error('Resend refused');
    err.detail = result.error;
    throw err;
  }
  await stampClaim(env, dedupeKey, result.id);
  return { sent: true, id: result.id };
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
      // Phase 2 (Nov 20, 2026): the stripe-webhook -> /notify-payment route
      // authenticates on its own shared secret. Reported separately, for
      // the same reason as the signup notifier above.
      const paymentNotify = {
        service_secret: !!env.EMAIL_SERVICE_SECRET,
      };
      return json({
        status: ok ? 'ok' : 'misconfigured',
        bindings,
        signup_notify_ready: Object.values(signupNotify).every(Boolean),
        signup_notify: signupNotify,
        payment_notify_ready: Object.values(paymentNotify).every(Boolean),
        payment_notify: paymentNotify,
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

    // Phase 2 routes (Nov 20, 2026). Both are secret-authenticated service
    // calls, not user calls, so they sit with /notify-signup above — before
    // the JWT path, which would only ever refuse them.
    if (new URL(request.url).pathname.endsWith('/notify-welcome')) {
      return notifyWelcome(request, env);
    }
    if (new URL(request.url).pathname.endsWith('/notify-payment')) {
      return notifyPayment(request, env);
    }
    if (new URL(request.url).pathname.endsWith('/notify-addon-owner')) {
      return notifyAddonOwner(request, env);
    }
    if (new URL(request.url).pathname.endsWith('/notify-refund-owner')) {
      return notifyRefundOwner(request, env);
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
  },

  // The daily scheduler: wrangler.toml's [triggers] fires this once a day.
  // The scans themselves live below (scanTrialWarnings, scanOffersFollowups)
  // so they can also be read top to bottom without the export object in
  // the way.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyScans(env));
  },
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

// ─── Welcome, on the signup rail ───────────────────────────────────────────
//
// A SECOND pg_net trigger on public.profiles (sql/welcome-trigger.sql in
// the phase-2 pack) POSTs the same webhook shape here, with the same
// X-Title22-Signup-Secret header — one secret, two triggers, two endpoints.
// The row transition decides, exactly as in signupEvent(): the first time a
// profile shows a Title22 plan where there was none, that account is new,
// and it gets the welcome. Conversions (trial -> paid) are NOT welcomes;
// they are subscription_confirmed's job, from the Stripe side.
async function notifyWelcome(request, env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'SIGNUP_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
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
  if (!event || (event.kind !== 'signup' && event.kind !== 'signup_paid')) {
    // 200 on purpose — same reasoning as /notify-signup: most row changes
    // are not a new Title22 account, and a red log is a log nobody reads.
    return json({ ok: true, skipped: 'not a new Title22 signup' });
  }

  try {
    const user = await lookupAuthUser(env, record.id);
    const to = String((user && user.email) || record.email || '').trim().toLowerCase();
    if (!to) return json({ ok: true, skipped: 'no email found for this user' });

    const outcome = await sendOnce(env, {
      dedupeKey: 'welcome:' + (record.id || to),
      userId: record.id || null,
      template: 'welcome',
      to,
      payload: { name: displayName(user, null) },
    });
    if (!outcome.sent) return json({ ok: true, skipped: outcome.skipped });
    return json({ ok: true, kind: event.kind, id: outcome.id });
  } catch (err) {
    return json({ error: err.message, detail: err.detail || undefined }, 502);
  }
}

// ─── Payment emails, called by stripe-webhook ──────────────────────────────
//
// stripe-webhook holds the payment context (which subscription, which
// invoice, which attempt) but has no user session, so — like the signup
// rail — this route authenticates on a shared secret instead of a JWT:
// EMAIL_SERVICE_SECRET, set on BOTH Workers, sent as
// X-Title22-Service-Secret. The caller also names the dedupe key, because
// only the caller knows what makes this notification unique (a subscription
// id; an invoice id + attempt count). The claim in title22_email_log is
// what enforces it.
async function notifyPayment(request, env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_SERVICE_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter(name => !env[name]);
  if (missing.length) {
    return json({ error: 'Worker misconfigured — missing binding(s): ' + missing.join(', ') }, 500);
  }

  const given = request.headers.get('X-Title22-Service-Secret') || '';
  if (!secretMatches(given, env.EMAIL_SERVICE_SECRET)) {
    return json({ error: 'Bad or missing X-Title22-Service-Secret' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Body is not JSON' }, 400); }

  const template = body && body.template;
  if (template !== 'subscription_confirmed' && template !== 'payment_failed' && template !== 'refund_training_removed') {
    return json({ error: 'template must be subscription_confirmed, payment_failed or refund_training_removed' }, 400);
  }
  const dedupeKey = String((body && body.dedupe_key) || '');
  if (!dedupeKey || dedupeKey.length > 200) {
    return json({ error: 'dedupe_key is required (max 200 chars)' }, 400);
  }

  try {
    // The caller passes the Stripe customer's email; the auth record is the
    // fallback and the name source, because Stripe does not know names.
    const user = body.user_id ? await lookupAuthUser(env, body.user_id) : null;
    const to = String(body.email || (user && user.email) || '').trim().toLowerCase();
    if (!to) return json({ error: 'No recipient email (body.email and auth lookup both empty)' }, 422);

    const outcome = await sendOnce(env, {
      dedupeKey,
      userId: body.user_id || null,
      template,
      to,
      payload: {
        name: displayName(user, body.name || null),
        plan: body.plan || null,
        package: body.package || null,
        addon: body.addon || null,
        training_included: !!body.training_included,
        amount_due: body.amount_due != null ? body.amount_due : null,
        // Refund template only (2026-11-23): which half of the rule
        // fired, whether the $9 records-only renewal is real (the
        // template promises it only then), and the refunded amount.
        refund_kind: body.refund_kind || null,
        records_renewal: !!body.records_renewal,
        refund_amount: body.refund_amount != null ? body.refund_amount : null,
        retry_url: body.retry_url || null,
        access_url: body.access_url || null,
      },
    });
    if (!outcome.sent) return json({ ok: true, skipped: outcome.skipped });
    return json({ ok: true, id: outcome.id });
  } catch (err) {
    return json({ error: err.message, detail: err.detail || undefined }, 502);
  }
}

// ─── Add-on owner alert, called by stripe-webhook ──────────────────────────
//
// The sibling of /notify-payment above: same caller, same shared secret
// (EMAIL_SERVICE_SECRET), same claim-before-send path — but the recipient
// is the OWNER (SIGNUP_NOTIFY_TO, the signup alert's address; no new
// configuration), and what is sent is a task, not a receipt. stripe-webhook
// calls this only when its add-on branch grants training, and names the
// dedupe key (addon_owner_alert:<subscription id>) — its OWN key, separate
// from the buyer confirmation's subscription_confirmed:<subscription id>,
// so neither send can block the other, and a Stripe redelivery of the
// activation event re-enters here and is stopped by the claim, not by
// luck. If the send itself fails, sendOnce has already released the
// claim, so a later redelivery can still deliver the alert.
async function notifyAddonOwner(request, env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_SERVICE_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SIGNUP_NOTIFY_TO']
    .filter(name => !env[name]);
  if (missing.length) {
    return json({ error: 'Worker misconfigured — missing binding(s): ' + missing.join(', ') }, 500);
  }

  const given = request.headers.get('X-Title22-Service-Secret') || '';
  if (!secretMatches(given, env.EMAIL_SERVICE_SECRET)) {
    return json({ error: 'Bad or missing X-Title22-Service-Secret' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Body is not JSON' }, 400); }

  const dedupeKey = String((body && body.dedupe_key) || '');
  if (!dedupeKey || dedupeKey.length > 200) {
    return json({ error: 'dedupe_key is required (max 200 chars)' }, 400);
  }
  const addon = String((body && body.addon) || '').toLowerCase();
  if (!ADDON_INFO[addon]) {
    return json({ error: 'addon must be one of: ' + Object.keys(ADDON_INFO).join(', ') }, 400);
  }

  try {
    // The buyer ACCOUNT email is the address the enrollment job ends
    // with ("email the buyer when their staff can start"), so the auth
    // record — the account itself — outranks the address the caller
    // passes, which is the Stripe customer's (the payer's) email and is
    // routinely a different inbox. The caller's address is the fallback
    // for when the lookup cannot be made.
    const user = body.user_id ? await lookupAuthUser(env, body.user_id) : null;
    const buyerEmail = String((user && user.email) || body.buyer_email || '').trim().toLowerCase();
    if (!buyerEmail) {
      return json({ error: 'No buyer email (auth lookup and body.buyer_email both empty)' }, 422);
    }

    const outcome = await sendOnce(env, {
      dedupeKey,
      userId: body.user_id || null,
      template: 'addon_owner_alert',
      to: env.SIGNUP_NOTIFY_TO,
      payload: {
        buyer_email: buyerEmail,
        addon,
        subscription_id: body.subscription_id || null,
      },
    });
    if (!outcome.sent) return json({ ok: true, skipped: outcome.skipped });
    return json({ ok: true, id: outcome.id });
  } catch (err) {
    return json({ error: err.message, detail: err.detail || undefined }, 502);
  }
}

// ─── Refund owner alert, called by stripe-webhook ──────────────────────────
//
// The refund's sibling of /notify-addon-owner above: same caller, same
// shared secret (EMAIL_SERVICE_SECRET), same claim-before-send path,
// same recipient (SIGNUP_NOTIFY_TO) — but the task runs the other way.
// Activation's alert says an enrollment check is due; this one says an
// UNenrollment is due, because a full refund cancelled the training the
// enrollment fed. The caller names the dedupe key
// (refund_owner_alert:<charge id>) — its own key, separate from the
// buyer's refund_buyer:<charge id>, so neither send can block the
// other. kind says which half of the rule fired: a package refund
// (package named; swap_failed carried through so the alert can name a
// swap the owner must do by hand) or an add-on refund (tier named; no
// swap exists). Buyer-email resolution matches the activation alert:
// the auth record's account email outranks the Stripe payer email the
// caller passes.
async function notifyRefundOwner(request, env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_SERVICE_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SIGNUP_NOTIFY_TO']
    .filter(name => !env[name]);
  if (missing.length) {
    return json({ error: 'Worker misconfigured — missing binding(s): ' + missing.join(', ') }, 500);
  }

  const given = request.headers.get('X-Title22-Service-Secret') || '';
  if (!secretMatches(given, env.EMAIL_SERVICE_SECRET)) {
    return json({ error: 'Bad or missing X-Title22-Service-Secret' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Body is not JSON' }, 400); }

  const dedupeKey = String((body && body.dedupe_key) || '');
  if (!dedupeKey || dedupeKey.length > 200) {
    return json({ error: 'dedupe_key is required (max 200 chars)' }, 400);
  }
  const kind = String((body && body.kind) || '').toLowerCase();
  if (kind !== 'package' && kind !== 'addon') {
    return json({ error: 'kind must be package or addon' }, 400);
  }
  const addon = String((body && body.addon) || '').toLowerCase();
  if (kind === 'addon' && !ADDON_INFO[addon]) {
    return json({ error: 'addon must be one of: ' + Object.keys(ADDON_INFO).join(', ') }, 400);
  }
  const pkg = String((body && body.package) || '').toLowerCase();
  if (kind === 'package' && !PACKAGE_INFO[pkg]) {
    return json({ error: 'package must be one of: ' + Object.keys(PACKAGE_INFO).join(', ') }, 400);
  }

  try {
    const user = body.user_id ? await lookupAuthUser(env, body.user_id) : null;
    const buyerEmail = String((user && user.email) || body.buyer_email || '').trim().toLowerCase();
    if (!buyerEmail) {
      return json({ error: 'No buyer email (auth lookup and body.buyer_email both empty)' }, 422);
    }

    const outcome = await sendOnce(env, {
      dedupeKey,
      userId: body.user_id || null,
      template: 'refund_owner_alert',
      to: env.SIGNUP_NOTIFY_TO,
      payload: {
        buyer_email: buyerEmail,
        kind,
        package: kind === 'package' ? pkg : null,
        addon: kind === 'addon' ? addon : null,
        swap_failed: !!body.swap_failed,
        swap_note: body.swap_note || null,
        subscription_id: body.subscription_id || null,
        charge_id: body.charge_id || null,
      },
    });
    if (!outcome.sent) return json({ ok: true, skipped: outcome.skipped });
    return json({ ok: true, id: outcome.id });
  } catch (err) {
    return json({ error: err.message, detail: err.detail || undefined }, 502);
  }
}

// ─── Trial warnings, on this Worker's cron ─────────────────────────────────
//
// Daily scan (see [triggers] in wrangler.toml): profiles still on trial
// whose trial ends within the next 4 days. A warning is sent the first day
// the trial is 3 or fewer days out, saying exactly how many days are left
// (ceil, so "3 days" on the morning it becomes true) — and the dedupe key
// carries the trial's end date, so the same trial can never be warned
// twice, while a genuinely new trial (new end date) can.
async function scanTrialWarnings(env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter(name => !env[name]);
  if (missing.length) {
    console.error('trial_warning scan skipped — missing binding(s): ' + missing.join(', '));
    return { scanned: 0, sent: 0 };
  }

  const now = Date.now();
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?title22_plan=eq.trial` +
    `&title22_trial_ends_at=gt.${encodeURIComponent(new Date(now).toISOString())}` +
    `&title22_trial_ends_at=lt.${encodeURIComponent(new Date(now + 4 * 864e5).toISOString())}` +
    `&select=id,title22_trial_ends_at&order=title22_trial_ends_at.asc&limit=200`;
  const res = await fetch(url, { headers: serviceHeaders(env) });
  if (!res.ok) {
    console.error('trial_warning scan failed — profiles read: HTTP ' + res.status);
    return { scanned: 0, sent: 0 };
  }
  const rows = (await res.json().catch(() => [])) || [];

  let sent = 0;
  for (const row of rows) {
    try {
      const endsMs = Date.parse(row.title22_trial_ends_at);
      if (!endsMs) continue;
      const daysLeft = Math.ceil((endsMs - now) / 864e5);
      if (daysLeft < 1 || daysLeft > 3) continue;   // first touch inside the 3-day window

      const user = await lookupAuthUser(env, row.id);
      const to = String((user && user.email) || '').trim().toLowerCase();
      if (!to) continue;

      const outcome = await sendOnce(env, {
        dedupeKey: `trial_warning:${row.id}:${String(row.title22_trial_ends_at).slice(0, 10)}`,
        userId: row.id,
        template: 'trial_warning',
        to,
        payload: { name: displayName(user, null), days_left: daysLeft },
      });
      if (outcome.sent) sent++;
    } catch (err) {
      // One bad row must not stop the scan; the claim was released inside
      // sendOnce, so tomorrow's run retries this account on its own.
      console.error('trial_warning failed for profile', row.id, (err && err.message) || String(err));
    }
  }
  console.log(`trial_warning scan: ${rows.length} trial(s) ending within 4 days, ${sent} warning(s) sent`);
  return { scanned: rows.length, sent };
}

// ─── The daily cron runs both scans ────────────────────────────────────────
//
// One cron tick, two scans, back to back: trial warnings first (they are
// time-critical), then the offers follow-ups. Each scan guards its own
// rows; this wrapper guards the scans themselves, so a failure in one can
// never take the other down with it.
async function runDailyScans(env) {
  try { await scanTrialWarnings(env); }
  catch (err) { console.error('trial_warning scan crashed', (err && err.message) || String(err)); }
  try { await scanOffersFollowups(env); }
  catch (err) { console.error('offers_followup scan crashed', (err && err.message) || String(err)); }
}

// ─── Offers follow-ups, on the same daily cron ─────────────────────────────
//
// The funnel step Eli set on Nov 20, 2026: once an owner is actually using
// the app, follow up ONCE with the other offers — staff training (the
// packages) and Tello Staff. The audience is accounts that are still free:
// on the Free plan, or still inside their 30-day full-access window
// (title22_plan 'trial'), and not already carrying a package. The moment
// is roughly 10 days after signup: profiles.created_at is the signup
// stamp, and the scan takes accounts 10–13 days old, so a missed run or
// two still lands the email while it is still "roughly day 10". The claim
// key (offers_followup:<user id>) makes it once per account, ever — an
// account that later pays and returns to free does NOT get it again.
//
// MAR and ADL are deliberately NOT in this email. MAR is gated (pilot
// paper unsigned, Gate 3 not passed, no payment link exists). ADL is
// built-but-removed — the feature was built, then taken out of view; the
// code exists, hidden, and restoring it is a decision that has not been
// made — and it has no payment link either. No fake doors: they join this
// email only in a future revision, when each is real and buyable.
async function scanOffersFollowups(env) {
  const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter(name => !env[name]);
  if (missing.length) {
    console.error('offers_followup scan skipped — missing binding(s): ' + missing.join(', '));
    return { scanned: 0, sent: 0 };
  }

  const now = Date.now();
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?title22_plan=in.(trial,free)` +
    `&created_at=lt.${encodeURIComponent(new Date(now - 10 * 864e5).toISOString())}` +
    `&created_at=gt.${encodeURIComponent(new Date(now - 14 * 864e5).toISOString())}` +
    `&select=id,title22_plan,title22_package,created_at&order=created_at.asc&limit=200`;
  const res = await fetch(url, { headers: serviceHeaders(env) });
  if (!res.ok) {
    console.error('offers_followup scan failed — profiles read: HTTP ' + res.status);
    return { scanned: 0, sent: 0 };
  }
  const rows = (await res.json().catch(() => [])) || [];

  let sent = 0;
  for (const row of rows) {
    try {
      // The query asks for free accounts only; the row is re-checked here
      // anyway, because profiles is a shared table and a stale read should
      // never mail an offer to someone already paying.
      if (row.title22_plan !== 'trial' && row.title22_plan !== 'free') continue;
      if (row.title22_package) continue;   // already on a package — training is theirs
      const createdMs = Date.parse(row.created_at);
      if (!createdMs) continue;
      const ageDays = Math.floor((now - createdMs) / 864e5);
      if (ageDays < 10 || ageDays > 13) continue;   // the day-10 window, with slack for missed runs

      const user = await lookupAuthUser(env, row.id);
      const to = String((user && user.email) || '').trim().toLowerCase();
      if (!to) continue;

      const outcome = await sendOnce(env, {
        dedupeKey: 'offers_followup:' + row.id,
        userId: row.id,
        template: 'offers_followup',
        to,
        payload: { name: displayName(user, null) },
      });
      if (outcome.sent) sent++;
    } catch (err) {
      // One bad row must not stop the scan; the claim was released inside
      // sendOnce, so tomorrow's run retries this account while it is
      // still inside the window.
      console.error('offers_followup failed for profile', row.id, (err && err.message) || String(err));
    }
  }
  console.log(`offers_followup scan: ${rows.length} free account(s) in the day-10 window, ${sent} follow-up(s) sent`);
  return { scanned: rows.length, sent };
}

