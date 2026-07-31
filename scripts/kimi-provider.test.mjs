/**
 * 行为契约:Kimi(Moonshot)作为首选 AI 通道(2026-07-31 用户:
 * 「我的 AI 调用用她的 API,然后 google 托底」)。
 *
 * ── 这份契约真正在守的是「不许猜」──────────────────────────────────────────
 * 接一个新 provider,结构上没什么难的(OpenAI 兼容形状,照抄一副骨架)。
 * 真正会出事的是两个我**不知道**的值:
 *   ① Kimi 3 的模型 ID —— 编一个,错了的表现是每次请求 4xx,而日志看着像 key 不对;
 *   ② Kimi 的定价     —— 编一个,/admin 的成本页从此长期给出一个看着精确、
 *      实则凭空捏造的金额,而没人会去怀疑它。
 * 两个都做成了必须显式配的东西。这份契约钉死的就是**不许有人后来顺手填个默认值**。
 *
 * 另外压住顺序:kimi 第一、gemini 第二,是用户明确定的主 + 托底。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── ① 顺序:主 + 托底 ───────────────────────────────────────────────────────
{
  const chain = read('lib/portal/ai-provider-chain.mjs');
  const m = /AI_COMPLETION_CHAIN = Object\.freeze\(\[([^\]]+)\]\)/.exec(chain);
  assert.ok(m, '回退链不见了');
  const order = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.equal(order[0], 'kimi', 'Kimi 必须是首选 —— 用户定的');
  assert.equal(order[1], 'gemini', 'Google 必须是紧接着的托底那一层');
}

// ── ② 模型 ID 不许有默认值 ─────────────────────────────────────────────────
//
// 这是最容易被「顺手补全」的一处:下一个人看到 `envValue('KIMI_MODEL') || ''`
// 会觉得少了个 fallback,随手补一个 'kimi-xxx' 上去。补错了不会当场发现 ——
// 请求 4xx、自动落到 Google 托底,一切看着正常,只是 Kimi 那一路从来没通过。
for (const f of ['lib/portal/ai-complete.ts', 'app/api/portal/chat/route.ts']) {
  const src = read(f);
  assert.ok(/KIMI_MODEL/.test(src), `${f} 要读 KIMI_MODEL`);
  assert.ok(
    !/envValue\('KIMI_MODEL'\)\s*\|\|\s*'[^']+'/.test(src),
    `${f}:KIMI_MODEL 不许有硬编码默认值 —— 那个 ID 我不知道,编一个错了只会表现成「key 不对」`,
  );
  assert.ok(
    /if \(!\w*[Mm]odel\) throw new Error\('kimi_model_unset'\)/.test(src),
    `${f}:没配模型要**明确抛**,不许静默用空字符串去打接口`,
  );
}

// ── ③ 定价不许编 ───────────────────────────────────────────────────────────
{
  const cost = read('lib/portal/ai-cost.ts');
  assert.ok(/KIMI_PRICE_INPUT/.test(cost) && /KIMI_PRICE_OUTPUT/.test(cost), 'Kimi 价格要走环境变量');
  // kimiPrice 的函数体里**不许出现任何非零数字字面量**。
  //
  // 第一版只查了 `input: <数字>` 这一种形状,结果 `num(env.X) || 0.6` 这种写法
  // 大摇大摆地过了 —— 而那正是「顺手补个 fallback」最自然的写法。
  // 断言窄到只认一种写法,等于没有断言。改成:把数字全抓出来,必须都是 0。
  const kimiFn = cost.slice(cost.indexOf('function kimiPrice'), cost.indexOf('export type AiCostProvider'));
  const nums = (kimiFn.match(/(?<![\w.])\d+(?:\.\d+)?/g) || []).filter((n) => Number(n) !== 0);
  assert.deepEqual(
    nums, [],
    `kimiPrice 里不许出现写死的非零价格(抓到:${nums.join(', ')})—— 那个数字没有出处,`
    + '填进去只会让 /admin 长期给出一个看着精确、实则捏造的金额',
  );
  // 「没配价格」和「便宜到接近 0」必须分得开 —— 而且是**真调一遍**,不是搜源码。
  //
  // 第一版只断言「源码里有 `if (provider !== 'kimi') return true;` 这一行」。
  // 在它前面插一句 `return true;` 就能让整个函数恒真,而那行原文还在 —— 照样绿。
  // 文本断言压不住行为,这一条必须实际执行。
  const js = ts.transpileModule(cost, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}),
    process: { env: {} },   // 默认环境:什么都没配
    console, Object, Array, String, Number, Math, JSON, Boolean, RegExp,
  });
  const { priceKnown, priceFor } = mod.exports;

  assert.equal(priceKnown('kimi', {}), false, '没配价格时必须如实说「不知道」');
  assert.equal(priceKnown('kimi', { KIMI_PRICE_INPUT: '0.6' }), true, '配了就算知道');
  assert.equal(priceKnown('kimi', { KIMI_PRICE_OUTPUT: '2.5' }), true, '只配输出价也算知道');
  assert.equal(priceKnown('gemini', {}), true, '别家的价格有出处,恒为已知');
  assert.equal(priceKnown('claude', {}), true);
  // 没配价格时算出来的是 0 —— 这个 0 的含义由 priceKnown 负责说清,不是「免费」。
  const p = priceFor('kimi', 'whatever');
  assert.equal(p.input, 0, '没配就是 0,不许凭空冒出一个价');
  assert.equal(p.output, 0);
}

// ── ④ key 别名两处同步 ─────────────────────────────────────────────────────
//
// 仓里栽过一次:同一把 key 有多个 env 名,某条路只读了其中一个 → key 配了却静默走兜底。
{
  const keys = read('lib/portal/ai-keys.ts');
  const contract = read('lib/portal/contracts/ai-provider-router-contract.mjs');
  assert.ok(/kimi: \['KIMI_API_KEY', 'MOONSHOT_API_KEY'\]/.test(keys), 'ai-keys 要认两个别名');
  assert.ok(
    /alternateGroups: \[\['KIMI_API_KEY', 'MOONSHOT_API_KEY'\]\]/.test(contract),
    '路由契约里的别名组要和 ai-keys 一字不差 —— 两处漂了就会「配了但那一路读不到」',
  );
}

// ── ⑤ 真的接进了两条调用路径 ───────────────────────────────────────────────
//
// completeText(一问一答的共用通道)和 chat 路由(它自己手写了一份分派)。
// 只改其中一条的下场很具体:「问一问走了 Kimi、日报还在走 Google」,而且没人看得出来。
{
  const complete = read('lib/portal/ai-complete.ts');
  assert.ok(/const kimiKey = resolveAiKey\('kimi'\)/.test(complete), 'completeText 要解析 kimi key');
  assert.ok(
    /if \(kimiKey\) \{[\s\S]{0,400}callKimi\(/.test(complete),
    'completeText 里 kimi 要排在最前面试',
  );
  assert.ok(
    /aiProviderAvailable[\s\S]{0,300}resolveAiKey\('kimi'\)/.test(complete),
    '「有没有可用 provider」也要把 kimi 算进去 —— 漏了它,只配 Kimi 的部署会被判成「没有 AI」',
  );

  const chat = read('app/api/portal/chat/route.ts');
  assert.ok(/async function callKimi\(/.test(chat), 'chat 路由要有自己的 callKimi(它带 history)');
  assert.ok(
    /const result = kimiKey\s*\n\s*\? await callKimi\(/.test(chat),
    'chat 主试要从 kimi 开始',
  );
  assert.ok(
    /if \(!kimiKey && !anthropicKey && !geminiKey && !openaiKey\)/.test(chat),
    '「一个 provider 都没配」的判断要带上 kimi —— 漏了它,只配 Kimi 的部署会直接走「云端脑子有点挤」',
  );
  assert.ok(
    /if \(geminiKey && \(kimiKey \|\| anthropicKey\)\)/.test(chat),
    '主用的不是 gemini 时才在 catch 里试它;主就是 gemini 的话再打一次是白撞同一个配额池',
  );
}

console.log('kimi-provider: OK(主+托底顺序 / 模型 ID 不许编 / 定价不许编 / 别名两处同步 / 两条调用路径都接上)');
