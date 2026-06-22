import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const baseUrl = (process.env.BAOHE_DOMAIN_PRECHECK_URL || process.argv[2] || 'https://www.nesio.app').replace(/\/$/, '');
const healthPath = '/api/portal/production/health';
const expectedDns = 'A www.nesio.app 76.76.21.21 or Vercel nameservers ns1.vercel-dns.com / ns2.vercel-dns.com';

function parseHeaders(rawHeaders) {
  const statusLine = rawHeaders.split('\n').find((line) => line.toLowerCase().startsWith('http/')) || '';
  const status = Number(statusLine.match(/\s(\d{3})\s?/)?.[1] || 0);
  const headers = Object.fromEntries(
    rawHeaders
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes(':'))
      .map((line) => {
        const splitAt = line.indexOf(':');
        return [line.slice(0, splitAt).toLowerCase(), line.slice(splitAt + 1).trim()];
      }),
  );
  return { status, headers };
}

async function fetchHeaders(url) {
  try {
    const { stdout } = await execFileAsync('curl', ['-s', '-I', url], {
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      rawHeaders: stdout,
      ...parseHeaders(stdout),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      headers: {},
      rawHeaders: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const result = await fetchHeaders(`${baseUrl}${healthPath}`);
const server = String(result.headers.server || '');
const matchedPath = String(result.headers['x-matched-path'] || '');
const routedToVercelRuntime =
  result.status >= 200 &&
  result.status < 300 &&
  /vercel/i.test(server) &&
  matchedPath === healthPath;

if (!routedToVercelRuntime) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        check: 'domain-routing',
        baseUrl,
        path: healthPath,
        status: result.status,
        server,
        matchedPath,
        expected: {
          server: 'Vercel',
          matchedPath: healthPath,
          dns: expectedDns,
        },
        nextAction:
          baseUrl === 'https://www.nesio.app'
            ? 'Update DNS at the current DNS provider: set A record for www.nesio.app to 76.76.21.21, or move nameservers to Vercel DNS.'
            : 'Check that this URL points to the deployed Vercel project and exposes the production health endpoint.',
        networkError: result.error,
        rawHeaders: result.rawHeaders,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      check: 'domain-routing',
      baseUrl,
      path: healthPath,
      status: result.status,
      server,
      matchedPath,
      message: 'Domain is routed to the Vercel/Next runtime.',
    },
    null,
    2,
  ),
);
