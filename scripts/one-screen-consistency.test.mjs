/**
 * 行为契约:一屏之内不许自相矛盾(2026-07-30 真机,bug #11 / #21 / #22 / #28)。
 *
 * 四条报告长得完全不同,病根只有两种:
 *
 * 【一个问题被问了好几遍,答案各不相同】
 *   #21 设置 → 数据与隐私:顶上「已登录 · 云同步已开」,旁边气泡「未登录、未授权…」。
 *       同一个问题在 SettingsSheets 两处、ConnectorsHub、NesioProfileCard 各 fetch 一遍
 *       `/api/auth/session`,各自定义失败怎么办,初值还不一样(有的直接是 false)。
 *       只要有一路慢了、抖了一下,屏幕上就出现两个相反的事实,而两边都言之凿凿。
 *   #22 会员页「试用中 / 规划中 / 你已是 Pro 会员」三句话打架。上一轮把状态卡接上了 `pro`,
 *       但另外两块还在看 `isPaidPro` —— **两个判据管三块内容**,一分歧矛盾就回来。
 *
 * 【拿到什么就印什么,不问这句话的前提成不成立】
 *   #11 「电量 59% · 未插枪」和「本次已充 27.2 kWh」同屏,再下面还有
 *       「还没有充电记录」。charge_energy_added 断枪后仍保留上一段的读数;
 *       而空态判据是「我这个数组是空的」,不是「这一屏一个充电数字都没有」。
 *   #28 「血糖达标率良好 / 血糖稳定 = 正常」和「GMI 5.9% · 糖尿病前期区间」同屏。
 *       这一条**数据没错** —— TIR 说时间、CV 说起伏、GMI 说平均线,量的不是同一件事。
 *       错的是没有任何一句话说明这一点。所以修法不是删掉哪一条(删了才是骗人),
 *       是把关系讲出来。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

/* ══ #11 车:「本次」有前提;「没有记录」也有前提 ═══════════════════ */
{
  const { chargeEnergyLine, hasAnyChargeRecord, isInSession } = loadTs('lib/portal/tesla-charge-copy.ts');

  // 截图里那一屏:未插枪 + 27.2 kWh
  const unplugged = chargeEnergyLine('Disconnected', 27.2);
  assert.equal(unplugged.live, false);
  assert.doesNotMatch(unplugged.zh, /本次|这次/,
    '断枪之后 charge_energy_added 留着的是**上一段**的读数。' +
    '说成「本次已充」就等于告诉用户车正在充电 —— 而屏幕上明写着未插枪');
  assert.match(unplugged.zh, /上次/, '得说清这是上一段的数');

  assert.match(chargeEnergyLine('Charging', 27.2).zh, /本次/, '真在充,才配说「本次」');
  assert.equal(chargeEnergyLine('Charging', 27.2).live, true);
  assert.equal(chargeEnergyLine('Complete', 12).live, true, '充满了但还插着,这一段仍在');
  assert.equal(isInSession('Disconnected'), false);
  assert.equal(isInSession('Charging'), true);

  // 没数就别硬凑一句
  for (const bad of [null, undefined, 0, NaN]) {
    assert.equal(chargeEnergyLine('Charging', bad), null, `${bad} 不该编出一句话`);
  }

  // 空态:判据是「这一屏一个充电数字都没有」,不是「我这个数组是空的」
  assert.equal(hasAnyChargeRecord(0, [27.2]), true,
    '上面刚印了 27.2 kWh,下面就说「还没有充电记录」—— 这正是 #11 的后半段。' +
    'history 只收没有电量字段的历史行,那条带电量的实时行根本不在里面');
  assert.equal(hasAnyChargeRecord(0, [null, undefined, 0]), false, '真的一个数都没有 → 可以说没记录');
  assert.equal(hasAnyChargeRecord(3, []), true);

  // 接线
  const panel = read('components/portal/TeslaPanel.tsx');
  assert.match(panel, /chargeEnergyLine\(/, '面板要真的用这套判据');
  // 2026-07-30 自查(变异测试抓到的):光断言「文件里有 anyChargeRecord」不够 ——
  // 变量还在、渲染里改成 {false 一样绿。要盯**渲染的那个条件**。
  assert.match(panel, /\{anyChargeRecord\s*\n\s*\? L\(dict, '这一段的读数在上面/,
    '空态那句话必须由 anyChargeRecord 决定 —— 否则「上面写着 27.2 kWh」和' +
    '「还没有充电记录」照样能同屏');
  assert.match(panel, /const anyChargeRecord = hasAnyChargeRecord\(/, '判据来自那一份共用函数');
  assert.doesNotMatch(panel, /本次已充 \$\{v\.charge\.energyAddedKwh\}/,
    '旧写法(不问状态直接冠上「本次」)必须删掉 —— 那就是 #11 本身');

  // #12:加载态必须有尽头(等待条不会自己消失,是同一屏上的另一种「说不通」)
  assert.match(panel, /timeoutMs=\{20_000\}/,
    '数据层的超时是一道闸,真机上还会有 abort 没生效 / 两趟请求在飞的漏法。' +
    'LoadingCard 自己也得有尽头(CLAUDE.md 红线)');
  assert.match(panel, /const seq = \+\+reqRef\.current/,
    '语言切换会让 load 重建、两个请求在飞;先发的后回会把已经 ready 的界面推回 loading');
}

/* ══ #21 登录态:一个问题一个答案,且「问不出来」≠「没登录」 ═════════ */
{
  const src = read('lib/portal/session-state.ts');
  assert.match(src, /'signed-in' \| 'signed-out' \| 'unknown'/,
    '三态。把未知当没登录,就是「未登录、未授权…」那半句的由来');
  assert.match(src, /if \(!res\.ok\) return current;/,
    '非 200 = 问不出来,不许推成 signed-out');
  assert.match(src, /if \(inFlight\) return inFlight;/, '在途去重 —— 一屏六个组件不该打六次');

  // 消费者都改用同一份,不许再各自 fetch
  for (const f of [
    'components/portal/SettingsSheets.tsx',
    'components/portal/ConnectorsHub.tsx',
    'components/portal/NesioProfileCard.tsx',
  ]) {
    const s = read(f);
    assert.doesNotMatch(s, /fetch\('\/api\/auth\/session'/,
      `${f} 不许再自己问一遍 —— 各问各的就会出现「已登录」和「未登录」同屏`);
    assert.match(s, /useSessionState\(/, `${f} 要用那份唯一的答案`);
  }

  // 登出之后必须让缓存失效,否则 30s 内还说你登着
  assert.match(read('components/portal/NesioProfileCard.tsx'), /invalidateSession\(\)/,
    '登出后不作废缓存,页面会在 TTL 内继续说「已登录」');
}

/* ══ #22 会员页:一个判据管整屏 ═════════════════════════════════════ */
{
  const s = read('components/portal/SettingsSheets.tsx');
  const at = s.indexOf('export function SubscriptionSheet');
  const sheet = s.slice(at, s.indexOf('export function', at + 40));

  // pro 只算一次,在 return 之外 —— 三块内容才可能用同一个答案
  assert.match(sheet, /const pro = isPaidPro \|\| \(getTier\(\) === 'pro' && trialDays <= 0\);/,
    '会员状态在这一屏只能有一个判据,算一次,处处用它');
  assert.match(sheet, /\{!pro && \(/,
    '「规划中」那排价格要跟着同一个判据。它原来看的是 isPaidPro —— ' +
    '本机 tier=pro 而服务端没确认时,顶上说「你已是 Pro」、中间还摆着「规划中」');
  assert.match(sheet, /\{pro \? \(/, '页尾那块也一样');
  const bodyAfterPro = sheet.slice(sheet.indexOf('const pro = isPaidPro'));
  assert.doesNotMatch(bodyAfterPro, /\{!?isPaidPro[\s?&]/,
    'pro 算完之后就不许再有任何一块直接看 isPaidPro —— 两个判据管三块内容,' +
    '只要它们分歧,三重矛盾就原样回来');
}

/* ══ #28 血糖:两边都对,那就把关系说出来 ═════════════════════════ */
{
  const { glucoseReconcileNote } = loadTs('lib/portal/health-reconcile.ts');

  const fine = [{ id: 'glucose-tir', severity: 'info' }, { id: 'glucose-cv', severity: 'info' }];
  const elevated = [{ id: 'gmi-band', category: 'moderate' }];

  const note = glucoseReconcileNote(fine, elevated);
  assert.ok(note, '截图里那一屏:两条绿字说正常 + 一条橙字说糖尿病前期。必须补一句');
  assert.match(note[0], /不冲突/, '要直说这两条不冲突,别让用户自己猜哪个是真的');
  assert.match(note[0], /平均/, '得点破 GMI 说的是平均线,TIR/CV 说的是时间和起伏');
  assert.match(note[0], /医生/, '要不要处理是医生的事,不是 App 的事');

  // 只有一边时不许多话
  assert.equal(glucoseReconcileNote(fine, [{ id: 'gmi-band', category: 'info' }]), null,
    'GMI 也正常 → 没有可解释的矛盾,多一句话就是噪音');
  assert.equal(glucoseReconcileNote([{ id: 'glucose-tir', severity: 'attention' }], elevated), null,
    '达标率本来就说偏低 → 两边一致,不用解释');
  assert.equal(glucoseReconcileNote([], []), null);

  // 接线 + 不许拿删结论当修 bug
  const dash = read('components/portal/health/HealthDashboard.tsx');
  assert.match(dash, /glucoseReconcileNote\(/, '风险卡要真的渲染这句话');
  assert.match(read('lib/portal/health-clinical.ts'), /血糖达标率良好/,
    '「血糖达标率良好」这条结论必须留着 —— 它是对的。' +
    '把矛盾的一方删掉是另一种骗人');
  assert.match(read('lib/portal/health-risk.ts'), /糖尿病前期区间/,
    '「糖尿病前期区间」也必须留着,同理');
}

console.log('one-screen-consistency: OK(本次有前提 / 空态有前提 / 登录态一个答案 / 会员一个判据 / 血糖讲清关系)');
