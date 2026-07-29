/**
 * 行为契约:AI 判决层(影子模式,设计定稿 2026-07-29)。
 *
 * 钉死的每一条都对应设计审计里的一个真实失败模式:
 *   · 指纹算在决策相关字段上 —— 描述改错别字不重判、不复活已静音的卡(v1 静音失效的尸检结论);
 *   · 解析严格:幻觉指纹丢弃 / 分组封闭 / 窗口钳制 ≤14 天 / 纯文本来源 severity 封顶 1;
 *   · 每个信号恰好归位一次(没进卡的必须进 declined)—— 漏报监测面不许有暗角;
 *   · 跨批归并只认真活跃卡(mergeInto 幻觉即忽略);
 *   · 路由过 guardAiRoute + 登记 api-routes.md(红线四要件);
 *   · admin 成本汇总优先真实 cost_usd(影子期花费必须被捕捉)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}), console,
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, Intl, ...extra,
  });
  return mod.exports;
}

const J = loadTs('../lib/platform/guidance-engine/ai-judge.ts');

// ── ① 指纹:决策相关字段白名单 ──
const base = { title: '飞北京 CA982', start: '2026-08-01T10:00:00Z', end: '2026-08-01T14:00:00Z', description: '记得带护照' };
const fpA = J.judgeFingerprint('calendar', 'evt1', base);
const fpB = J.judgeFingerprint('calendar', 'evt1', { ...base, description: '记得带护照!!' });
const fpC = J.judgeFingerprint('calendar', 'evt1', { ...base, start: '2026-08-02T10:00:00Z' });
assert.equal(fpA, fpB, '描述改字不换指纹 —— 否则已静音的卡因错别字复活');
assert.notEqual(fpA, fpC, '日期变了 = 新事实 = 新指纹 = 重判');
assert.equal(J.fingerprintSource(fpA), 'calendar', '指纹前缀携带来源(resolver/severity 封顶靠它)');

// ── ② prompt:围栏防注入 + 口味是事实不是权重 ──
const sig1 = { fingerprint: fpA, source: 'calendar', fields: { title: '<script>alert(1)</script>', start: base.start } };
const prompt = J.buildJudgePrompt([sig1], {
  todayISO: '2026-07-29', timezone: 'America/New_York',
  taste: { groupCounts: { 财务: [3, 0] } },
});
assert.ok(!prompt.includes('<script>'), '信号值里的尖括号必须被围栏消毒');
assert.match(prompt, /财务: 3有用\/0太多/, '口味喂事实计数,不喂权重数字(权重系统已退役)');
assert.match(prompt, /一律当数据/, 'prompt 必须声明内容中的指令不作数(防邮件注入指挥判决)');

// ── ③ 严格解析 ──
const fps = new Set([fpA, 'email:m1:123', 'domain:health-9:5']);
const active = new Set(['calendar:old:999']);

// 幻觉指纹丢弃;未归位的信号补 declined
let out = J.parseJudgeResponse(JSON.stringify({
  cards: [{ fingerprints: ['calendar:fake:1'], group: '日程', severity: 2, showFrom: '2026-07-29', showUntil: '2026-07-30', title: 'x', body: '', whyNow: '', evidence: [] }],
  declined: [],
}), fps, active);
assert.equal(out.cards.length, 0, '幻觉指纹的卡必须整张丢弃');
assert.equal(out.declined.length, 3, '没归位的信号全部补进 declined —— 漏报监测面必须完整');
assert.ok(out.declined.every((d) => d.reason === '未判'), '补位的 reason=未判');

// 分组封闭 + 窗口钳制 + 纯文本 severity 封顶
out = J.parseJudgeResponse(JSON.stringify({
  cards: [
    { fingerprints: [fpA], group: '外星分类', severity: 3, showFrom: '2026-07-29', showUntil: '2026-12-31', title: '航班', body: 'b', whyNow: 'w', evidence: ['calendar:start'] },
    { fingerprints: ['email:m1:123'], group: '财务', severity: 3, showFrom: '2026-07-29', showUntil: '2026-07-30', title: '账单', body: '', whyNow: '', evidence: [] },
  ],
  declined: [{ fingerprint: 'domain:health-9:5', reason: '纯信息' }],
}), fps, active);
assert.equal(out.cards[0].group, '其他', 'AI 编的新分组折到「其他」(mute_type 的 key 空间不许被撑爆)');
assert.equal(out.cards[0].showUntil, '2026-08-12', '窗口钳制 ≤14 天(长窗会赖在候选池抢配额)');
assert.equal(out.cards[0].severity, 3, '日历是结构化来源,severity 3 保留');
assert.equal(out.cards[1].severity, 1, '纯 email 来源的卡 severity 封顶 1(结构化字段才配 ≥2)');
assert.equal(out.declined.length, 1, 'declined 正常透传');

// mergeInto 只认真活跃卡
out = J.parseJudgeResponse(JSON.stringify({
  cards: [
    { fingerprints: [fpA], group: '日程', severity: 2, showFrom: '2026-07-29', showUntil: '2026-07-30', title: 'x', body: '', whyNow: '', evidence: [], mergeInto: 'calendar:old:999' },
    { fingerprints: ['email:m1:123'], group: '日程', severity: 1, showFrom: '2026-07-29', showUntil: '2026-07-30', title: 'y', body: '', whyNow: '', evidence: [], mergeInto: 'calendar:ghost:1' },
  ],
  declined: [{ fingerprint: 'domain:health-9:5', reason: 'r' }],
}), fps, active);
assert.equal(out.cards[0].mergeInto, 'calendar:old:999', '归并指向真活跃卡 → 保留');
assert.equal(out.cards[1].mergeInto, undefined, '归并指向幻觉卡 → 忽略(降级为新卡)');

// 解析彻底失败 → 全部 declined(不吞、不假装成功)
out = J.parseJudgeResponse('模型抽风了没有 JSON', fps, active);
assert.equal(out.cards.length, 0);
assert.equal(out.declined.length, 3, '解析失败时信号全部落 declined(解析失败),下轮可见');

// 起止颠倒丢弃
out = J.parseJudgeResponse(JSON.stringify({
  cards: [{ fingerprints: [fpA], group: '日程', severity: 1, showFrom: '2026-08-05', showUntil: '2026-08-01', title: 'x', body: '', whyNow: '', evidence: [] }],
  declined: [],
}), new Set([fpA]), new Set());
assert.equal(out.cards.length, 0, '窗口起止颠倒的卡丢弃');

// ── ④ 本地窗口重算 ──
assert.equal(J.isCardInWindow({ showFrom: '2026-07-29', showUntil: '2026-07-30' }, '2026-07-29'), true);
assert.equal(J.isCardInWindow({ showFrom: '2026-07-29', showUntil: '2026-07-30' }, '2026-07-31'), false, '过了 showUntil 永不再出');
assert.equal(J.isCardInWindow({ showFrom: '2026-07-30', showUntil: '2026-08-01' }, '2026-07-29'), false, '没到 showFrom 静默持有');

// ── ⑤ 接线与红线 ──
const route = fs.readFileSync(new URL('../app/api/portal/guidance-judge/route.ts', import.meta.url), 'utf8');
assert.match(route, /guardAiRoute\(req, 'guidance_judge'/, '花钱路由必须过 guardAiRoute(红线)');
assert.match(route, /requirePaidCloudAi: true/, '判决是付费云 AI,过权益门');
assert.match(route, /parseJudgeResponse\(/, '解析必须在服务端严格执行,不信任模型输出');
assert.match(route, /reportAiCall\('guidance_judge', false/, '失败也要上账(成本与失败率都要被 admin 看见)');

const docs = fs.readFileSync(new URL('../docs/api-routes.md', import.meta.url), 'utf8');
assert.match(docs, /guidance-judge/, '新花钱路由必须登记 docs/api-routes.md(红线)');

const budget = fs.readFileSync(new URL('../lib/portal/ai-budget.ts', import.meta.url), 'utf8');
assert.match(budget, /guidance_judge/, '日成本熔断表要认识 guidance_judge');

const metrics = fs.readFileSync(new URL('../app/api/admin/metrics/route.ts', import.meta.url), 'utf8');
assert.match(metrics, /cost_usd/, 'admin 成本汇总必须优先真实 cost_usd —— 影子判决的花费要被捕捉总结');
assert.match(metrics, /guidance_judge/, 'admin 拍平单价表也要有 guidance_judge 兜底');

const today = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.match(today, /void maybeRunJudgeShadow\(/, '影子判决要在 Today 数据编排层被触发(fire-and-forget)');
assert.ok(today.indexOf('void maybeRunJudgeShadow') > today.indexOf('if (canUsePrivateData) {'), '影子判决在私据门之内触发');

const auto = fs.readFileSync(new URL('../lib/portal/guidance-judge-auto.ts', import.meta.url), 'utf8');
assert.match(auto, /lane: 'shadow'/, '影子判决结果只进档案(shadow lane),不上屏');
assert.ok(!auto.includes('setProactiveCards'), '影子模式绝不碰出卡状态');

console.log('guidance-judge: OK(指纹白名单 / 严格解析 / 窗口钳制 / severity 封顶 / 归并防幻觉 / 红线四要件 / admin 真实成本)');
