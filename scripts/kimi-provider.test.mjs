/**
 * 行为契约:Kimi(Moonshot)作为首选 AI 通道(2026-07-31 用户:
 * 「我的 AI 调用用她的 API,然后 google 托底」)。
 *
 * ── 前提更新(2026-07-31 下午)────────────────────────────────────────────────
 * 上一版这份契约钉的是「模型 ID 和定价我不知道,所以不许有默认值」。
 * 用户问了一句「你现在不能去搜索么」—— 能,而且早该搜。查证之后两个值都有出处了:
 *   · 模型 id `kimi-k3`、base `https://api.moonshot.ai/v1`(Kimi API 官方文档)
 *   · $3 / 百万输入,$15 / 百万输出,缓存命中 $0.30
 * 于是默认值填上了。**有出处的默认值和编一个是两回事**,前提变了契约就跟着变。
 *
 * 现在钉的是三件事:
 *   ① 默认值必须是查到的那两个,不许被改成别的(改了要有新出处);
 *   ② 顺序 kimi → gemini 是用户定的主 + 托底;
 *   ③ **reasoning_effort 必须压着**。K3 默认开思考模式且默认 max,而思考 token
 *      按输出价计费($15/M)—— Nesio 的调用绝大多数是「提取一条记忆」这种短活,
 *      让它按 max 想一遍是拿最贵的档干最轻的活。这一行是成本项,不是风格项,
 *      被谁顺手删掉不会有任何症状,只会月底账单翻几倍。
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

// ── ② 模型 ID / base / reasoning_effort:两条调用路径必须一致 ──────────────
//
// 三个值都得是查到的那个。改错了不会当场发现:请求 4xx → 自动落到 Google 托底,
// 屏幕上一切正常,只是 Kimi 那一路从来没通过 —— 而你以为它在跑。
for (const f of ['lib/portal/ai-complete.ts', 'app/api/portal/chat/route.ts']) {
  const src = read(f);
  assert.ok(
    /envValue\('KIMI_MODEL'\) \|\| 'kimi-k3'/.test(src),
    `${f}:模型 id 默认值必须是官方文档上的 kimi-k3(要改,先拿出新出处)`,
  );
  assert.ok(
    /envValue\('KIMI_API_BASE'\) \|\| 'https:\/\/api\.moonshot\.ai\/v1'/.test(src),
    `${f}:base 默认值必须是官方的国际站`,
  );
  // ③ 成本项:没有它,月底账单翻几倍而界面上什么症状都没有。
  assert.ok(
    /envValue\('KIMI_REASONING_EFFORT'\) \|\| 'low'/.test(src),
    `${f}:reasoning_effort 必须默认压到 low —— K3 默认 max,而思考 token 按输出价计费`,
  );
  assert.ok(
    /reasoning_effort: effort/.test(src),
    `${f}:算出来的 effort 要真的发出去,不能只存在变量里`,
  );
}

// ── ③ 定价:必须是查到的那个 ─────────────────────────────────────────────────
{
  const cost = read('lib/portal/ai-cost.ts');
  assert.ok(/KIMI_PRICE_INPUT/.test(cost) && /KIMI_PRICE_OUTPUT/.test(cost), 'Kimi 价格要走环境变量');
  // 定价必须是**查到的那个**($3 / $15,缓存命中 $0.30),不许被改成别的数。
  //
  // 上一版这里钉的是「不许有任何非零数字」——那是「还没有出处」时对的做法。
  // 现在有出处了,钉的就变成具体的值:要改,得先拿出新的出处(比如官方调价、
  // 或者走第三方中转)。而那种情况本来就该走 env 覆盖,不必动代码。
  assert.ok(/const KIMI_LIST_PRICE: AiPrice = \{ input: 3, output: 15 \}/.test(cost), 'K3 官方价 $3 / $15');
  assert.ok(/const KIMI_CACHE_READ = 0\.3;/.test(cost), '缓存命中有明码 $0.30,不该再用 input×0.1 近似');

  // 行为层:真调一遍,别只搜源码(上一版就栽在这 —— 在那行 if 前面插一句
  // `return true;` 能让函数恒真而原文还在,照样绿)。
  const js = ts.transpileModule(cost, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}),
    process: { env: {} },
    console, Object, Array, String, Number, Math, JSON, Boolean, RegExp,
  });
  const { priceKnown, priceFor, estimateCostUsd } = mod.exports;

  // ⚠️ 跨 vm context 不能用 deepEqual —— 对象来自另一个 realm,原型不同,必然不等
  //(仓里记过这一条,我又踩了一次)。比字段或 JSON.stringify。
  assert.equal(JSON.stringify(priceFor('kimi', 'kimi-k3')), JSON.stringify({ input: 3, output: 15 }), '默认就是官方价');
  assert.equal(
    JSON.stringify(priceFor('kimi', 'kimi-k3')), JSON.stringify(priceFor('kimi', '任何型号')),
    'Kimi 目前只有一档价,不按型号分表 —— 分了就得有出处',
  );
  assert.equal(priceKnown('kimi', {}), true, '有出处之后,价格就是「知道」的');
  assert.equal(priceKnown('gemini', {}), true);

  // 缓存命中走明码 $0.30,而不是 Claude 那套 input×0.1 的近似。
  //
  // 官方价下这两者**巧合相等**($3×0.1 = $0.30)—— 所以按默认价验等于没验。
  // 必须用一个让两者分开的价来验:把输入价覆盖成 $10,近似法会算出 $1.00,
  // 明码法仍是 $0.30。这条要是写成默认价,改回近似法它照样绿。
  const cached = estimateCostUsd('kimi', 'kimi-k3', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
  assert.equal(Number(cached.toFixed(4)), 0.3, '一百万缓存命中 token = $0.30');
  assert.ok(
    /provider === 'kimi' \? KIMI_CACHE_READ : p\.input \* 0\.1/.test(cost),
    '缓存命中必须走 Kimi 的明码,不是 input×0.1 —— 官方价下两者巧合相等,'
    + '哪天调价就会悄悄错开,而没人看得出来',
  );
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

console.log('kimi-provider: OK(主+托底顺序 / 默认值有出处 / reasoning_effort 压着 / 定价与缓存明码 / 别名两处同步 / 两条调用路径都接上)');
