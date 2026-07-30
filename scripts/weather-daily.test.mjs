/**
 * 行为契约:免费最大化·天气 —— Open-Meteo daily(温度区间+降水概率+UV)。
 * 锁死:forecast 请求带 daily 参数;snapshot 解析 tempMax/tempMin/precipProb/uvMax
 * (daily 是数组取 [0]);高降水概率(≥50 且无更具体 forecastNote)给「记得带伞」;
 * daily-brief 简报用上「X~Y度」区间 + 降水概率(源码级)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, ctx) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, JSON, Math, Number, Array, Object, String, Date, URL, Boolean, ...ctx });
  return mod.exports;
}

let capturedUrl = '';
const w = loadTs('../lib/portal/providers/weather.ts', {
  require: (p) => ({}), // weather.ts 无外部 require(全内部函数)
  fetch: async (url) => {
    if (String(url).includes('weather.gov')) return { ok: true, json: async () => ({ features: [] }) };
    capturedUrl = String(url); // 只记 forecast URL(NWS 不覆盖)
    return {
      ok: true,
      json: async () => ({
        current: { temperature_2m: 22, weather_code: 0 },
        hourly: { weather_code: [0, 0, 0], time: ['t0', 't1', 't2'] },
        daily: { temperature_2m_max: [27], temperature_2m_min: [18], precipitation_probability_max: [60], uv_index_max: [7] },
      }),
    };
  },
  setTimeout: (fn) => 0, clearTimeout: () => {}, AbortController: class { abort() {} get signal() { return {}; } },
});

const snap = await w.fetchWeatherAt(35.79, -78.78, 'America/New_York', 'Cary, NC');
assert.ok(capturedUrl.includes('daily=') && capturedUrl.includes('precipitation_probability_max'), 'forecast 请求带 daily 参数');
assert.equal(snap.tempMaxC, 27, '最高温取 daily[0]');
assert.equal(snap.tempMinC, 18, '最低温取 daily[0]');
assert.equal(snap.precipProb, 60, '降水概率取 daily[0]');
assert.equal(snap.uvMax, 7, 'UV 取 daily[0]');
assert.ok(snap.forecastNote && snap.forecastNote.includes('60%') && snap.forecastNote.includes('伞'), '高降水概率给带伞提示');

// 低降水概率 → 不给带伞提示
const w2 = loadTs('../lib/portal/providers/weather.ts', {
  require: () => ({}),
  fetch: async (url) => String(url).includes('weather.gov')
    ? { ok: true, json: async () => ({ features: [] }) }
    : { ok: true, json: async () => ({ current: { temperature_2m: 22, weather_code: 0 }, hourly: { weather_code: [0], time: ['t0'] }, daily: { temperature_2m_max: [25], temperature_2m_min: [15], precipitation_probability_max: [10], uv_index_max: [3] } }) },
  setTimeout: () => 0, clearTimeout: () => {}, AbortController: class { abort() {} get signal() { return {}; } },
});
const snap2 = await w2.fetchWeatherAt(1, 1, 'UTC', 'X');
assert.ok(!snap2.forecastNote || !snap2.forecastNote.includes('伞'), '低降水概率不提示带伞');
assert.equal(snap2.precipProb, 10);

// 每日日报用上区间 + 降水概率(源码级)。
// 2026-07-30:此前这两条钉的是 app/api/portal/daily-brief/route.ts —— 那条路由是语音简报
// 时代的遗物,全仓零调用方,后来被删。契约钉在死代码上等于没钉:真正在用天气的是日报。
const report = fs.readFileSync(new URL('../lib/portal/daily-report.ts', import.meta.url), 'utf8');
assert.ok(report.includes('tempMinC') && report.includes('tempMaxC') && report.includes('~'), '日报报温度区间 X~Y');
assert.ok(report.includes('precipProb') && report.includes('降水概率'), '日报并入降水概率');

console.log('weather-daily: OK');
