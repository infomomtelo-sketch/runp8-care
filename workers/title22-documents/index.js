// title22-documents — server-authorized document URL signer
//
// The browser should not mint signed URLs for facility files directly. This
// worker verifies the caller's Supabase JWT, resolves their facility role
// server-side, checks the requested capability, then signs only the document
// they are allowed to access.

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

function restHeaders(env, token) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + (token || env.SUPABASE_SERVICE_KEY),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
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

async function getFacilityRole(userId, facilityId, env) {
  const headers = restHeaders(env);
  const facRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/facilities?id=eq.${facilityId}&select=id,user_id`,
    { headers }
  );
  if (!facRes.ok) return null;
  const facilities = await facRes.json();
  const facility = facilities[0];
  if (!facility) return null;
  if (facility.user_id === userId) return 'administrator';

  const memberRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/facility_members?facility_id=eq.${facilityId}&user_id=eq.${userId}&select=role&limit=1`,
    { headers }
  );
  if (!memberRes.ok) return 'readonly';
  const members = await memberRes.json();
  return members[0]?.role || 'readonly';
}

const ROLE_CAPABILITIES = {
  administrator: { 'document.read_content': true, 'document.share': true },
  supervisor:    { 'document.read_content': true, 'document.share': true },
  caregiver:     { 'document.read_content': true, 'document.share': true },
  readonly:      { 'document.read_content': true, 'document.share': true },
};

function hasCapability(role, capability) {
  return !!(ROLE_CAPABILITIES[role] && ROLE_CAPABILITIES[role][capability]);
}

async function getDocument(facilityId, storagePath, env) {
  const headers = restHeaders(env);
  const url =
    `${env.SUPABASE_URL}/rest/v1/documents?facility_id=eq.${facilityId}` +
    `&storage_path=eq.${encodeURIComponent(storagePath)}&select=id,title,file_name,storage_path&limit=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function signDocument(storagePath, expiresIn, env) {
  const encodedPath = String(storagePath || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/facility-documents/${encodedPath}`,
    {
      method: 'POST',
      headers: restHeaders(env),
      body: JSON.stringify({ expiresIn }),
    }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.signedURL) return null;
  return `${env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}

async function logAccess({ userId, facilityId, role, documentId, storagePath, capability }, env) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers: {
      ...restHeaders(env),
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      facility_id: facilityId,
      role,
      event_name: capability === 'document.share' ? 'document_share_link_created' : 'document_opened',
      metadata: {
        document_id: documentId,
        storage_path: storagePath,
        capability,
      },
    }),
  }).catch(() => {});
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (request.method === 'GET') {
      const ok = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
      return json({
        ok,
        bindings: {
          SUPABASE_URL: Boolean(env.SUPABASE_URL),
          SUPABASE_SERVICE_KEY: Boolean(env.SUPABASE_SERVICE_KEY),
        },
      }, ok ? 200 : 503);
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return json({
        error: 'not_configured',
        message: 'This Worker is missing its Supabase bindings.',
      }, 503);
    }

    try {
      const token = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
      const user = await getUserFromToken(token, env);
      if (!user?.id) {
        return json({
          error: 'unauthorized',
          message: 'Your session could not be verified. Sign out and back in, then try again.',
        }, 401);
      }

      const body = await request.json().catch(() => null);
      const facilityId = String(body?.facilityId || '').trim();
      const storagePath = String(body?.storagePath || '').trim();
      const capability = String(body?.capability || '').trim();
      const requestedExpires = Number(body?.expiresIn || 0);

      if (!facilityId || !storagePath || !capability) {
        return json({ error: 'bad_request', message: 'facilityId, storagePath, and capability are required.' }, 400);
      }
      if (!storagePath.startsWith(facilityId + '/')) {
        return json({ error: 'bad_request', message: 'That document path does not belong to this facility.' }, 400);
      }

      const role = await getFacilityRole(user.id, facilityId, env);
      if (!role || !hasCapability(role, capability)) {
        return json({ error: 'forbidden', message: 'You do not have permission to access this document.' }, 403);
      }

      const document = await getDocument(facilityId, storagePath, env);
      if (!document) {
        return json({ error: 'not_found', message: 'That document could not be found.' }, 404);
      }

      const expiresIn = capability === 'document.share'
        ? Math.min(3600, Math.max(60, requestedExpires || 3600))
        : Math.min(300, Math.max(60, requestedExpires || 120));
      const signedUrl = await signDocument(storagePath, expiresIn, env);
      if (!signedUrl) {
        return json({ error: 'sign_failed', message: 'Could not create a secure document link.' }, 502);
      }

      logAccess({
        userId: user.id,
        facilityId,
        role,
        documentId: document.id,
        storagePath,
        capability,
      }, env);

      return json({
        signedUrl,
        expiresIn,
        role,
        fileName: document.file_name || null,
        title: document.title || null,
      });
    } catch (e) {
      return json({
        error: 'server_error',
        message: e?.message || 'Could not access this document.',
      }, 500);
    }
  }
};
