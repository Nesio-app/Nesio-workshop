/**
 * 行为契约:地点洞察(Layer1 health 范式铺开·地图域)。
 * 真 place-insight + 真 domain-rules,注入分类器。锁死:
 *   活动范围收窄/健身断档 在该触发时触发;
 *   数据诚实门:追踪不活跃不判、历史不够冷启动沉默、没断档不判;
 *   只出 attention(不制造焦虑,红色只给真实风险)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, requireImpl) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, Math, Number, Array, Date, Set, Map, console });
  return mod.exports;
}
const domainRules = loadTs('../lib/portal/domain-rules.ts', () => ({}));
const place = loadTs('../lib/portal/place-insight.ts', (p) =>
  p === './domain-rules' ? domainRules : p === './place-trail' ? { categoryOfPlace: () => 'place' } : ({}));

const NOW = new Date('2026-07-01T12:00:00.000Z');
const daysAgo = (d, hour = 10) => new Date(NOW.getTime() - d * 86_400_000 + hour * 3_600_000 - 12 * 3_600_000).toISOString();
const visit = (label, d) => ({ ts: daysAgo(d), label, source: 'live' });
// 分类器:label 前缀决定类别(home:/fit:/其余=place)
const categorize = (label) => (label.startsWith('home') ? 'home' : label.startsWith('fit') ? 'fitness' : 'place');

// ── 活动范围收窄 ──
// 历史 8 周:每周 5 个不同非家地点;本周:只有家 + 1 个地点(但有 ≥3 条记录 → 追踪存活)
{
  const visits = [];
  for (let w = 1; w <= 8; w++) for (let i = 0; i < 5; i++) visits.push(visit(`spot-w${w}-${i}`, w * 7 + i));
  visits.push(visit('home-a', 1), visit('home-a', 2), visit('spot-x', 3)); // 本周 3 条记录,非家仅 1
  const out = place.placeFindings({ visits, now: NOW, categorize });
  const f = out.find((x) => x.id === 'place-range-narrow');
  assert.ok(f, '常态每周 ~5 个地点、本周只 1 个 → 触发');
  assert.equal(f.severity, 'attention', '只轻观察,不出红');
  assert.match(f.detail[0], /平时每周约 5 个/, '带你的常态数字');

  // 本周记录 <3 条(追踪可能没开)→ 不判
  const sparse = visits.filter((v) => !v.label.startsWith('home') || v.label !== 'home-a').slice();
  const sparseOut = place.placeFindings({ visits: [...visits.slice(0, 40), visit('spot-y', 2)], now: NOW, categorize });
  assert.equal(sparseOut.find((x) => x.id === 'place-range-narrow'), undefined, '本周记录不足 → 追踪存活门拦下');
  void sparse;
}

// 历史只有 2 周 → 冷启动沉默
{
  const visits = [];
  for (let w = 1; w <= 2; w++) for (let i = 0; i < 5; i++) visits.push(visit(`spot-w${w}-${i}`, w * 7 + i));
  visits.push(visit('home-a', 1), visit('home-a', 2), visit('home-a', 3));
  assert.equal(place.placeFindings({ visits, now: NOW, categorize }).length, 0, '历史 <3 周 → 沉默');
}

// 本周活跃(非家 ≥2)→ 不触发
{
  const visits = [];
  for (let w = 1; w <= 8; w++) for (let i = 0; i < 5; i++) visits.push(visit(`spot-w${w}-${i}`, w * 7 + i));
  visits.push(visit('spot-a', 1), visit('spot-b', 2), visit('home-a', 3));
  assert.equal(place.placeFindings({ visits, now: NOW, categorize }).find((x) => x.id === 'place-range-narrow'), undefined, '本周正常活跃 → 不触发');
}

// ── 健身断档 ──
// 此前 8 周里 4 周去过健身;近 14 天 6 条记录但零健身 → 触发
{
  const visits = [];
  for (const w of [0, 1, 3, 5]) visits.push(visit(`fit-gym`, 15 + w * 7));
  for (let d = 1; d <= 6; d++) visits.push(visit(`spot-${d}`, d));
  const out = place.placeFindings({ visits, now: NOW, categorize });
  const f = out.find((x) => x.id === 'place-fitness-lapse');
  assert.ok(f, '习惯存在 + 两周断档 + 追踪存活 → 触发');
  assert.equal(f.severity, 'attention', '轻观察');
  assert.match(f.detail[0], /8 周里有 4 周/, '带习惯证据');

  // 近 14 天里有健身 → 不触发
  const withFit = [...visits, visit('fit-gym', 2)];
  assert.equal(place.placeFindings({ visits: withFit, now: NOW, categorize }).find((x) => x.id === 'place-fitness-lapse'), undefined, '没断档 → 不触发');

  // 此前健身只 2 周(习惯不成立)→ 不触发
  const weakHabit = visits.filter((v) => !v.label.startsWith('fit')).concat([visit('fit-gym', 20), visit('fit-gym', 30)]);
  assert.equal(place.placeFindings({ visits: weakHabit, now: NOW, categorize }).find((x) => x.id === 'place-fitness-lapse'), undefined, '习惯不成立 → 沉默');

  // 近 14 天记录 <5(追踪可能没开)→ 不触发
  const sparse = visits.filter((v) => v.label.startsWith('fit')).concat([visit('spot-1', 1), visit('spot-2', 2)]);
  assert.equal(place.placeFindings({ visits: sparse, now: NOW, categorize }).find((x) => x.id === 'place-fitness-lapse'), undefined, '追踪不活跃 → 拦下');
}

// 空数据 → 空
assert.equal(place.placeFindings({ visits: [], now: NOW, categorize }).length, 0, '无足迹返回空');

console.log('place-insight: OK');
