import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const runtime = readFileSync(join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const callbackRoute = readFileSync(join(root, 'app', 'api', 'auth', 'callback', 'route.ts'), 'utf8');
const sessionRoute = readFileSync(join(root, 'app', 'api', 'auth', 'session', 'route.ts'), 'utf8');
const logoutRoute = readFileSync(join(root, 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  runtime,
  /redirect\.searchParams\.set\(['"]provider['"], ['"]wechat['"]\)/,
  'WeChat OAuth redirect URL must tag the callback with provider=wechat.',
);
assert.match(
  callbackRoute,
  /exchangeWechatCode/,
  'Auth callback must have a WeChat code exchange branch.',
);
assert.match(
  callbackRoute,
  /api\.weixin\.qq\.com\/sns\/oauth2\/access_token/,
  'Auth callback must exchange WeChat OAuth code with WeChat.',
);
assert.match(
  callbackRoute,
  /provider === ['"]wechat['"]/,
  'Auth callback must route WeChat code separately from Supabase OAuth code.',
);
assert.match(
  callbackRoute,
  /cookies\.set\(['"]baohe_auth_provider['"], ['"]wechat['"]/,
  'WeChat callback must set an httpOnly auth provider cookie.',
);
assert.match(
  callbackRoute,
  /cookies\.set\(['"]baohe_wechat_openid['"]/,
  'WeChat callback must store a server-readable WeChat openid marker.',
);
assert.match(callbackRoute, /httpOnly:\s*true/, 'WeChat auth cookies must be httpOnly.');
assert.doesNotMatch(
  callbackRoute,
  /searchParams\.set\(['"]wechat_access_token/,
  'WeChat callback must not echo WeChat access tokens into redirect URLs.',
);

assert.match(
  sessionRoute,
  /cookieStore\.get\(['"]baohe_auth_provider['"]\)/,
  'Auth session must read WeChat provider cookies.',
);
assert.match(
  sessionRoute,
  /wechat_openid/,
  'Auth session must expose a redacted WeChat login identity.',
);
assert.match(
  logoutRoute,
  /baohe_wechat_openid/,
  'Logout must clear WeChat identity cookies.',
);
assert.match(
  logoutRoute,
  /baohe_auth_provider/,
  'Logout must clear the auth provider cookie.',
);

assert.equal(
  pkg.scripts['test:auth-wechat-runtime'],
  'node scripts/auth-wechat-runtime.test.mjs',
  'package.json must expose test:auth-wechat-runtime.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:auth-wechat-runtime/,
  'test:contracts must include WeChat auth runtime coverage.',
);

console.log('auth WeChat runtime checks passed');
