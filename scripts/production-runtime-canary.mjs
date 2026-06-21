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

const authGoogle = await fetchJson('/api/auth/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'google' }),
});
check(
  authGoogle.response.status === 503 || authGoogle.body?.action === 'redirect',
  'Google auth start either redirects when configured or fails closed',
  authGoogle.body,
);
if (authGoogle.response.status === 503) {
  check(authGoogle.body?.error === 'provider_not_configured', 'Google auth fail-closed explains provider_not_configured', authGoogle.body);
}

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
