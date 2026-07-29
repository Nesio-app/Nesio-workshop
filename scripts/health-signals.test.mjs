/**
 * 行为契约:健康四类 Signal(lib/health/health-signals.ts)。
 *
 * 这条锁的是**健康数据接回主事实表**这件事最容易坏的四处:
 *   ① 绕过写入闸门 —— 直接 addLifeNode,数据落进图但不进 Signal 表,问一问永远看不见;
 *   ② 敏感度/保留策略漏标 —— 健康信号被剪枝引擎当过期内容清掉,或漏进普通导出;
 *   ③ 投影不幂等 —— 每次导入 Apple 健康记录就把化验单翻一倍;
 *   ④ 参考区间瞎猜 —— 医院没给区间时自己编一个 normal/high,那是撒谎。
 *
 * ①②用调用点 regex 锁源码(纯函数测不出「有没有走对路」);③④在 vm 里跑真函数。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const SRC = fs.readFileSync(new URL('../lib/health/health-signals.ts', import.meta.url), 'utf8');

/**
 * 只看**代码**,不看注释。
 * 踩过:第一版直接对全文 match `sensitivity: 'health'`,而文件头注释里正好写着这句 ——
 * 我把真正的那行删掉做变异测试,测试照样绿。注释里的承诺不是承诺。
 */
const CODE = stripComments(SRC);

// ── ① 写入闸门:只准 createSignal,不准 addLifeNode ────────────────────────────
{
  assert.ok(
    /\bcreateSignal\s*\(/.test(CODE),
    '健康写入必须走 createSignal() —— 只 import 不调用等于没走闸门',
  );
  assert.ok(
    !/\baddLifeNode\s*\(/.test(CODE),
    '健康写入直接调了 addLifeNode:绕过写入闸门,数据不会进 Signal 主事实表(问一问就瞎了)',
  );
}

// ── ② 敏感度 + 保留策略必须写死,不能靠推断 ──────────────────────────────────
{
  assert.match(CODE, /sensitivity:\s*'health'/, "健康 Signal 必须显式 sensitivity: 'health'");
  assert.match(CODE, /retentionPolicy:\s*'AlwaysAlive'/, "健康 Signal 必须 retentionPolicy: 'AlwaysAlive'(不许被剪枝清掉)");
  // 四种写入都必须经过同一个包装函数,不许某一类偷偷绕开(绕开就漏标敏感度)。
  const wrapperCalls = CODE.match(/\bwriteHealth\s*\(/g) || [];
  assert.ok(
    wrapperCalls.length >= 5, // 1 处定义 + 4 处调用
    `四类健康写入应各自经 writeHealth();现在只找到 ${wrapperCalls.length - 1} 处调用`,
  );
}

// ── 载入纯函数 ────────────────────────────────────────────────────────────────
// health-signals 依赖 create-signal(碰 localStorage/IDB),整个 transpile 跑不起来。
// 这里只抠出纯函数段落 —— 它们本来就是为了可单测才拆开写的。
function loadPure() {
  const start = SRC.indexOf('// ── 纯函数');
  const end = SRC.indexOf('// ── 写入');
  assert.ok(start > 0 && end > start, 'health-signals.ts 里的「纯函数」段落标记没了 —— 契约测试靠它定位');
  const head = `const SELF_PERSON_KEY = 'self';
const HEALTH_LAB='health.lab', HEALTH_MED='health.med', HEALTH_SYMPTOM='health.symptom', HEALTH_VISIT='health.visit';
const HEALTH_SIGNAL_TYPES=[HEALTH_LAB,HEALTH_MED,HEALTH_SYMPTOM,HEALTH_VISIT];
`;
  const js = ts.transpileModule(head + SRC.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, String, Array, Object });
  return mod.exports;
}
const M = loadPure();

// ── ④ 参考区间:没给区间就别猜 ────────────────────────────────────────────────
{
  assert.equal(M.labFlag({ value: 5.4 }), undefined, '没有参考区间时不许自己判 normal —— 那是编的');
  assert.equal(M.labFlag({ value: 5.4, low: 3.9, high: 6.1 }), 'normal');
  assert.equal(M.labFlag({ value: 7.2, low: 3.9, high: 6.1 }), 'high');
  assert.equal(M.labFlag({ value: 3.1, low: 3.9, high: 6.1 }), 'low');
  // 只有上界(很多指标只有「<x」)也要能判
  assert.equal(M.labFlag({ value: 9, high: 6 }), 'high');
  assert.equal(M.labFlag({ value: 4, high: 6 }), 'normal');
  // 医院自己给了 flag 就听医院的(比我们准),即便区间对不上
  assert.equal(M.labFlag({ value: 5.4, low: 3.9, high: 6.1, flag: 'high' }), 'high');
  // 非数值不许当正常
  assert.equal(M.labFlag({ value: Number.NaN, low: 1, high: 2 }), undefined);
}

// ── ③ 去重粒度:同人同指标同日 = 同一条 ────────────────────────────────────────
{
  const a = M.healthExternalId('health.lab', 'self', ['空腹血糖', '2026-03-01']);
  const b = M.healthExternalId('health.lab', 'self', ['空腹血糖', '2026-03-01']);
  assert.equal(a, b, '同一条化验必须得到同一个 externalId,否则重复导入会翻倍');
  assert.notEqual(a, M.healthExternalId('health.lab', 'self', ['空腹血糖', '2026-04-01']), '不同日期是不同条');
  assert.notEqual(a, M.healthExternalId('health.lab', 'linda@x.com', ['空腹血糖', '2026-03-01']), '不同人是不同条');
  // 大小写/空格不该造出第二条
  assert.equal(a, M.healthExternalId('health.lab', 'self', [' 空腹血糖 ', '2026-03-01']));
  // 缺日期(用药)也要稳定
  assert.equal(
    M.healthExternalId('health.med', 'self', ['二甲双胍', undefined]),
    M.healthExternalId('health.med', 'self', ['二甲双胍']),
  );
}

// ── 老数据升级:只有药名时不编剂量 ──────────────────────────────────────────────
{
  const med = M.medFromLegacyName('  二甲双胍 ', 'self');
  assert.equal(med.name, '二甲双胍');
  assert.equal(med.personKey, 'self');
  assert.equal(med.dose, undefined, '老数据没有剂量,不许编一个');
  assert.equal(med.startedAt, undefined, '老数据没有起始日,不许编 —— 编了指标详情屏那条虚线就是假的');
}

// ── 归属人:老数据没有 personKey 时算本人,不许落成 undefined ────────────────────
{
  assert.equal(M.personKeyOf({}), 'self');
  assert.equal(M.personKeyOf({ payload: {} }), 'self');
  assert.equal(M.personKeyOf({ payload: { personKey: '' } }), 'self');
  assert.equal(M.personKeyOf({ payload: { personKey: 'linda@x.com' } }), 'linda@x.com');
}

// ── 类型判定 ──────────────────────────────────────────────────────────────────
{
  assert.ok(M.isHealthSignal({ type: 'health.lab' }));
  assert.ok(M.isHealthSignal({ type: 'health.visit' }));
  assert.ok(!M.isHealthSignal({ type: 'health_state' }), '老的 LifeNode 类型不算健康镜头四类');
  assert.ok(!M.isHealthSignal({ type: 'note' }));
}

// ── 标题 ──────────────────────────────────────────────────────────────────────
{
  assert.equal(M.labTitle({ name: '空腹血糖', value: 5.4, unit: 'mmol/L' }), '空腹血糖 5.4 mmol/L');
  assert.equal(M.labTitle({ name: 'TIR', value: 78 }), 'TIR 78');
}

console.log('health-signals: OK(写入闸门 + 敏感度 + 幂等去重 + 参考区间不瞎猜)');
