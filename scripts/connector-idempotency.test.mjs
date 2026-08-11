/**
 * connector-idempotency — 「重复点同步不许堆记忆」的契约。
 *
 * 病根:`ingestLifeNode` 的去重键 `externalKey()` 只认三个字段
 * (emailId / notionPageId / externalId,见 lib/life-domain/ingest-node.ts)。
 * 任何连接器写节点时**不带这三个之一**,就等于没有幂等键 —— 每点一次同步整批重灌。
 * 微信读书(15 本书)和 Toggl(1+5 条汇总)就是这么漏的:它们各自带了 bookId /
 * 什么都没带,而 externalKey 不认。
 *
 * 这条契约钉两件事:
 *   ① 三个字段是唯一名单 —— 谁改了 externalKey,这里必须一起改(否则新键静默失效);
 *   ② 每条会往图里灌**多条**节点的同步路由,产物必须带其中之一。
 *
 * 顺带钉住 Notion 的云 AI 抽取分支不许回来:它一页抽多个实体,结构上拿不到幂等键,
 * 一旦配了 Gemini 就会成倍堆重复(旧注释自己承认「故仅兜底路径去重」)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── ① 去重键的名单就这三个,改了要同步改这里 ──────────────────────────────
{
  const ingest = strip(read('lib/life-domain/ingest-node.ts'));
  const start = ingest.indexOf('function externalKey');
  const after = ingest.slice(start);
  // 只切 externalKey 自身。后面的 prepareIngestInput 也读 attrs.*,
  // 切到 ingestLifeNode 会把 epistemic/generator 误当成去重键。
  const endRel = after.search(/\n(?:export )?function /);
  const fn = endRel > 0 ? after.slice(0, endRel) : after.slice(0, after.indexOf('export function ingestLifeNode'));
  for (const key of ['emailId', 'notionPageId', 'externalId']) {
    assert.ok(fn.includes(key), `externalKey 不再认 ${key} —— 依赖它的连接器会静默失去幂等`);
  }
  // 反向:别人加了新键却没在这里登记,下面的路由断言就形同虚设
  const recognized = [...new Set(fn.match(/attrs\.[a-zA-Z]+/g) || [])];
  assert.deepStrictEqual(recognized.sort(), ['attrs.emailId', 'attrs.externalId', 'attrs.notionPageId'],
    `externalKey 认的字段变了(${recognized.join(', ')})—— 更新本契约的名单,否则新键静默失效`);
}

// ── ② 批量灌节点的同步路由必须带幂等键 ────────────────────────────────────
const MUST_HAVE_KEY = [
  ['app/api/portal/weread/route.ts', /externalId: `weread:/, '微信读书:一本书一条,重同步应更新划线而不是再来 15 条'],
  ['app/api/portal/toggl/route.ts', /externalId: `toggl:weekly:/, 'Toggl 周汇总:同一天重同步应覆盖'],
  ['app/api/portal/toggl/route.ts', /externalId: `toggl:task:/, 'Toggl 任务行:同一天重同步应覆盖'],
  ['app/api/portal/notion/route.ts', /notionPageId: p\.id/, 'Notion:一页一条,带 pageId'],
];
for (const [file, re, why] of MUST_HAVE_KEY) {
  assert.ok(re.test(strip(read(file))), `${file} 缺幂等键 —— ${why}`);
}

// flomo / 日历各有自己的去重(slug / calendarId + 同批 dupKey),不走 externalKey,
// 但那两套必须还在 —— 否则它们也变成「每次全量重灌」。
{
  const sync = strip(read('lib/portal/providers/connector-sync.ts'));
  assert.ok(/existingSlugs/.test(sync), 'flomo 的 slug 去重没了 —— 会整批重灌');
  assert.ok(/seenThisRun/.test(sync), '日历的同批去重没了 —— 一次同步内同一场会重复落');
}

// ── ③ Notion 的云 AI 抽取分支不许回来 ─────────────────────────────────────
{
  const notion = strip(read('app/api/portal/notion/route.ts'));
  assert.ok(!/extractNodes|completeText|aiProviderAvailable/.test(notion),
    'Notion 路由又出现云 AI 抽取 —— 它一页产多个实体,拿不到幂等键,配了 key 就开始堆重复');
  assert.ok(/aiUsed: false/.test(notion), 'aiUsed 要诚实报 false(客户端据此显示「按页面存入」)');
}

// ── ④ 没验证过的接入收在「开发中」,不占主列表 ────────────────────────────
{
  const hub = read('components/portal/ConnectorsHub.tsx');
  const line = hub.split('\n').find((l) => /id: 'weread'/.test(l)) || '';
  assert.ok(/dev: true/.test(line),
    '微信读书自动同步靠非官方 cookie(几小时过期),没验证过就不该摆在主列表当承诺');
  assert.ok(/CONNECTORS\.filter\(\(c\) => !c\.dev\)/.test(hub), '主列表必须过滤 dev 项');
}

console.log('connector-idempotency: OK(去重键名单 / 4 条路由带键 / flomo·日历自有去重 / Notion 无云抽取 / 未验证接入收折叠)');
