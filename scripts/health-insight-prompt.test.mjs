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
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), Math, Number, Array, String, Object, console });
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

// 英文
const en = buildHealthInsightPrompt({ ...input, locale: 'en' });
assert.ok(/not instructions/.test(en) && /do not invent/.test(en), 'E2:英文围栏+禁发明');

// 兜底:无 key 时也有可读产出
const fb = fallbackHealthInsight(input);
assert.ok(fb.length > 0 && /次日血糖越低/.test(fb), 'E2:确定性兜底含关系');
assert.equal(fallbackHealthInsight({ locale: 'zh', relationships: [], summary: {} }).length > 0, true, 'E2:空数据兜底仍有文案');

console.log('health-insight-prompt: OK');
