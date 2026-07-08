/**
 * 治理地图 —— 让治理「可见、可信」的单一数据源。
 *
 * 背景:lib/portal 里有一整层治理/契约文件(module registry、data-bus、entitlements、
 * security-incident、cloud-readiness…),它们大多被 `report:modules` 聚合成一个 JSON,
 * 但从没在任何界面上给人看过。结果是「算了却没人读」——治理不可见。
 *
 * 这个文件把每一个治理面登记成一条 { status, path, governs, consumedBy },
 * GitBook 文档(scripts/gen-governance-docs.mjs)和后台 admin 治理面板都读它,
 * 一份来源、两个界面。scripts/governance-map.test.mjs 断言状态与真实 import 一致,
 * 所以状态不会偷偷漂移 —— 这是「可信」的保证。
 *
 * 状态词汇(status):
 *  - enforced    运行时真的强制执行(路由真拦 / Shell 真渲染 / 门禁真挡)。删了 app 会坏。
 *  - report-only 只被 `report:modules` 聚合,产出了数据但没有任何 UI 消费。治理「可见性」缺口就在这。
 *  - dormant     休眠种子:为将来的软件治理 / 经济控制预留,尚未接线。留着是对的,但要诚实标注。
 *  - drifted     契约与运行时不一致(契约说一套、代码做另一套)。负价值,给人假约束的错觉,需处理。
 *  - dead        接了但零消费的死代码(如接了 route 但没有任何前端 fetch)。可净删。
 */

/** @typedef {'enforced'|'report-only'|'dormant'|'drifted'|'dead'} GovStatus */

export const GOV_STATUS_META = Object.freeze({
  enforced:      { label: '已强制执行', tone: 'go',     desc: '运行时真的拦/渲染/门禁,删了 app 会坏' },
  'report-only': { label: '仅报告聚合', tone: 'gentle', desc: '已进 report:modules,但没有任何 UI 消费(可见性缺口)' },
  dormant:       { label: '休眠种子',   tone: 'gentle', desc: '为未来治理/经济控制预留,尚未接线' },
  drifted:       { label: '契约漂移',   tone: 'risk',   desc: '契约与运行时不一致,给人假约束错觉,需处理' },
  dead:          { label: '死代码',     tone: 'risk',   desc: '接了但零消费,可净删' },
});

export const GOV_GROUP_META = Object.freeze({
  'runtime':  { title: '运行时强制层', blurb: '真正在保护你/驱动 UI 的治理,现在就在跑。' },
  'shell':    { title: 'Shell 与模块注册', blurb: '决定用户能看到/打开哪些模块。' },
  'data':     { title: '模块数据总线', blurb: '模块之间的数据归属与连接关系(当前为契约/元数据层)。' },
  'economic': { title: '经济控制', blurb: 'AI 成本、付费/权益、发布 SKU —— 商业化与用量控制的种子与现状。' },
  'safety':   { title: '安全与就绪', blurb: '安全事件、云就绪、生产激活、独立上架的就绪度报告。' },
  'lifecycle':{ title: '生命周期与合规', blurb: '权限同意、数据版本、身份升级、离线冲突等契约。' },
  'external': { title: '外部桥接', blurb: '第三方/独立模块的接入契约 —— 若走 ADE/interop 方向,种子在这。' },
});

/**
 * 每条治理面。path 相对仓库根;reportKey 指它在 `report:modules` 输出 JSON 里的顶层键。
 * @type {Array<{id:string,title:string,group:keyof typeof GOV_GROUP_META,status:GovStatus,
 *   path:string,route?:string,reportKey?:string,governs:string,consumedBy:string,note?:string}>}
 */
export const GOVERNANCE_MAP = [
  // ---- 运行时强制层(enforced)----
  { id: 'admin-gate', title: '管理员门禁', group: 'runtime', status: 'enforced',
    path: 'lib/portal/admin-gate.ts', governs: '/api/admin/* 的同源+密钥+限流',
    consumedBy: 'app/api/admin/*/route.ts' },
  { id: 'api-auth', title: 'API 鉴权原语', group: 'runtime', status: 'enforced',
    path: 'lib/portal/api-auth.ts', governs: 'safeEqual / 限流 / 同源 / clientIp',
    consumedBy: 'admin-gate + 多个 AI/portal 路由' },
  { id: 'dec-access-boundary', title: 'DEC 访问边界', group: 'runtime', status: 'enforced',
    path: 'lib/portal/dec-access-boundary.ts', governs: '洞察卡 DEC 数据的分类访问边界',
    consumedBy: '2 个 app 路由' },
  { id: 'app-api-contract', title: 'App API 契约 v0', group: 'runtime', status: 'enforced',
    path: 'lib/portal/app-api-contract-v0.mjs', governs: 'app 与本地数据的 API 面',
    consumedBy: '5 个 app 路由' },
  { id: 'dec-data-api', title: 'DEC 数据 API', group: 'runtime', status: 'enforced',
    path: 'lib/portal/dec-data-api.mjs', route: 'app/api/data/v1/dec/[category]/route.ts',
    governs: '洞察卡按领域取数', consumedBy: 'dec/[category] 路由(真数据)' },

  // ---- Shell 与模块注册 ----
  { id: 'module-manifest', title: 'Shell 模块清单', group: 'shell', status: 'enforced',
    path: 'lib/portal/module-manifest.ts', governs: 'buildPortalShellManifest → Shell 工具/分区渲染',
    consumedBy: 'components/portal/Portal.tsx', note: 'Portal 只消费 .tools/zones 这一片' },
  { id: 'module-manager', title: '模块注册表(聚合)', group: 'shell', status: 'report-only', reportKey: 'summary',
    path: 'lib/portal/module-manager.ts', governs: '汇总 gate/artifact/entitlement 等字段',
    consumedBy: 'report:modules(tools 路径外的字段无 UI 消费)' },
  { id: 'tool-manifest', title: '工具清单 v0', group: 'shell', status: 'report-only', reportKey: 'toolManifest',
    path: 'lib/portal/tool-manifest-v0.mjs', governs: '每工具的领域/能力/可见性', consumedBy: 'module-manager-core → report' },
  { id: 'domain-capability', title: '领域能力分类', group: 'shell', status: 'report-only', reportKey: 'domainCapabilityRegistry',
    path: 'lib/portal/domain-capability-taxonomy-v1.mjs', governs: '领域×能力口径', consumedBy: 'tool-manifest + governance-resolver' },

  // ---- 模块数据总线 ----
  { id: 'module-data-bus', title: '模块数据总线', group: 'data', status: 'report-only', reportKey: 'moduleDataBus',
    path: 'lib/portal/module-data-bus.mjs', governs: 'data-key 归属 + 模块间连接图',
    consumedBy: 'report:modules', note: 'boundaries 自声明 writesRealData:false —— 是元数据校验,非运行时消息总线' },
  { id: 'module-data-network-db', title: '数据网络 DB', group: 'data', status: 'dead', reportKey: 'moduleDataBus',
    path: 'lib/portal/module-data-network-db.mjs', route: 'app/api/portal/module-data-network/route.ts',
    governs: '模块数据网络端点', consumedBy: '(无)', note: '该 route 无任何前端 fetch —— 死端点,可净删' },
  { id: 'local-data-records', title: '本地数据记录', group: 'data', status: 'report-only', reportKey: 'localDataRecords',
    path: 'lib/portal/local-data-records.mjs', governs: '本地数据看板包', consumedBy: 'module-manager(Portal 不读)' },

  // ---- 经济控制 ----
  { id: 'ai-cost', title: 'AI 成本报告', group: 'economic', status: 'enforced',
    path: 'scripts/report-ai-cost.mjs', governs: 'AI 调用估算成本/路由/成功率',
    consumedBy: 'app/admin(Metrics.ai)', note: '已在 admin 台可见 —— 经济控制里唯一已落地的一块' },
  { id: 'entitlements', title: '权益/付费', group: 'economic', status: 'dormant', reportKey: 'entitlements',
    path: 'lib/portal/(module-manager entitlements)', governs: '产品/套餐/模块权益',
    consumedBy: 'report:modules', note: '经济控制种子:付费/解锁尚未接运行时' },
  { id: 'launch-sku', title: '发布 SKU', group: 'economic', status: 'dormant', reportKey: 'launchSku',
    path: 'lib/portal/(launch-sku)', governs: '上架包含哪些模块 / App Store 就绪', consumedBy: 'report:modules' },

  // ---- 安全与就绪 ----
  { id: 'drift-guard', title: '注册表漂移守卫', group: 'safety', status: 'report-only', reportKey: 'registryDriftGuard',
    path: 'lib/portal/(registry drift guard)', governs: '模块元数据缺失/漂移告警', consumedBy: 'report:modules + report-drift.mjs' },

  // ---- 生命周期与合规 ----
  { id: 'permission-consent', title: '权限同意', group: 'lifecycle', status: 'report-only', reportKey: 'permissionConsent',
    path: 'lib/portal/(permission-consent)', governs: '权限/同意矩阵', consumedBy: 'report:modules' },
  { id: 'tool-data-versioning-2', title: 'Web 表面契约', group: 'lifecycle', status: 'report-only', reportKey: 'webSurfaceContract',
    path: 'lib/portal/web-surface-contract-v0.mjs', governs: 'Web 暴露面', consumedBy: 'report:modules' },
  { id: 'nesio-design-system', title: '设计系统契约', group: 'lifecycle', status: 'report-only', reportKey: 'nesioDesignSystem',
    path: 'lib/portal/nesio-design-system-contract.mjs', governs: '设计 token 契约', consumedBy: 'report:modules' },

  // ---- 外部桥接 ----
  { id: 'external-bridge', title: '外部模块桥接', group: 'external', status: 'dormant',
    path: 'lib/portal/external-bridge-contract.mjs', governs: '第三方模块(quiz/reading/health…)接入语义',
    consumedBy: 'dec-data-api', note: '当前=链接占位,notes 均「需 CEO Gate 后再接 API」;走 interop 方向的种子' },

  // ---- 漂移观察(drifted)----
  { id: 'ai-provider-router', title: 'AI 供应商路由契约', group: 'runtime', status: 'report-only', reportKey: 'aiProviderRouter',
    path: 'lib/portal/ai-provider-router-contract.mjs', governs: 'AI provider 选择/降级策略',
    consumedBy: 'report:modules + 测试(运行时 ai-complete.ts 不 import)',
    note: '漂移已消除(架构审查 #8):契约与 ai-complete.ts 共读 ai-provider-chain.mjs 单一回退链源' },
];

/** 按状态汇总计数,供 admin 面板/文档头部用。 */
export function summarizeGovernance(map = GOVERNANCE_MAP) {
  const byStatus = {};
  const byGroup = {};
  for (const e of map) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byGroup[e.group] = (byGroup[e.group] || 0) + 1;
  }
  return { total: map.length, byStatus, byGroup };
}
