/**
 * 生成治理 GitBook —— 从 lib/portal/governance-map.mjs(单一来源)+ 实时 `report:modules`
 * 数字,输出 docs/governance/*.md + docs/SUMMARY.md + docs/.gitbook.yaml。
 *
 * 用法:node scripts/gen-governance-docs.mjs   (幂等,可反复重跑;数字始终来自当下代码)
 * 后台 admin 治理面板读同一个 governance-map.mjs,所以书和面板永远一致。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOVERNANCE_MAP, GOV_STATUS_META, GOV_GROUP_META, summarizeGovernance,
} from '../lib/portal/governance-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs');
const GOV = join(OUT, 'governance');
mkdirSync(GOV, { recursive: true });

// ---- 实时数字:跑一次治理聚合报告 ----
let R = {};
try {
  R = JSON.parse(execSync('node scripts/report-module-registry.mjs', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString());
} catch (e) {
  console.error('report:modules 运行失败,文档将缺少实时数字:', e.message);
}
const sum = R.summary || {};
const bus = (R.moduleDataBus && R.moduleDataBus.summary) || {};
const gov = summarizeGovernance();

const badge = (status) => {
  const m = GOV_STATUS_META[status] || { label: status };
  const dot = { go: '🟢', gentle: '🟡', risk: '🔴' }[m.tone] || '⚪';
  return `${dot} ${m.label}`;
};
const w = (name, body) => {
  writeFileSync(join(GOV, name), body.trimStart() + '\n');
  console.log('  ✓ docs/governance/' + name);
};

// ---------- README(总览 + 图例 + 关键数字)----------
const statusRows = Object.entries(GOV_STATUS_META)
  .map(([k, m]) => `| ${badge(k)} | ${gov.byStatus[k] || 0} | ${m.desc} |`).join('\n');
w('README.md', `
# 治理总览

> 本书由 \`lib/portal/governance-map.mjs\` + \`report:modules\` 自动生成(\`node scripts/gen-governance-docs.mjs\`)。
> 数字来自当下代码,不是手写快照。后台 \`/admin\` 治理面板读同一份来源。

这一层回答一个问题:**软件里那些「治理/契约/就绪」文件,哪些真的在跑、哪些只是算了没人看、哪个已经和代码对不上了。**

## 一眼看健康度

| 指标 | 值 |
|---|---|
| 治理面总数 | **${gov.total}** |
| 模块数 | ${sum.moduleCount ?? '—'} |
| 就绪模块 | ${sum.readyModuleCount ?? '—'} / ${sum.moduleCount ?? '—'} |
| 外部链接模块 | ${sum.externalLinkCount ?? '—'} |
| 审批门契约 | ${sum.approvalGateContractCount ?? '—'} |
| 数据总线 data-key | ${bus.dataKeyCount ?? '—'}(已连接 ${bus.connectedDataKeyCount ?? '—'} · **孤立 ${bus.orphanedDataKeyCount ?? '—'}**) |
| 聚合报告状态 | \`${sum.status ?? '—'}\` |

## 状态图例

| 状态 | 数量 | 含义 |
|---|---|---|
${statusRows}

## 怎么读这本书

- [治理地图](status-map.md) —— 全部治理面一张表,按层分组,带状态。**先看这页。**
- [模块数据总线](data-bus.md) —— 模块之间的数据归属与连接(以及为什么 ${bus.orphanedDataKeyCount ?? '很多'} 个 data-key 是孤立的)。
- [经济控制](economic-control.md) —— AI 成本、权益、发布 SKU。
- [安全与就绪](safety-readiness.md) —— 安全事件、云、生产激活、独立上架。
- [契约漂移](drift.md) —— 契约说一套、代码做一套的地方(需要处理)。
`);

// ---------- 状态地图(分组表)----------
let mapBody = `
# 治理地图

每一行是一个治理面。**状态**列告诉你它是真在跑、只是报告、休眠种子、还是已漂移。
\`路径\`可点开看源文件;\`消费方\`是谁真的在读它。

`;
for (const [g, meta] of Object.entries(GOV_GROUP_META)) {
  const rows = GOVERNANCE_MAP.filter((e) => e.group === g);
  if (!rows.length) continue;
  mapBody += `\n## ${meta.title}\n\n_${meta.blurb}_\n\n`;
  mapBody += `| 治理面 | 状态 | 治理什么 | 消费方 |\n|---|---|---|---|\n`;
  for (const e of rows) {
    const note = e.note ? `<br/><sub>${e.note}</sub>` : '';
    mapBody += `| **${e.title}**<br/><sub>\`${e.path}\`</sub> | ${badge(e.status)} | ${e.governs}${note} | ${e.consumedBy} |\n`;
  }
}
w('status-map.md', mapBody);

// ---------- 模块数据总线 ----------
const edges = (R.moduleDataBus && R.moduleDataBus.edges) || [];
const edgeRows = edges.slice(0, 25)
  .map((x) => `| ${x.fromModuleId} | → | ${x.toModuleId} | \`${x.dataKey}\` | ${x.relation} | ${x.risk} |`).join('\n');
w('data-bus.md', `
# 模块数据总线

模块之间「谁产出、谁消费」哪些数据。**注意**:当前这层是**契约/元数据校验**(\`module-data-bus.mjs\` 自声明 \`writesRealData:false\`),
不是运行时消息总线 —— 它描述连接关系,不搬运真实数据。

## 数字

| 指标 | 值 | 说明 |
|---|---|---|
| 模块 | ${bus.moduleCount ?? '—'} | 参与数据网络的模块 |
| data-key | ${bus.dataKeyCount ?? '—'} | 声明的数据键总数 |
| 已连接 | ${bus.connectedDataKeyCount ?? '—'} | 有生产方↔消费方的键 |
| **孤立** | **${bus.orphanedDataKeyCount ?? '—'}** | 声明了但没接线的键 —— 空转量化 |
| 连接边 | ${bus.edgeCount ?? '—'} | 生产→消费 的边 |
| 告警 | ${bus.warningCount ?? '—'} | 缺依赖/越界告警 |

> ${bus.dataKeyCount && bus.orphanedDataKeyCount
    ? `${bus.orphanedDataKeyCount}/${bus.dataKeyCount} 个 data-key 是孤立的——说明数据网络画得比实际接线大得多。这不是 bug,是「契约先行」的正常状态;但它量化了「要瘦身/要接线」的空间。`
    : '（数据总线数字未取到)'}

## 连接边(前 25)

| 生产模块 | | 消费模块 | data-key | 关系 | 风险 |
|---|---|---|---|---|---|
${edgeRows || '| —— | | —— | —— | —— | —— |'}
`);

// ---------- 经济控制 ----------
const ent = (R.entitlements && R.entitlements.summary) || {};
const sku = (R.launchSku && R.launchSku.summary) || {};
w('economic-control.md', `
# 经济控制

商业化与用量控制。目前**唯一已落地进界面**的是 AI 成本——它已经在 \`/admin\` 面板上(\`Metrics.ai\`)。
其余(权益、SKU)是**休眠种子**:已建契约,尚未接运行时收费/解锁。

## AI 成本(已在 admin 可见)

- 来源:\`scripts/report-ai-cost.mjs\` → \`/api/admin/metrics\` → \`/admin\` 面板
- 指标:调用数、估算成本(USD)、成功率、平均延迟、按路由拆分
- 状态:${badge('enforced')} —— 经济控制里唯一真跑起来的一块

## 权益 / 付费(种子)

| 指标 | 值 |
|---|---|
| 产品 | ${ent.productCount ?? ent.products ?? '—'} |
| 套餐/bundle | ${ent.bundleCount ?? ent.bundles ?? '—'} |
| 模块权益 | ${ent.moduleEntitlementCount ?? '—'} |

状态:${badge('dormant')} —— 付费/解锁尚未接运行时。这是将来「经济控制」要接线的地方。

## 发布 SKU(种子)

| 指标 | 值 |
|---|---|
| SKU | \`${R.launchSku?.skuKey ?? '—'}\` |
| 包含模块 | ${(R.launchSku?.includedModuleIds || []).length || sku.includedModuleCount || '—'} |
| App Store 就绪 | ${R.launchSku?.launchSkuAppStoreReady ?? '—'} |

状态:${badge('dormant')}
`);

// ---------- 安全与就绪 ----------
const si = (R.securityIncidentReadiness && R.securityIncidentReadiness.summary) || {};
const cr = (R.cloudReadiness && R.cloudReadiness.summary) || {};
w('safety-readiness.md', `
# 安全与就绪

这些是**报告型**治理(${badge('report-only')}):已聚合进 \`report:modules\`,量化了就绪度,但还没在任何界面上给人看——
这本书 + admin 面板就是补上这个可见性缺口。

## 安全事件就绪

- 契约:\`lib/portal/security-incident-readiness-contract.mjs\`
- 事件类型:${(R.securityIncidentReadiness?.incidentTypes || []).length || '—'} · 严重度档:${(R.securityIncidentReadiness?.severityVocabulary || []).length || '—'}
- 告警:${(R.securityIncidentReadiness?.warnings || []).length ?? '—'}

## 云就绪

- 契约:\`lib/portal/cloud-readiness-contract.mjs\`
- provider 候选:${(R.cloudReadiness?.providerCandidates || []).length || '—'}
- 告警:${(R.cloudReadiness?.warnings || []).length ?? '—'}
- 默认运行时仍 local-first;云为「就绪度描述」,非已接线。

## 生产激活 / 独立上架

- \`production-activation-contract.mjs\` · \`standalone-app-readiness-contract.mjs\`
- 状态:${badge('report-only')} —— 就绪度报告,发布前用来核对。
`);

// ---------- 漂移 ----------
const drifted = GOVERNANCE_MAP.filter((e) => e.status === 'drifted');
const dead = GOVERNANCE_MAP.filter((e) => e.status === 'dead');
w('drift.md', `
# 契约漂移

**最该优先处理的一类。** 漂移 = 契约声明了一套规则,但运行时代码根本没按它做。
比「没有契约」更糟:它给人「有约束」的**错觉**。

## 漂移项(${drifted.length})

${drifted.length ? drifted.map((e) => `### ⚠ ${e.title}
- 契约:\`${e.path}\`
- 治理什么:${e.governs}
- 问题:${e.note || '契约与运行时不一致'}
- 处理:**对齐**(让运行时真按契约走,契约成 single source of truth)**或删**(消除假约束)。
`).join('\n') : '_当前无漂移项。_'}

## 死代码(${dead.length})

${dead.length ? dead.map((e) => `- **${e.title}** \`${e.path}\`${e.route ? ` + \`${e.route}\`` : ''} —— ${e.note || '零消费'}(${badge('dead')},可净删)`).join('\n') : '_无。_'}

## 已有的自动守卫

- \`scripts/report-drift.mjs\` —— 注册表元数据漂移检测(missingOwner/entry/status/evidence)
- \`registryDriftGuard\`(见 report:modules)—— 当前 warningCount:${R.registryDriftGuard?.summary?.warningCount ?? '—'}
`);

// ---------- SUMMARY + .gitbook.yaml ----------
writeFileSync(join(OUT, '.gitbook.yaml'), `root: ./
structure:
  summary: SUMMARY.md
`);
writeFileSync(join(OUT, 'SUMMARY.md'), `# 目录

## 治理(可见 · 可信)

* [治理总览](governance/README.md)
* [治理地图](governance/status-map.md)
* [模块数据总线](governance/data-bus.md)
* [经济控制](governance/economic-control.md)
* [安全与就绪](governance/safety-readiness.md)
* [契约漂移](governance/drift.md)

## 参考

* [算法说明](algorithms-explained.md)
* [API 路由与鉴权](api-routes.md)
`);
console.log('  ✓ docs/SUMMARY.md  ✓ docs/.gitbook.yaml');
console.log('治理 GitBook 生成完成。');
