import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const baseUrl = (process.env.BAOHE_CANARY_BASE_URL || 'https://www.nesio.app').replace(/\/$/, '');

async function fetchJson(path, init) {
  try {
    const args = ['-s', '-w', '\n%{http_code}', `${baseUrl}${path}`];
    if (init?.method) args.splice(1, 0, '-X', init.method);
    const contentType = init?.headers?.['Content-Type'] || init?.headers?.['content-type'];
    if (contentType) args.splice(1, 0, '-H', `Content-Type: ${contentType}`);
    if (init?.body) args.splice(1, 0, '-d', String(init.body));

    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 });
    const splitAt = stdout.lastIndexOf('\n');
    const rawBody = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;
    const status = splitAt >= 0 ? Number(stdout.slice(splitAt + 1)) : 0;
    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      body = {
        error: 'html_or_non_json_response',
        message: 'Expected JSON but received HTML or another non-JSON response. Check that the canonical domain points to the Next/Vercel runtime.',
        baseUrl,
        path,
        status,
        rawPreview: rawBody.slice(0, 160),
      };
    }
    return {
      response: {
        ok: status >= 200 && status < 300 && body?.error !== 'html_or_non_json_response',
        status,
      },
      body,
    };
  } catch (error) {
    return {
      response: {
        ok: false,
        status: 0,
      },
      body: {
        error: 'network_failure',
        message: error instanceof Error ? error.message : String(error),
        baseUrl,
        path,
      },
    };
  }
}

async function fetchRedirect(path) {
  try {
    const args = ['-s', '-D', '-', '-o', '/dev/null', '-w', '\n%{http_code}', `${baseUrl}${path}`];
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 });
    const splitAt = stdout.lastIndexOf('\n');
    const rawHeaders = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;
    const status = splitAt >= 0 ? Number(stdout.slice(splitAt + 1)) : 0;
    const location = rawHeaders
      .split('\n')
      .find((line) => line.toLowerCase().startsWith('location:'))
      ?.slice('location:'.length)
      .trim();

    return {
      response: {
        ok: status >= 300 && status < 400 && Boolean(location),
        status,
      },
      headers: {
        location,
      },
      rawHeaders,
    };
  } catch (error) {
    return {
      response: {
        ok: false,
        status: 0,
      },
      headers: {},
      error: {
        error: 'network_failure',
        message: error instanceof Error ? error.message : String(error),
        baseUrl,
        path,
      },
    };
  }
}

function check(condition, message, details) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    if (details) console.error(JSON.stringify(details, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const health = await fetchJson('/api/portal/production/health');
check(health.response.ok, 'production health endpoint returns 2xx', health.body);
check(health.body?.safePublicStatus === true, 'production health is safe public status', health.body);
check(health.body?.secretsRedacted === true, 'production health redacts secrets', health.body);
check(health.body?.ai?.providers?.gemini?.enabled === true, 'Gemini is enabled in production runtime health', health.body?.ai);

const cloudStatus = await fetchJson('/api/cloud/status');
check(cloudStatus.response.ok, 'cloud status endpoint returns 2xx', cloudStatus.body);
check(
  cloudStatus.body?.safePublicStatus === true &&
    cloudStatus.body?.secretsRedacted === true &&
    cloudStatus.body?.readsCloud === false &&
    cloudStatus.body?.writesCloud === false,
  'cloud status reports safe read-only diagnostics',
  cloudStatus.body,
);
check(
  cloudStatus.body?.endpoints?.profileSettingsEndpoint === '/api/cloud/profile-settings' &&
    cloudStatus.body?.endpoints?.inventoryEndpoint === '/api/cloud/inventory',
  'cloud status exposes cloud profile and inventory endpoints',
  cloudStatus.body?.endpoints,
);
check(
  typeof cloudStatus.body?.summary?.cloudDatabaseReady === 'boolean' &&
    (cloudStatus.body.summary.cloudDatabaseReady === true || cloudStatus.body.summary.cloudBlockedReason),
  'cloud status explains cloud database readiness',
  cloudStatus.body?.summary,
);

const cloudInventory = await fetchJson('/api/cloud/inventory');
check(
  cloudInventory.body?.safePublicStatus === true &&
    cloudInventory.body?.secretsRedacted === true &&
    cloudInventory.body?.cloudInventorySnapshot === true,
  'cloud inventory snapshot endpoint returns safe JSON',
  cloudInventory.body,
);
check(
  cloudInventory.response.ok ||
    ['cloud_not_configured', 'not_signed_in', 'cloud_read_failed'].includes(cloudInventory.body?.error),
  'cloud inventory snapshot is ready or fails closed with a clear reason',
  {
    status: cloudInventory.response.status,
    error: cloudInventory.body?.error,
    setupTask: cloudInventory.body?.setupTask,
  },
);
check(
  cloudInventory.body?.readsCloud === false ||
    (cloudInventory.response.ok && Array.isArray(cloudInventory.body?.items)),
  'cloud inventory snapshot does not claim cloud reads unless it returns items',
  cloudInventory.body,
);

const cloudProfileSettings = await fetchJson('/api/cloud/profile-settings');
check(
  cloudProfileSettings.body?.safePublicStatus === true &&
    cloudProfileSettings.body?.secretsRedacted === true,
  'cloud profile settings endpoint returns safe JSON',
  cloudProfileSettings.body,
);
check(
  cloudProfileSettings.response.ok ||
    ['cloud_not_configured', 'not_signed_in', 'cloud_read_failed'].includes(cloudProfileSettings.body?.error),
  'cloud profile settings is ready or fails closed with a clear reason',
  {
    status: cloudProfileSettings.response.status,
    error: cloudProfileSettings.body?.error,
    setupTask: cloudProfileSettings.body?.setupTask,
  },
);
check(
  cloudProfileSettings.body?.writesCloud === false,
  'cloud profile settings GET does not write cloud data',
  cloudProfileSettings.body,
);

const calendar = await fetchJson('/api/portal/calendar');
check(calendar.response.ok, 'calendar endpoint returns 2xx', calendar.body);
check(calendar.body?.configured === true, 'calendar endpoint reports configured feed runtime', calendar.body);
check(calendar.body?.enabled === true, 'calendar endpoint reports enabled feed runtime', calendar.body);
check(Array.isArray(calendar.body?.events), 'calendar endpoint returns an events array', calendar.body);
check((calendar.body?.events?.length || 0) > 0, 'calendar endpoint returns at least one event', {
  eventCount: calendar.body?.events?.length || 0,
  feeds: calendar.body?.feeds,
});
check(
  Array.isArray(calendar.body?.sources) && calendar.body.sources.includes('Google'),
  'calendar endpoint includes Google as a live source',
  calendar.body?.sources,
);

const secretaryPage = await fetchJson('/secretary');
check(
  secretaryPage.response.status === 403,
  'Secretary page direct URL is first_launch_gated for public production visitors',
  secretaryPage.body,
);
check(
  secretaryPage.body?.error === 'html_or_non_json_response',
  'Secretary page direct URL does not expose a JSON/chat runtime surface',
  secretaryPage.body,
);

for (const staticPath of ['/secretary/index.html', '/secretary/chat.html']) {
  const secretaryStaticPage = await fetchJson(staticPath);
  check(
    secretaryStaticPage.response.status === 403 || secretaryStaticPage.response.status === 404,
    `Secretary static deep link is not publicly served: ${staticPath}`,
    secretaryStaticPage.body,
  );
}

const authProviderCanaryMatrix = [
  {
    provider: 'email',
    message: 'email auth start is wired and validates input or fails closed',
    acceptedErrors: ['missing_email', 'provider_not_configured', 'canonical_domain_mismatch'],
    acceptedAction: 'otp_sent',
  },
  {
    provider: 'google',
    message: 'Google auth start either redirects when configured or fails closed',
    acceptedErrors: ['provider_not_configured', 'canonical_domain_mismatch'],
    acceptedAction: 'redirect',
  },
  {
    provider: 'wechat',
    message: 'wechat auth start either redirects when configured or fails closed',
    acceptedErrors: ['provider_not_configured', 'canonical_domain_mismatch'],
    acceptedAction: 'redirect',
  },
  {
    provider: 'phone',
    message: 'phone auth start is wired and validates input or fails closed',
    acceptedErrors: ['missing_phone', 'provider_not_configured', 'canonical_domain_mismatch'],
    acceptedAction: 'otp_sent',
  },
];

for (const authProvider of authProviderCanaryMatrix) {
  const authResult = await fetchJson('/api/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: authProvider.provider }),
  });
  check(
    authResult.body?.safePublicStatus === true && authResult.body?.secretsRedacted === true,
    `${authProvider.provider} auth start returns safe JSON`,
    authResult.body,
  );
  check(
    authResult.body?.action === authProvider.acceptedAction ||
      authProvider.acceptedErrors.includes(authResult.body?.error),
    authProvider.message,
    {
      status: authResult.response.status,
      action: authResult.body?.action,
      error: authResult.body?.error,
      setupTask: authResult.body?.setupTask,
    },
  );
  if (authResult.response.status === 503) {
    check(
      ['provider_not_configured', 'canonical_domain_mismatch'].includes(authResult.body?.error),
      `${authProvider.provider} auth fail-closed explains configuration or domain state`,
      authResult.body,
    );
  }
}

const authSession = await fetchJson('/api/auth/session');
check(
  authSession.body?.safePublicStatus === true && authSession.body?.secretsRedacted === true,
  'auth session endpoint returns safe JSON',
  authSession.body,
);
check(
  authSession.response.ok &&
    authSession.body?.ok === true &&
    authSession.body?.loggedIn === false &&
    authSession.body?.status === 'signed_out' &&
    authSession.body?.user === undefined,
  'auth session reports signed-out state without exposing secrets',
  authSession.body,
);

const authLogout = await fetchJson('/api/auth/logout', { method: 'POST' });
check(
  authLogout.body?.safePublicStatus === true && authLogout.body?.secretsRedacted === true,
  'auth logout endpoint returns safe JSON',
  authLogout.body,
);
check(
  authLogout.response.ok && authLogout.body?.ok === true && authLogout.body?.signedOut === true,
  'auth logout is idempotent for signed-out users',
  authLogout.body,
);

const authCallback = await fetchRedirect('/api/auth/callback');
check(
  authCallback.response.ok &&
    authCallback.headers.location?.includes('safePublicStatus=true') &&
    authCallback.headers.location?.includes('secretsRedacted=true') &&
    authCallback.headers.location?.includes('auth=auth_callback_received') &&
    authCallback.headers.location?.includes('status=callback_received'),
  'auth callback without code redirects safely',
  {
    status: authCallback.response.status,
    location: authCallback.headers.location,
    error: authCallback.error,
  },
);

const gemini = await fetchJson('/api/secretary/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gemini',
    message: '请只回复：宝盒Gemini在线',
    maxTokens: 64,
  }),
});
check(gemini.response.ok, 'Gemini secretary chat returns 2xx', gemini.body);
check(gemini.body?.text?.includes('宝盒Gemini在线'), 'Gemini secretary chat returns expected canary phrase', gemini.body);

if (process.exitCode) {
  process.exit();
}

console.log(`production runtime canary passed for ${baseUrl}`);
