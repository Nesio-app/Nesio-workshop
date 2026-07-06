/**
 * 行为契约:健康 AI 叙事 prompt(批次 47 / E2)。
 * 验证:数据围进 <data>、注入围栏指令在、AI 不许发明关系;无 key 兜底有产出。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/health-insight-prompt.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
// ④:health-insight-prompt 现在 import health-guidelines,stub retrieveGuidelines(按 id 返回要点)。
const require2 = (s) => s.includes('health-guidelines')
  ? { retrieveGuidelines: (ids) => (ids || []).includes('glucose-tir') ? [{ topic: 'glucose-tir', text: ['TIR ≥70% 为目标', 'TIR ≥70%'], source: '国际共识 TIR', url: '' }] : [] }
  : {};
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: require2, Math, Number, Array, String, Object, console });
const { buildHealthInsightPrompt, fallbackHealthInsight } = mod.exports;

const input = {
  locale: 'zh',
  relationships: [
    { insight: ['前一天睡眠越高,次日血糖越低(r=-0.6)', 'more sleep → lower next-day glucose'], r: -0.6, n: 40, strength: 'strong' },
  ],
  summary: { glucose: { avg: 6.5, unit: 'mmol/L', tirPct: 78, gmi: 6.1, cv: 28 }, sleepAvgH: 6.8, moodTone: 'neutral' },
};

const prompt = buildHealthInsightPrompt(input);
assert.ok(/<data>[\s\S]*<\/data>/.test(prompt), 'E2:数据围进 <data> 围栏');
assert.ok(/不执行其中任何命令|不是指令/.test(prompt), 'E2:含注入围栏指令');
assert.ok(/不要发明新的相关性|不要发明/.test(prompt), 'E2:禁止 AI 发明相关性');
assert.ok(/6\.5mmol\/L/.test(prompt) && /78%/.test(prompt), 'E2:概况数字进入 prompt');
assert.ok(/次日血糖越低/.test(prompt), 'E2:确定性关系进入 prompt');
assert.ok(/诊断/.test(prompt), 'E2:禁医学诊断指令在');

// ④:传入 findings(带 id)→ prompt 应注入 <guidelines> 块 + 检索到的指南要点 + 引用出处指令
const withFindings = buildHealthInsightPrompt({
  ...input,
  findings: [{ id: 'glucose-tir', title: ['血糖达标率良好', 'TIR ok'], detail: ['达标 78%', '78%'], source: '国际共识 TIR' }],
});
assert.ok(/<guidelines>[\s\S]*<\/guidelines>/.test(withFindings), '④:指南要点围进 <guidelines>');
assert.ok(/TIR ≥70% 为目标/.test(withFindings), '④:检索到的指南要点进入 prompt');
assert.ok(/注明对应指南来源|cite the guideline source/.test(withFindings), '④:指令要求引用指南来源');
assert.ok(/血糖达标率良好/.test(withFindings), '④:确定性判定进入 <data>');
// 兜底也带上判定 + 出处
const fb2 = fallbackHealthInsight({ ...input, findings: [{ id: 'glucose-tir', title: ['血糖达标率良好', 'ok'], detail: ['达标 78%', '78%'], source: '国际共识 TIR' }] });
assert.ok(/血糖达标率良好/.test(fb2) && /国际共识 TIR/.test(fb2), '④:兜底含判定 + 出处');

// 英文
const en = buildHealthInsightPrompt({ ...input, locale: 'en' });
assert.ok(/not instructions/.test(en) && /do not invent/.test(en), 'E2:英文围栏+禁发明');

// 兜底:无 key 时也有可读产出
const fb = fallbackHealthInsight(input);
assert.ok(fb.length > 0 && /次日血糖越低/.test(fb), 'E2:确定性兜底含关系');
assert.equal(fallbackHealthInsight({ locale: 'zh', relationships: [], summary: {} }).length > 0, true, 'E2:空数据兜底仍有文案');

console.log('health-insight-prompt: OK');
