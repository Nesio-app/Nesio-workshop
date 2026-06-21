import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const runtimeSource = fs.readFileSync(path.join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const compiledRuntime = ts.transpileModule(runtimeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const runtimeModule = await import(`data:text/javascript;base64,${Buffer.from(compiledRuntime.outputText).toString('base64')}`);

const runtime = runtimeModule.buildProductionRuntimeStatus({
  BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  BAOHE_ALLOWED_RUNTIME_HOSTS: 'treasurebox-nu.vercel.app',
  BAOHE_AUTH_ENABLED: 'true',
  CLOUD_DB_ENABLED: 'true',
  CLOUD_STORAGE_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_STORAGE_BUCKET: 'baohe',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  WECHAT_APP_ID: 'wechat-id',
  WECHAT_APP_SECRET: 'wechat-secret',
  BAOHE_AI_PROVIDER_MODE: 'production',
  GEMINI_API_KEY: 'gemini',
  OPENAI_API_KEY: 'openai',
  DOUBAO_KEY: 'doubao',
  ANTHROPIC_API_KEY: 'anthropic',
  FLOMO_WEBHOOK_URL: 'https://flomo.example/webhook',
}, {
  requestHost: 'www.nesio.app',
});

const endpointToRouteFile = (endpoint) => {
  const routePath = endpoint
    .replace(/^\/api\//, '')
    .split('/')
    .map((segment) => segment.replace(/[?].*$/, ''))
    .filter(Boolean)
    .join('/');
  return path.join(root, 'app', 'api', routePath, 'route.ts');
};

const endpoints = runtime.providerActionMatrix
  .map((provider) => provider.startEndpoint)
  .filter((endpoint) => endpoint?.startsWith('/api/'));

assert.ok(endpoints.length > 0, 'production runtime must expose API start endpoints to verify.');

for (const endpoint of endpoints) {
  const routeFile = endpointToRouteFile(endpoint);
  assert.ok(
    fs.existsSync(routeFile),
    `${endpoint} must map to a real Next.js route file at ${path.relative(root, routeFile)}.`,
  );
}

assert.equal(
  packageJson.scripts['test:production-runtime-endpoint-integrity'],
  'node scripts/production-runtime-endpoint-integrity.test.mjs',
  'package.json must expose production runtime endpoint integrity coverage.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:production-runtime-endpoint-integrity/,
  'test:contracts must include production runtime endpoint integrity coverage.',
);

console.log('production runtime endpoint integrity checks passed');
