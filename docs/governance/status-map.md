# 治理地图

每一行是一个治理面。**状态**列告诉你它是真在跑、只是报告、休眠种子、还是已漂移。
`路径`可点开看源文件;`消费方`是谁真的在读它。


## 运行时强制层

_真正在保护你/驱动 UI 的治理,现在就在跑。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **管理员门禁**<br/><sub>`lib/portal/admin-gate.ts`</sub> | 🟢 已强制执行 | /api/admin/* 的同源+密钥+限流 | app/api/admin/*/route.ts |
| **API 鉴权原语**<br/><sub>`lib/portal/api-auth.ts`</sub> | 🟢 已强制执行 | safeEqual / 限流 / 同源 / clientIp | admin-gate + 多个 AI/portal 路由 |
| **DEC 访问边界**<br/><sub>`lib/portal/dec-access-boundary.ts`</sub> | 🟢 已强制执行 | 洞察卡 DEC 数据的分类访问边界 | 2 个 app 路由 |
| **App API 契约 v0**<br/><sub>`lib/portal/app-api-contract-v0.mjs`</sub> | 🟢 已强制执行 | app 与本地数据的 API 面 | 5 个 app 路由 |
| **DEC 数据 API**<br/><sub>`lib/portal/dec-data-api.mjs`</sub> | 🟢 已强制执行 | 洞察卡按领域取数 | dec/[category] 路由(真数据) |
| **AI 供应商路由契约**<br/><sub>`lib/portal/ai-provider-router-contract.mjs`</sub> | 🟡 仅报告聚合 | AI provider 选择/降级策略<br/><sub>漂移已消除(架构审查 #8):契约与 ai-complete.ts 共读 ai-provider-chain.mjs 单一回退链源</sub> | report:modules + 测试(运行时 ai-complete.ts 不 import) |

## Shell 与模块注册

_决定用户能看到/打开哪些模块。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **Shell 模块清单**<br/><sub>`lib/portal/module-manifest.ts`</sub> | 🟢 已强制执行 | buildPortalShellManifest → Shell 工具/分区渲染<br/><sub>Portal 只消费 .tools/zones 这一片</sub> | components/portal/Portal.tsx |
| **模块注册表(聚合)**<br/><sub>`lib/portal/module-manager.ts`</sub> | 🟡 仅报告聚合 | 汇总 gate/artifact/entitlement 等字段 | report:modules(tools 路径外的字段无 UI 消费) |
| **工具清单 v0**<br/><sub>`lib/portal/tool-manifest-v0.mjs`</sub> | 🟡 仅报告聚合 | 每工具的领域/能力/可见性 | module-manager-core → report |
| **领域能力分类**<br/><sub>`lib/portal/domain-capability-taxonomy-v1.mjs`</sub> | 🟡 仅报告聚合 | 领域×能力口径 | tool-manifest + governance-resolver |

## 模块数据总线

_模块之间的数据归属与连接关系(当前为契约/元数据层)。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **模块数据总线**<br/><sub>`lib/portal/module-data-bus.mjs`</sub> | 🟡 仅报告聚合 | data-key 归属 + 模块间连接图<br/><sub>boundaries 自声明 writesRealData:false —— 是元数据校验,非运行时消息总线</sub> | report:modules |
| **数据网络 DB**<br/><sub>`lib/portal/module-data-network-db.mjs`</sub> | 🔴 死代码 | 模块数据网络端点<br/><sub>该 route 无任何前端 fetch —— 死端点,可净删</sub> | (无) |
| **本地数据记录**<br/><sub>`lib/portal/local-data-records.mjs`</sub> | 🟡 仅报告聚合 | 本地数据看板包 | module-manager(Portal 不读) |

## 经济控制

_AI 成本、付费/权益、发布 SKU —— 商业化与用量控制的种子与现状。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **AI 成本报告**<br/><sub>`scripts/report-ai-cost.mjs`</sub> | 🟢 已强制执行 | AI 调用估算成本/路由/成功率<br/><sub>已在 admin 台可见 —— 经济控制里唯一已落地的一块</sub> | app/admin(Metrics.ai) |
| **权益/付费**<br/><sub>`lib/portal/(module-manager entitlements)`</sub> | 🟡 休眠种子 | 产品/套餐/模块权益<br/><sub>经济控制种子:付费/解锁尚未接运行时</sub> | report:modules |
| **发布 SKU**<br/><sub>`lib/portal/(launch-sku)`</sub> | 🟡 休眠种子 | 上架包含哪些模块 / App Store 就绪 | report:modules |

## 安全与就绪

_安全事件、云就绪、生产激活、独立上架的就绪度报告。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **注册表漂移守卫**<br/><sub>`lib/portal/(registry drift guard)`</sub> | 🟡 仅报告聚合 | 模块元数据缺失/漂移告警 | report:modules + report-drift.mjs |

## 生命周期与合规

_权限同意、数据版本、身份升级、离线冲突等契约。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **权限同意**<br/><sub>`lib/portal/(permission-consent)`</sub> | 🟡 仅报告聚合 | 权限/同意矩阵 | report:modules |
| **Web 表面契约**<br/><sub>`lib/portal/web-surface-contract-v0.mjs`</sub> | 🟡 仅报告聚合 | Web 暴露面 | report:modules |
| **设计系统契约**<br/><sub>`lib/portal/nesio-design-system-contract.mjs`</sub> | 🟡 仅报告聚合 | 设计 token 契约 | report:modules |

## 外部桥接

_第三方/独立模块的接入契约 —— 若走 ADE/interop 方向,种子在这。_

| 治理面 | 状态 | 治理什么 | 消费方 |
|---|---|---|---|
| **外部模块桥接**<br/><sub>`lib/portal/external-bridge-contract.mjs`</sub> | 🟡 休眠种子 | 第三方模块(quiz/reading/health…)接入语义<br/><sub>当前=链接占位,notes 均「需 CEO Gate 后再接 API」;走 interop 方向的种子</sub> | dec-data-api |

