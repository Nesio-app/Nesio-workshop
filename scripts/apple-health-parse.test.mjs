/**
 * 行为契约:Apple Health 解析 —— 单位换算 / 多设备去重 / 脏值 / 瞬时心率移除 / 全文件概况节点。
 *
 * 健康卡评测修复:
 *  - 读 XML 的 unit= 换算(lb→kg / mi→km / degF→°C / mmol→mg/dL 等),不再硬编码公制。
 *  - 多设备(iPhone+Watch)同天步数取最大源,不裸加。
 *  - 离谱脏值(spo2=9999)丢弃。
 *  - 瞬时 heartRate 不再作看板指标(误导)。
 *  - 概况/锻炼记忆节点基于全文件(parseHealthFromBytes),不再只解析尾部 6MB。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/apple-health.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
const require2 = (s) => {
  if (s === './health-latest.mjs') {
    return {
      pickLatestCompleteDay: (days, today) => {
        if (!days.length) return null;
        let i = days.length - 1;
        if (i > 0 && days[i][0] === today) i--;
        return { last: days[i], prev: i > 0 ? days[i - 1][1] : null };
      },
    };
  }
  throw new Error('unexpected import ' + s);
};
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: require2, TextDecoder, TextEncoder, Date, Math, Number, Map, Set, RegExp, String, Array, console });
const AH = mod.exports;

const d2 = new Date(Date.now() - 86_400_000);
const d3 = new Date(Date.now() - 2 * 86_400_000);
const iso = (dt, h = 10) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}:00:00 -0800`;
const xml = `
<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="lb" value="160" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="8000" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" value="7500" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Watch" unit="mi" value="3" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierBodyTemperature" sourceName="Therm" unit="degF" value="98.6" startDate="${iso(d3)}" endDate="${iso(d3)}"/>
<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="bpm" value="58" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" value="9999" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
<Record type="HKQuantityTypeIdentifierBloodGlucose" sourceName="Dexcom" unit="mmol<180.15588000005408>/L" creationDate="${iso(d2)}" startDate="${iso(d2)}" endDate="${iso(d2)}" value="5.5"/>
<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" startDate="${iso(d2)}" endDate="${iso(d2)}"/>
`;
const { metrics, nodes } = AH.parseHealthFromBytes(new TextEncoder().encode(xml));
const get = (k) => metrics.metrics.find((m) => m.key === k);

assert.ok(Math.abs(get('weight').latest - 72.57) < 0.1, 'lb→kg(160lb≈72.6kg)');
assert.ok(Math.abs(get('distance').latest - 4.828) < 0.01, 'mi→km(3mi≈4.83km)');
assert.ok(Math.abs(get('bodyTemp').latest - 37.0) < 0.1, 'degF→°C(98.6°F≈37°C)');
assert.equal(get('steps').latest, 8000, '多设备取最大源(8000,非 15500)');
assert.equal(get('spo2'), undefined, '脏值 9999 丢弃');
assert.equal(get('heartRate'), undefined, '瞬时心率移除');
assert.ok(get('restingHR').latest === 58, '静息心率保留');
// 血糖 mmol/L 的单位写作 mmol<180.156>/L(字面 '<>')—— 旧正则 [^>]* 会在单位里的 '>' 处
// 截断整条记录、丢掉其后的 startDate/value → 血糖被当脏值全丢。修复后应正确抽取并换算 mmol→mg/dL。
assert.ok(get('glucose'), '血糖被提取(摩尔单位不再截断记录)');
assert.ok(Math.abs(get('glucose').latest - 99) < 1.5, `mmol→mg/dL(5.5mmol/L≈99mg/dL),实得 ${get('glucose')?.latest}`);

const summary = nodes.find((n) => n.type === 'health_state');
assert.ok(summary && /步/.test(summary.rawInput) && /体重/.test(summary.rawInput), '概况节点全文件包含步数+体重');
assert.equal(summary.attributes.externalId, 'health:summary', '概况节点固定 externalId(幂等)');
assert.equal(nodes.filter((n) => n.type === 'event').length, 1, '锻炼事件节点');

// ── 批次 41:流式解析器 —— 逐字节喂(把 <Record> 切在任意边界),结果必须与整体解析一致。
// 这是 1GB zip 手机闪退修复的核心:边解压边解析,任何时刻不 materialize 完整 export.xml。
const bytes = new TextEncoder().encode(xml);
const parser = AH.createHealthStreamParser();
for (let i = 0; i < bytes.length; i++) parser.push(bytes.subarray(i, i + 1), i === bytes.length - 1);
const streamed = parser.finish();
const sGet = (k) => streamed.metrics.metrics.find((m) => m.key === k);
assert.ok(Math.abs(sGet('weight').latest - 72.57) < 0.1, '流式:lb→kg 与整体一致');
assert.equal(sGet('steps').latest, 8000, '流式:多设备取最大源,跨块边界不丢记录');
assert.equal(sGet('spo2'), undefined, '流式:脏值仍丢弃');
// 逐字节喂时,分块边界会落在 mmol<180.156>/L 里的字面 '>' 处 —— 引号感知的切分必须不把血糖切碎。
assert.ok(sGet('glucose') && Math.abs(sGet('glucose').latest - 99) < 1.5, '流式:摩尔单位血糖跨字节边界不丢失');
assert.equal(streamed.metrics.metrics.length, metrics.metrics.length, '流式指标数与整体一致');
assert.equal(
  streamed.nodes.filter((n) => n.type === 'event').length,
  nodes.filter((n) => n.type === 'event').length,
  '流式锻炼事件数与整体一致',
);

console.log('apple-health-parse: OK');
