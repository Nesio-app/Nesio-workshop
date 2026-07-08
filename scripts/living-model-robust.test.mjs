/**
 * 行为契约:认知模型生成鲁棒性(修「no JSON in response」——与 key/provider 无关的真凶)。
 *
 * 同一条 completeText 通道,拍一拍(小输出)能用、认知模型(7 层大 JSON)失败:根因在本路由
 * 自己 —— token 太少被截断、温度太高跑成大白话、裸正则抠不出。锁死三处修复 + 客户端 json 模式。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/living-model/route.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../lib/portal/ai-complete.ts', import.meta.url), 'utf8');

// ── 路由:大结构化输出的三处硬修 ──
assert.ok(/maxTokens:\s*4000/.test(route), 'maxTokens 抬到 4000(7 层装得下,不再截断在首个 { 之前)');
assert.ok(!/maxTokens:\s*1500/.test(route), '旧的 1500 已移除');
assert.ok(/temperature:\s*0\b/.test(route), 'temperature 0(结构化输出不跑偏)');
assert.ok(/responseFormat:\s*'json'/.test(route), '开 json 模式(Gemini 强制合法 JSON)');

// ── 路由:稳健解析,不再用裸正则 ──
assert.ok(/parseJsonBlock/.test(route), '解析走共享 parseJsonBlock(与拍一拍/物品同款)');
assert.ok(!/raw\.match\(\/\\\{\[/.test(route), '旧的裸正则 raw.match(/\\{.../) 已移除');

// ── 共享客户端:responseFormat 贯通到 Gemini 的 responseMimeType ──
assert.ok(/responseFormat\?:\s*'json'/.test(client), 'completeText 暴露 responseFormat:json');
assert.ok(/responseMimeType:\s*'application\/json'/.test(client), 'Gemini 设 responseMimeType application/json');
assert.ok(/responseFormat === 'json'/.test(client), 'json 模式条件下才加 responseMimeType(不影响其它调用者)');

console.log('living-model-robust: OK');
