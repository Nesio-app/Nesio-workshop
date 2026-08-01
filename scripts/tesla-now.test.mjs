/**
 * 行为契约:车的「此刻」(2026-08-01,用户:「如果能做成图 3 和 4 就好」)。
 *
 * 图 3/4 是 Tesla 官方拿 Fleet API 做的**车队**看板。这里是转译不是照搬:
 * 79 辆车有「分布」,一辆车没有 —— 硬做成环形图只会得到一个 100% 单色的装饰。
 *
 * 这一条真正要钉死的是**一个旧数字不许被摆成新的**。
 * Tesla 回的 `drive_state.timestamp` 是**车上**那份读数的时刻,和我们问它的
 * 时刻是两回事:深度休眠时能差好几个小时。界面若默认「刚刚」,
 * 一个昨晚的电量就会被当成此刻 —— 而用户会照着它决定要不要现在出门。
 * **一个旧数字被摆成新的,比没有数字更危险。**
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const js = ts.transpileModule(read('lib/portal/tesla-now.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, console,
  Date, Math, Number, Array, Object, String, Boolean, JSON,
});
const T = mod.exports;

const NOW = Date.parse('2026-08-01T12:00:00Z');
const ago = (ms) => NOW - ms;
const MIN = 60_000, HOUR = 3_600_000;

/* ══ ① 太旧的读数不许说成「停放中」 ═══════════════════════════════════════ */
{
  // 8 小时前的读数说「停放中」,听起来像是此刻确认过的 —— 而我们根本不知道它现在在哪
  assert.equal(T.vehicleStatus({ shiftState: 'P', dataAgeMs: ago(13 * HOUR) }, NOW), 'stale',
    '超过 12 小时没上报,不许再说「停放中」');
  assert.equal(T.vehicleStatus({ shiftState: 'P', dataAgeMs: ago(11 * HOUR) }, NOW), 'parked',
    '11 小时还在容忍范围内');
  // **太旧优先于一切** —— 一份 13 小时前「正在充电」的读数,现在多半早就充完了
  assert.equal(T.vehicleStatus({ chargingState: 'Charging', dataAgeMs: ago(13 * HOUR) }, NOW), 'stale',
    '旧读数里的「正在充电」不许当成此刻还在充');

  // 不知道读数时刻时**不判 stale**:那会把一辆好好的车说成联系不上
  assert.equal(T.vehicleStatus({ shiftState: 'P', dataAgeMs: null }, NOW), 'parked');
  assert.equal(T.vehicleStatus({ shiftState: 'P' }, NOW), 'parked');
}

/* ══ ② 在充优先于停着;在开是在开 ═════════════════════════════════════════ */
{
  // 正在充电的车当然也停着,但点开这一页想知道的是「充到哪了」
  assert.equal(T.vehicleStatus({ shiftState: 'P', chargingState: 'Charging', dataAgeMs: ago(MIN) }, NOW), 'charging');
  assert.equal(T.vehicleStatus({ shiftState: 'D', dataAgeMs: ago(MIN) }, NOW), 'driving');
  assert.equal(T.vehicleStatus({ shiftState: 'R', dataAgeMs: ago(MIN) }, NOW), 'driving', '倒车也是在开');
  assert.equal(T.vehicleStatus({ shiftState: 'P', chargingState: 'Disconnected', dataAgeMs: ago(MIN) }, NOW), 'parked');
  assert.equal(T.vehicleStatus({ shiftState: 'P', chargingState: 'Complete', dataAgeMs: ago(MIN) }, NOW), 'parked',
    '充满了就不再是「充电中」');

  // 四种状态四句话,不许两种说同一句
  const zh = ['driving', 'charging', 'parked', 'stale'].map((s) => T.statusLabel(s, true));
  assert.equal(new Set(zh).size, 4, '四种状态不许说同一句话');
  const en = ['driving', 'charging', 'parked', 'stale'].map((s) => T.statusLabel(s, false));
  assert.equal(new Set(en).size, 4);
  for (const e of en) assert.ok(!/[一-龥]/.test(e), `英文状态里混了中文:${e}`);

  // 「联系不上」不许用风险色 —— 车在深度休眠不是故障,不该拿红色制造焦虑
  assert.notEqual(T.statusTone('stale'), 'risk');
  assert.equal(T.statusTone('stale'), 'gentle');
  assert.equal(T.statusTone('driving'), 'go');
}

/* ══ ③ 「这份读数多旧」—— 不知道就说不知道 ═══════════════════════════════ */
{
  // **这是整条契约的核心**:默认成「刚刚」是这一屏最贵的错
  for (const bad of [null, undefined, 0, NaN, -1]) {
    const line = T.dataAgeLine(bad, true, NOW);
    assert.doesNotMatch(line, /刚刚/, `dataAgeLine(${bad}) 把不知道说成了「刚刚」`);
    assert.match(line, /不知道/, '取不到读数时刻就要如实说不知道');
  }

  assert.match(T.dataAgeLine(ago(30_000), true, NOW), /刚刚/, '半分钟内算刚刚');
  assert.match(T.dataAgeLine(ago(5 * MIN), true, NOW), /^5 分钟前/);
  assert.match(T.dataAgeLine(ago(3 * HOUR), true, NOW), /^3 小时前/);
  assert.match(T.dataAgeLine(ago(50 * HOUR), true, NOW), /^2 天前/);
  // 英文
  assert.match(T.dataAgeLine(ago(5 * MIN), false, NOW), /^5 min ago$/);
  assert.match(T.dataAgeLine(ago(3 * HOUR), false, NOW), /^3 h ago$/);
  for (const ms of [ago(30_000), ago(5 * MIN), ago(3 * HOUR), ago(50 * HOUR), null]) {
    assert.ok(!/[一-龥]/.test(T.dataAgeLine(ms, false, NOW)), '英文版里混了中文');
  }
  // 未来时间戳(车机时钟偏了)不许算出负数分钟
  assert.match(T.dataAgeLine(NOW + 10 * MIN, true, NOW), /刚刚/, '时钟偏到未来时不许说「-10 分钟前」');
}

/* ══ ④ 充电那一行:没在充就闭嘴 ═══════════════════════════════════════════ */
{
  assert.equal(T.chargeNowLine({ chargingState: 'Disconnected', chargerPowerKw: 0 }, true), '',
    '没在充的时候说「0 kW」是一句噪音');
  assert.equal(T.chargeNowLine({ chargingState: 'Complete', chargerPowerKw: 11 }, true), '',
    '充满了也不该继续说「正在充」');
  assert.equal(T.chargeNowLine({}, true), '');

  const line = T.chargeNowLine({
    chargingState: 'Charging', chargerPowerKw: 11.4, minutesToFull: 45, chargeLimitPct: 80,
  }, true);
  assert.match(line, /正在充 11 kW/);
  assert.match(line, /45 分钟/);
  assert.match(line, /80%/, '充电上限要说出来 —— 80% 上限下的 44% 和 100% 上限下的 44% 不是一回事');

  // 超过一小时用「x 小时 y 分」
  assert.match(T.chargeNowLine({ chargingState: 'Charging', chargerPowerKw: 3, minutesToFull: 135 }, true),
    /2 小时 15 分/);
  // 功率取不到时仍要说「正在充电」,不能整句消失
  assert.match(T.chargeNowLine({ chargingState: 'Charging' }, true), /正在充电/);
  // 英文
  const en = T.chargeNowLine({ chargingState: 'Charging', chargerPowerKw: 11, minutesToFull: 45, chargeLimitPct: 80 }, false);
  assert.ok(!/[一-龥]/.test(en) && /11 kW/.test(en) && /80%/.test(en));
}

/* ══ ⑤ 续航:取不到就不说 ═════════════════════════════════════════════════ */
{
  assert.match(T.rangeLine(182.4, true), /还能开约 182 mi/);
  for (const bad of [null, undefined, 0, -5, NaN]) {
    assert.equal(T.rangeLine(bad, true), '', `rangeLine(${bad}) 应当什么都不说`);
  }
  assert.ok(!/[一-龥]/.test(T.rangeLine(182, false)));
}

/* ══ ⑥ 车况:取不到的项一个都不显示 ═══════════════════════════════════════ */
{
  // 逐项断言长度 —— vm 里的数组原型和这里不是同一个,deepEqual 会因为
  // 「结构一样但不是同一个 Array」而挂,那不是我们要压的东西。
  assert.equal(T.healthItems(null, true).length, 0);
  assert.equal(T.healthItems({}, true).length, 0,
    '什么都没拿到时返回空数组 —— 一行「胎压 —」不是信息,它把「我们没拿到」伪装成了数据');
  assert.equal(T.healthItems({ tirePsi: { fl: null, fr: null, rl: null, rr: null } }, true).length, 0,
    '四个轮胎都取不到就不显示这一项');

  const items = T.healthItems({
    tirePsi: { fl: 42, fr: 42, rl: 41, rr: 43 },
    tireSoftWarning: false,
    softwareUpdate: '',
    carVersion: '2026.20.5',
    locked: true,
    sentryMode: false,
  }, true);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(byKey.tires.value, '41–43 psi', '四个胎不一样时给区间');
  assert.equal(byKey.tires.tone, 'calm', '车没报低压警告就不该标成「有件事可以处理」');
  assert.equal(byKey.software.value, '2026.20.5', '没有待装更新时显示当前版本');
  assert.equal(byKey.software.tone, 'calm');
  assert.equal(byKey.locked.value, '已锁');
  assert.equal(byKey.locked.tone, 'calm');

  // 四个胎一样时不给区间(「42–42 psi」是一句傻话)
  assert.equal(T.healthItems({ tirePsi: { fl: 42, fr: 42, rl: 42, rr: 42 } }, true)[0].value, '42 psi');

  // **警告只认车自己报的**。我们不自己定阈值 —— 不同车型/胎的正常范围不一样,
  // 拿一个猜来的数字判「偏低」会一直误报,而误报的代价是用户从此不信这一栏。
  const warned = T.healthItems({ tirePsi: { fl: 30, fr: 42, rl: 42, rr: 42 }, tireSoftWarning: true }, true);
  assert.equal(warned[0].tone, 'gentle', '车报了低压才算');
  const lowButNoWarning = T.healthItems({ tirePsi: { fl: 30, fr: 42, rl: 42, rr: 42 }, tireSoftWarning: false }, true);
  assert.equal(lowButNoWarning[0].tone, 'calm', '看着低但车没报警告,不许自己判');

  // 待装更新 / 没锁门:这两件是「有件事可以轻轻处理」
  const upd = T.healthItems({ softwareUpdate: '2026.26.1', carVersion: '2026.20.5' }, true);
  assert.equal(upd[0].value, '2026.26.1', '有待装更新时显示新版本号,不是当前版本');
  assert.equal(upd[0].tone, 'gentle');
  assert.equal(T.healthItems({ locked: false }, true)[0].tone, 'gentle', '没锁门要提一句');

  // locked 为 null(拿不到)时**不显示**,而不是当成「没锁」吓人一跳
  assert.equal(T.healthItems({ locked: null }, true).length, 0);

  // 英文不混中文
  for (const it of T.healthItems({
    tirePsi: { fl: 42, fr: 42, rl: 42, rr: 42 }, softwareUpdate: '2026.26.1', locked: false, sentryMode: true,
  }, false)) {
    assert.ok(!/[一-龥]/.test(it.label + it.value), `英文车况里混了中文:${it.label} ${it.value}`);
  }
}

/* ══ ⑦ 接线:这些判据真的被界面用上了 ═════════════════════════════════════ */
{
  const panel = read('components/portal/TeslaPanel.tsx');
  assert.match(panel, /vehicleStatus\(\{/, '状态要走 vehicleStatus —— 那里的「太旧优先」是真跑过的');
  assert.match(panel, /dataAgeLine\(/,
    '「这份读数多旧」必须显示出来 —— 不说的话一个昨晚的电量会被当成此刻');
  assert.match(panel, /chargeNowLine\(/, '充电那一行要接上');
  assert.match(panel, /healthItems\(/, '车况格要接上');
  // 老的 shiftLabel 不许再留着:它不看数据新旧,一份 8 小时前的读数照样说「停放中」——
  // 同一件事两个说法,迟早在同一屏上打架
  assert.doesNotMatch(panel, /const shiftLabel = /,
    '状态只能有一处真源(vehicleStatus),不许再留一个不看读数新旧的旧判据');

  // API 层真的把这些字段取回来了 —— 判据再对,字段没取也是空的
  const api = read('lib/portal/tesla.ts');
  assert.match(api, /dataAgeMs: typeof ds\.timestamp === 'number'/,
    'drive_state.timestamp 要取回来,那是「读数多旧」的唯一来源');
  assert.match(api, /charger_power/, '充电功率要取');
  assert.match(api, /minutes_to_full_charge/, '还要多久充满要取');
  assert.match(api, /tpms_pressure_fl/, '胎压要取');
  assert.match(api, /climate_state/, '车内外温度在 climate_state 里,endpoint 要带上');
  assert.match(read('app/api/portal/tesla/route.ts'), /health: snapshot\.health/,
    '路由要把 health 透传出去');
  assert.match(read('docs/api-routes.md'), /2026-08-01 补 `health`/,
    '路由返回的东西变了要写进 docs/api-routes.md(CLAUDE.md 红线)');
}

/* ══ ⑧ 电量图:两个点不许画成一条「电量没变」的直线 ═══════════════════════ */
{
  const charts = read('components/portal/TeslaCharts.tsx');
  // 用户实测截图上就是一条笔直的水平线,两端标签都是 8/1。
  // 两个点当然连得成线 —— 但连出来那条线在说「这段时间电量没变」,
  // 而真相是只采到了两个点。这是这一屏里最像数据的一处装饰。
  assert.match(charts, /const enoughPoints = pts\.length >= 3/,
    '两个点不够画趋势 —— 连出来的直线在讲一件没发生过的事');
  assert.match(charts, /const enoughSpan = span >= 2 \* 60 \* 60 \* 1000/,
    '跨度不足两小时的也不该画成趋势');
  assert.match(charts, /还画不出趋势/,
    '画不出来时要说清为什么 —— 「还在攒」和「电量没变」是两回事');
  assert.match(charts, /const withinADay = span < 86_400_000/,
    '跨度不到一天时两端会是同一个日期(截图上正是「8/1 … 8/1」),要改显示时刻');
}

console.log('tesla-now: OK(旧读数不装成此刻 / 在充优先 / 不知道就说不知道 / 车况取不到就不显示 / 警告只认车自己报的 / 两点不画假趋势)');
