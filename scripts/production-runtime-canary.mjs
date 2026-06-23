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
    if (init?.form) {
      for (const [key, value] of Object.entries(init.form)) {
        args.splice(1, 0, '-F', `${key}=${value}`);
      }
    }
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

async function fetchText(path) {
  try {
    const args = ['-s', '-w', '\n%{http_code}', `${baseUrl}${path}`];
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 });
    const splitAt = stdout.lastIndexOf('\n');
    const body = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;
    const status = splitAt >= 0 ? Number(stdout.slice(splitAt + 1)) : 0;
    return {
      response: {
        ok: status >= 200 && status < 300,
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
      body: '',
      error: {
        error: 'network_failure',
        message: error instanceof Error ? error.message : String(error),
        baseUrl,
        path,
      },
    };
  }
}

async function fetchHeaders(path) {
  try {
    const args = ['-s', '-I', `${baseUrl}${path}`];
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 });
    const statusLine = stdout.split('\n').find((line) => line.toLowerCase().startsWith('http/')) || '';
    const status = Number(statusLine.match(/\s(\d{3})\s?/)?.[1] || 0);
    const headers = Object.fromEntries(
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes(':'))
        .map((line) => {
          const splitAt = line.indexOf(':');
          return [line.slice(0, splitAt).toLowerCase(), line.slice(splitAt + 1).trim()];
        }),
    );
    return {
      response: {
        ok: status >= 200 && status < 300,
        status,
      },
      headers,
      rawHeaders: stdout,
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

const runtimePreflight = await fetchHeaders('/api/portal/production/health');
const serverHeader = String(runtimePreflight.headers?.server || '');
const matchedPath = String(runtimePreflight.headers?.['x-matched-path'] || '');
const isVercelRuntime =
  runtimePreflight.response.ok &&
  /vercel/i.test(serverHeader) &&
  matchedPath === '/api/portal/production/health';
check(
  isVercelRuntime,
  'canonical domain is routed to the Vercel/Next runtime',
  {
    error: 'dns_or_runtime_mismatch',
    baseUrl,
    status: runtimePreflight.response.status,
    server: serverHeader,
    matchedPath,
    expected: {
      server: 'Vercel',
      matchedPath: '/api/portal/production/health',
      dns: 'A www.nesio.app 76.76.21.21 or Vercel nameservers',
    },
    rawHeaders: runtimePreflight.rawHeaders,
    networkError: runtimePreflight.error,
  },
);
if (!isVercelRuntime) process.exit();

const health = await fetchJson('/api/portal/production/health');
check(health.response.ok, 'production health endpoint returns 2xx', health.body);
check(health.body?.safePublicStatus === true, 'production health is safe public status', health.body);
check(health.body?.secretsRedacted === true, 'production health redacts secrets', health.body);
check(health.body?.ai?.providers?.gemini?.enabled === true, 'Gemini is enabled in production runtime health', health.body?.ai);

const activationChecklist = await fetchJson('/api/portal/production/activation-checklist');
check(activationChecklist.response.ok, 'production activation checklist endpoint returns 2xx', activationChecklist.body);
check(
  activationChecklist.body?.safePublicStatus === true &&
    activationChecklist.body?.secretsRedacted === true &&
    Array.isArray(activationChecklist.body?.activationChecklist),
  'production activation checklist redacts secrets and is safe public status',
  activationChecklist.body,
);
check(
  ['account_auth', 'cloud', 'ai', 'third_party'].every((category) =>
    Object.prototype.hasOwnProperty.call(activationChecklist.body?.categorySummary || {}, category),
  ),
  'production activation checklist reports account cloud AI and third party readiness',
  activationChecklist.body?.categorySummary,
);

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

const modulesContract = await fetchJson('/api/modules');
check(
  modulesContract.response.ok &&
    modulesContract.body?.contract === 'api-contract-v0' &&
    Array.isArray(modulesContract.body?.modules) &&
    ['shell', 'inventory', 'plan'].every((moduleId) =>
      modulesContract.body.modules.some((module) => module.moduleId === moduleId && module.status === 'enabled'),
    ),
  'modules endpoint returns core Shell and launch module contract',
  modulesContract.body,
);

const inventoryContract = await fetchJson('/api/inventory');
check(
  inventoryContract.response.ok &&
    inventoryContract.body?.contract === 'api-contract-v0' &&
    inventoryContract.body?.mode === 'demo' &&
    inventoryContract.body?.personalDataRead === false &&
    Array.isArray(inventoryContract.body?.items),
  'inventory endpoint returns demo inventory without personal data reads',
  inventoryContract.body,
);

const entitlementsContract = await fetchJson('/api/entitlements');
check(
  entitlementsContract.response.ok &&
    entitlementsContract.body?.contract === 'api-contract-v0' &&
    Array.isArray(entitlementsContract.body?.entitlements) &&
    ['shell', 'inventory'].every((moduleId) =>
      entitlementsContract.body.entitlements.some((entry) => entry.moduleId === moduleId && entry.status === 'active'),
    ),
  'entitlements endpoint returns local active Shell and Inventory entitlements',
  entitlementsContract.body,
);

const userDataExport = await fetchJson('/api/user-data/export');
check(
  userDataExport.response.ok &&
    userDataExport.body?.contract === 'api-contract-v0' &&
    userDataExport.body?.exportKind === 'mock-local-export',
  'user data export endpoint returns local contract JSON',
  userDataExport.body,
);
check(
  userDataExport.body?.includesRealUserData === false &&
    userDataExport.body?.boundaries?.readsRealUserData === false &&
    userDataExport.body?.boundaries?.writesRealUserData === false &&
    userDataExport.body?.boundaries?.writesCloud === false,
  'user data export does not include real user data',
  userDataExport.body,
);

const userDataDelete = await fetchJson('/api/user-data/delete', { method: 'POST' });
check(
  userDataDelete.response.ok &&
    userDataDelete.body?.contract === 'api-contract-v0' &&
    userDataDelete.body?.deleteKind === 'mock-local-delete' &&
    userDataDelete.body?.dryRun === true,
  'user data delete endpoint returns dry-run local contract JSON',
  userDataDelete.body,
);
check(
  userDataDelete.body?.deletesRealUserData === false &&
    userDataDelete.body?.deletesCloudData === false &&
    userDataDelete.body?.boundaries?.writesRealUserData === false &&
    userDataDelete.body?.boundaries?.writesCloud === false,
  'user data delete does not delete real or cloud data',
  userDataDelete.body,
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

const secretaryPage = await fetchText('/secretary');
check(
  secretaryPage.response.ok &&
    /<html[\s\S]*<title>智友<\/title>[\s\S]*id="friendList"[\s\S]*\/secretary\/list\.js/.test(secretaryPage.body),
  'Secretary page direct URL is publicly available as the production AI friends surface',
  {
    status: secretaryPage.response.status,
    rawPreview: secretaryPage.body.slice(0, 220),
    networkError: secretaryPage.error,
  },
);
check(
  !/wx-tabbar|aria-label="底部导航"|<span>首页<\/span>|<span>工具箱<\/span>|输入框搞定一切|语音会先作为本地草稿/.test(
    secretaryPage.body,
  ),
  'Secretary page does not expose the removed old bottom nav or local-draft helper copy',
  {
    status: secretaryPage.response.status,
  },
);

const secretaryFriends = await fetchJson('/secretary/friends.json');
check(
  secretaryFriends.response.ok &&
    Array.isArray(secretaryFriends.body) &&
    ['gemini', 'chatgpt', 'doubao'].every((id) =>
      secretaryFriends.body.some((friend) => friend.id === id && friend.name && friend.preview),
    ),
  'Secretary friends catalog exposes connected AI options for the production AI friends surface',
  {
    status: secretaryFriends.response.status,
    friendIds: Array.isArray(secretaryFriends.body) ? secretaryFriends.body.map((friend) => friend.id) : [],
    error: secretaryFriends.body?.error,
  },
);

for (const staticPath of ['/secretary/index.html', '/secretary/chat.html']) {
  const secretaryStaticPage = await fetchText(staticPath);
  check(
    secretaryStaticPage.response.ok && /<html/.test(secretaryStaticPage.body),
    `Secretary static deep link is served through the production AI friends surface: ${staticPath}`,
    {
      status: secretaryStaticPage.response.status,
      rawPreview: secretaryStaticPage.body.slice(0, 220),
      networkError: secretaryStaticPage.error,
    },
  );
  check(
    !/wx-tabbar|aria-label="底部导航"|<span>首页<\/span>|<span>工具箱<\/span>|输入框搞定一切|语音会先作为本地草稿/.test(
      secretaryStaticPage.body,
    ),
    `Secretary static deep link has no removed controls: ${staticPath}`,
    {
      status: secretaryStaticPage.response.status,
    },
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

const emailAuthDryRun = await fetchJson('/api/auth/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'email',
    email: 'canary@example.com',
    dryRun: true,
  }),
});
check(
  emailAuthDryRun.body?.safePublicStatus === true &&
    emailAuthDryRun.body?.secretsRedacted === true &&
    emailAuthDryRun.body?.error !== 'missing_email' &&
    (emailAuthDryRun.body?.action === 'otp_dry_run' ||
      ['provider_not_configured', 'canonical_domain_mismatch'].includes(emailAuthDryRun.body?.error)),
  'email auth start dry-run accepts a real email payload without sending OTP',
  emailAuthDryRun.body,
);
if (emailAuthDryRun.body?.action === 'otp_dry_run') {
  check(
    emailAuthDryRun.body?.noExternalOtpSent === true,
    'email auth start dry-run does not send external OTP',
    emailAuthDryRun.body,
  );
}

const phoneAuthDryRun = await fetchJson('/api/auth/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'phone',
    phone: '+15555550123',
    dryRun: true,
  }),
});
check(
  phoneAuthDryRun.body?.safePublicStatus === true &&
    phoneAuthDryRun.body?.secretsRedacted === true &&
    phoneAuthDryRun.body?.error !== 'missing_phone' &&
    (phoneAuthDryRun.body?.action === 'otp_dry_run' ||
      ['provider_not_configured', 'canonical_domain_mismatch'].includes(phoneAuthDryRun.body?.error)),
  'phone auth start dry-run accepts a real phone payload without sending OTP',
  phoneAuthDryRun.body,
);
if (phoneAuthDryRun.body?.action === 'otp_dry_run') {
  check(
    phoneAuthDryRun.body?.noExternalOtpSent === true,
    'phone auth start dry-run does not send external OTP',
    phoneAuthDryRun.body,
  );
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

const calendarConnectRedirect = await fetchRedirect('/api/portal/calendar/connect');
if (calendarConnectRedirect.response.ok) {
  check(
    calendarConnectRedirect.headers.location?.startsWith('https://accounts.google.com/') &&
      calendarConnectRedirect.headers.location?.includes('calendar.readonly'),
    'Google Calendar connect either redirects when configured or fails closed',
    {
      status: calendarConnectRedirect.response.status,
      location: calendarConnectRedirect.headers.location,
    },
  );
} else {
  const calendarConnect = await fetchJson('/api/portal/calendar/connect');
  check(
    calendarConnect.body?.safePublicStatus === true &&
      calendarConnect.body?.secretsRedacted === true &&
      ['provider_not_configured', 'canonical_domain_mismatch'].includes(calendarConnect.body?.error),
    'Google Calendar connect either redirects when configured or fails closed',
    {
      status: calendarConnect.response.status,
      error: calendarConnect.body?.error,
      setupTask: calendarConnect.body?.setupTask,
    },
  );
}

const flomoCapture = await fetchJson('/api/portal/flomo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: '' }),
});
check(
  flomoCapture.body?.safePublicStatus === true && flomoCapture.body?.secretsRedacted === true,
  'Flomo capture endpoint returns safe JSON',
  flomoCapture.body,
);
check(
  flomoCapture.body?.error === 'content required' ||
    ['FLOMO_WEBHOOK_URL not configured', 'Invalid JSON'].includes(flomoCapture.body?.error),
  'Flomo capture validates empty content or fails closed',
  {
    status: flomoCapture.response.status,
    error: flomoCapture.body?.error,
  },
);

const flomoUpload = await fetchJson('/api/portal/flomo/upload', {
  method: 'POST',
  form: {
    canary: 'missing-file',
  },
});
check(
  flomoUpload.body?.safePublicStatus === true && flomoUpload.body?.secretsRedacted === true,
  'Flomo upload endpoint returns safe JSON',
  flomoUpload.body,
);
check(
  flomoUpload.body?.error === 'file required',
  'Flomo upload validates missing file without calling upload host',
  {
    status: flomoUpload.response.status,
    error: flomoUpload.body?.error,
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
