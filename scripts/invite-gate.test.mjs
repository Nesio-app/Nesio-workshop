/**
 * 行为契约:邀请制(2026-07-31 用户:「应用层邀请制做」)。
 *
 * 用户要的是「我给 access,别人才能用」。范围必须先说清楚,免得越做越大:
 *   · 搜不到          → X-Robots-Tag noindex(另一份契约)
 *   · **页面照常打开** → 他明确要保留「不登录可以本地用」,所以不做平台级密码保护
 *   · **登录要邀请**   → 这一份
 *
 * ── 这份契约主要在守的一件事 ────────────────────────────────────────────────
 * 会话被铸造的地方(setAuthCookies)现在有 4 处:callback 两处、password 两处。
 * **每一处都必须有门。** 将来加第五处而忘了加门,不会有任何症状 ——
 * 那条路照常登录成功,只是绕过了名单;而你根本不会去测「某个没被邀请的人还能不能进」。
 * 所以这里数它们:发 cookie 的地方有几处,门就得有几处。
 *
 * 另外压两条方向相反的 fail 策略,它们**故意不一致**,各有各的理由:
 *   · 名单没配 → fail-OPEN(门不存在)。否则这段代码一上线,你自己也被锁在外面,
 *     而要改环境变量往往还得先登录 —— 这种安全措施只会被慌乱地 revert。
 *   · 门开着但读不到邮箱 → fail-CLOSED。否则只要让邮箱解析失败就能绕过整道门。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── ① 判据层:真跑一遍 ─────────────────────────────────────────────────────
const src = read('lib/portal/auth/invite-allowlist.ts');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, require: () => ({}),
  process: { env: {} }, Buffer,
  console, Object, Array, String, Number, Math, JSON, Boolean, RegExp,
});
const { inviteList, inviteGateEnabled, isInvited, gateReason, emailFromAccessToken } = mod.exports;

{
  // 没配 = 门不存在(fail-open,理由见文件头)
  assert.equal(inviteGateEnabled({}), false, '没配名单 = 门没开');
  assert.equal(isInvited('anyone@example.com', {}), true, '门没开时一律放行 —— 行为和加这层之前一模一样');
  assert.equal(gateReason('x@y.com', {}), 'invite_gate_disabled', '要能说出「门没开」,否则「忘了配」毫无症状');

  const env = { NESIO_INVITE_ALLOWLIST: 'A@Example.com, b@test.org' };
  assert.equal(inviteGateEnabled(env), true);
  assert.equal(isInvited('a@example.com', env), true, '大小写不敏感 —— 邮箱本来就是');
  assert.equal(isInvited('  B@TEST.ORG  ', env), true, '前后空白不该让人进不来');
  assert.equal(isInvited('c@other.com', env), false, '不在名单里就是不在');

  // 门开着但不知道你是谁 → 必须挡。这是整道门唯一的绕过口。
  assert.equal(isInvited('', env), false, '门开着时,读不到邮箱必须挡 —— 否则让解析失败就能绕过去');
  assert.equal(gateReason('', env), 'invite_gate_no_email');

  // 分隔符宽容:人手填的东西不该挑格式
  const messy = { NESIO_INVITE_ALLOWLIST: 'a@x.com;b@y.com\\n c@z.com  d@w.com' };
  assert.equal(inviteList(messy).length, 4, '逗号/分号/换行/空格都该认');

  // **不支持整域通配** —— 那会把「我认识的几个人」悄悄变成「任何拿到该域邮箱的人」。
  const domain = { NESIO_INVITE_ALLOWLIST: '@company.com' };
  assert.equal(isInvited('stranger@company.com', domain), false, '不许整域放行 —— 名单的意义是一个一个点头');
}

// ── ② JWT 里取邮箱 ────────────────────────────────────────────────────────
{
  const payload = Buffer.from(JSON.stringify({ email: 'Someone@Example.COM' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');   // base64url
  assert.equal(emailFromAccessToken(`h.${payload}.sig`), 'someone@example.com', 'base64url 要解得开并归一化');
  assert.equal(emailFromAccessToken('not-a-jwt'), '', '解不开返回空串,交给 fail-closed 处理');
  assert.equal(emailFromAccessToken(''), '');
  assert.equal(emailFromAccessToken('a.!!!notbase64!!!.c'), '', '坏 payload 不许抛');
}

// ── ③ 每一处发 cookie 的地方都要有门 ───────────────────────────────────────
//
// 这一条是全篇最重要的:将来加第五处而忘了加门,登录照常成功、没有任何症状。
{
  const callback = read('app/api/auth/callback/route.ts');
  const password = read('app/api/auth/password/route.ts');

  // callback:两处都必须由 allowed 守着,不许再出现裸的 `if (session?.access_token) { setAuthCookies`
  const cbMints = (callback.match(/setAuthCookies\(response, session/g) || []).length;
  assert.equal(cbMints, 2, 'callback 的铸造点数量变了 —— 变了就得确认新那处也有门');
  assert.equal(
    (callback.match(/if \(allowed\) \{\s*\n\s*setAuthCookies/g) || []).length, 2,
    'callback 两处铸造点都必须由 allowed 守着',
  );
  assert.ok(
    !/if \(session\?\.access_token\) \{\s*\n\s*setAuthCookies/.test(callback),
    '不许再出现「只看有没有 token 就发 cookie」的裸铸造点',
  );

  // password:两处出口各一道
  const pwMints = (password.match(/setAuthCookies\(response, data\)/g) || []).length;
  assert.equal(pwMints, 2, 'password 的铸造点数量变了 —— 变了就得确认新那处也有门');
  assert.equal(
    (password.match(/const blocked = inviteBlocked\(email\);\s*\n\s*if \(blocked\) return blocked;/g) || []).length, 2,
    'password 的注册/登录两个出口都要过门',
  );

  // 门必须真的调判据,不是摆设
  assert.ok(/isInvited\(email\)/.test(password), 'password 的门要真调 isInvited');
  assert.ok(/emailFromAccessToken\(session\.access_token/.test(callback), 'callback 要从 token 里取邮箱');
}

// ── ④ 被挡时不许谎报成功 ───────────────────────────────────────────────────
//
// 最早那版被挡后 redirect 里仍写着 status=session_established:用户被送回首页、
// 界面显示登录成功,而 cookie 一个都没发 —— 他会一路点下去,每个动作都 401。
{
  const callback = read('app/api/auth/callback/route.ts');
  // ⚠️ 必须**数**,不能只查「存在一处」。
  // callback 有两条回跳路径(code 交换 / OTP 验证),各自构造一次 target。
  // 第一版只用 .test() 查存在,于是把其中一处改回裸的 'session_established' 时
  // ——正是最可能发生的那种半吊子改动——契约照样绿。
  assert.equal(
    (callback.match(/allowed \? 'session_established' : 'not_invited'/g) || []).length, 2,
    '两条回跳路径被挡时都必须说 not_invited,不许还说 session_established',
  );
  assert.equal(
    (callback.match(/allowed \? 'auth_callback_received' : 'auth_not_invited'/g) || []).length, 2,
    'auth 参数同理,两处都要',
  );
  assert.equal(
    (callback.match(/authReady: allowed \? /g) || []).length, 2,
    'authReady 也要跟着 allowed —— 说「准备好了」而实际没登录,是同一种谎',
  );
  // 反向:不许再出现不看 allowed 的裸措辞。
  assert.ok(
    !/status: session\?\.access_token \? 'session_established'/.test(callback),
    '不许出现「只看有没有 token 就说登录成功」的措辞',
  );
}

// ── ⑤ 用户得看得见为什么 ───────────────────────────────────────────────────
//
// 说成「登录失败」的话,人会反复试密码、重发验证码,最后以为是自己账号坏了。
{
  const login = read('components/portal/LoginPageClient.tsx');
  assert.ok(/error === 'not_invited'/.test(login), '密码登录被挡时要有专门的一句话');
  assert.ok(/邀请制/.test(login), '要说清楚是名单问题,不是他填错了');
  assert.ok(/本地/.test(login), '要留出口:不登录也能用本地功能,那不是安慰话');

  // magic link / 第三方那条是 redirect 回首页,所以首页也得说得出话。
  const portal = read('components/portal/Portal.tsx');
  assert.ok(
    /params\.get\('status'\) !== 'not_invited' && params\.get\('auth'\) !== 'auth_not_invited'/.test(portal),
    '首页要认得出被挡的那次回跳 —— 不然用户看到的是「点了邮件、回来了、什么也没发生」',
  );
  assert.ok(/setNotInvited\(true\)/.test(portal) && /notInvited && \(/.test(portal), '认出来之后要真的渲染一条提示');
}

console.log('invite-gate: OK(没配=门不存在 / 门开着读不到邮箱就挡 / 4 处铸造点都有门 / 被挡不谎报成功 / 两条路都说得出人话)');
