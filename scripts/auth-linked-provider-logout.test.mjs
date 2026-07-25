import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const logoutRoute = readFileSync(join(root, 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8');
const settings = readFileSync(join(root, 'components', 'portal', 'SettingsSheets.tsx'), 'utf8');
const localOwner = readFileSync(join(root, 'lib', 'portal', 'local-owner.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const cookieName of [
  'baohe_auth_access',
  'baohe_auth_refresh',
  'baohe_auth_provider',
  'baohe_wechat_openid',
  'baohe_wechat_unionid',
  'baohe_wechat_refresh',
  'nesio_google_calendar_access',
  'nesio_google_calendar_refresh',
]) {
  assert.match(
    logoutRoute,
    new RegExp(`expireAuthCookie\\(response, ['"]${cookieName}['"]\\)`),
    `Logout must clear linked provider cookie: ${cookieName}`,
  );
}

assert.doesNotMatch(
  logoutRoute,
  /cookies\.get\(['"]nesio_google_calendar_access['"]\)[\s\S]*NextResponse\.json/,
  'Logout must not echo Google Calendar OAuth tokens into the response.',
);

// ── 数据泄露收口:退出登录必须清本机数据 + 进登录页(否则下一个人/guest 看到上一账号数据)──
// 定位到真正被点击的 signOut()(fetch /api/auth/logout 那段),校验它的收尾动作。
const signOutBlock = settings.slice(settings.indexOf('async function signOut()'), settings.indexOf('async function signOut()') + 900);
assert.ok(signOutBlock.includes("fetch('/api/auth/logout'"), 'signOut 仍打服务端登出清 cookie');
assert.ok(
  signOutBlock.includes('purgeLocalUserDataForLogout'),
  '退出登录必须清本机全部用户数据(purgeLocalUserDataForLogout),防止 guest 看到上一账号数据。',
);
assert.match(
  signOutBlock,
  /window\.location\.href\s*=\s*['"]\/login['"]/,
  '退出登录必须进登录页 /login(不是首页 /),兑现「登录页 + 全空白」。',
);
// 登出绝不能**调用**会「传导云删除」的 purgeAllLocalUserData() / deleteLifeNode() —— 那会把云端也抹了,
// 重登拉不回。(匹配调用形 `名(`,注释里提到函数名不算。)
assert.doesNotMatch(signOutBlock, /purgeAllLocalUserData\(|deleteLifeNode\(/, '登出只清本机,绝不传导云删除(数据须留云端供重登拉回)。');

// local-owner:登出专用清除是**纯本地**的(不 deleteLifeNode),且清主人记录。
assert.ok(localOwner.includes('export async function purgeLocalUserDataForLogout'), 'local-owner 导出 purgeLocalUserDataForLogout');
const logoutPurge = localOwner.slice(localOwner.indexOf('export async function purgeLocalUserDataForLogout'));
const logoutFnBody = logoutPurge.slice(0, logoutPurge.indexOf('\n}') + 2);
assert.doesNotMatch(logoutFnBody, /deleteLifeNode/, '登出清除绝不走 deleteLifeNode(那会传导云删除)。');
for (const marker of ['purgeLocalData', 'purgeIdbBlobs', 'purgeLocalImages', 'purgeEmailBodies', 'OWNER_KEY']) {
  assert.ok(logoutFnBody.includes(marker), `登出清除须覆盖 ${marker}(localStorage/IDB/照片/邮件全文/主人记录)`);
}

assert.equal(
  pkg.scripts['test:auth-linked-provider-logout'],
  'node scripts/auth-linked-provider-logout.test.mjs',
  'package.json must expose test:auth-linked-provider-logout.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:auth-linked-provider-logout/,
  'test:contracts must include linked provider logout coverage.',
);

console.log('auth linked provider logout checks passed');
