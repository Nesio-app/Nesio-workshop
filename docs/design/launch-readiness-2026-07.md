# 上线就绪度路线图 · 2026-07

给在修的 agent 当地图。评级**看当前代码**得出(不背审计记忆),本 session 已核过的以 ✅/⚠️ 标注。

## 评分表(当前代码)

| 维度 | 评级 | 现状 |
|---|---|---|
| 能不能跑(build/deploy) | 🟢 | 构建通过;Vercel auto-deploy **确认正常**(截图核实,非"没部署")。 |
| 数据完整性 | 🔴 | 读路径未切(`create-signal.ts` 双存储)· signal 云镜像 fire-and-forget 无 outbox · 冲突裸 last-write-wins(多设备静默丢数据)。健康/财务 app 的硬伤。 |
| 安全 / 隐私 | 🟠 | 基线稳(OAuth CSRF/SSRF、核心表 RLS、analyst 表 RLS 已修在 main);**隐私审计(健康+财务+PII、导出/删除完整性)已做一轮**(记忆照片导出/删除缺口已修);Notion 撤销缺(S2)。 |
| 可靠性 / 可观测 | 🔴→🟠 | 静默失败仍多(遍地 `catch{}` 无日志);日报"故障说成平稳"**已修**(analyst sourcesOk)。 |
| 产品 / UX | 🟠 | i18n 真接;aria-modal 无焦点陷阱;onboarding 要连多源(留存风险)。 |
| 测试真实度 | 🔴 | ~154 测试多在验契约/schema,行为覆盖薄;green 不完全可信。 |
| 变现 | 🟡 | 成本模型健康(默认 Haiku + L0 token 核算已接);**无付费/计费系统**、定价未定。 |

## 本 session 已清 / 已纠正

- ✅ **功能开关做真(A)**:关掉的域(places/finance/fitness/health)不再进事实库 → 停止参与跨区/洞察/引导计算(不再只藏 UI)。见 `lib/platform/fact-journal/index.ts`。
- ✅ **B1 analyst 两修**(静默失败 + 表 RLS)**已在 main**(重构时搬进 `lib/portal/learning/analyst-runtime.ts` + `docs/governance/analyst-schema.sql`)。部署即生效。
- ✅ **B2 纠正**:assessment 说"module-data-network 15 表 0 RLS、anon 可读写"—— **不成立**。`database/schema/module-data-network-v1.sql` 头明写「local SQLite」,代码里**无任何 Supabase/rest 访问这些表**。它们是本机 dev/治理注册表,anon 够不着,**无 RLS 缺口**。
- ✅ 隐私审计一轮(健康/财务/位置数据流、导出/删除完整性、PII→AI 围栏)—— 见 `docs/design/privacy-audit-2026-07.md`。
- ✅ 部署认知纠正:Vercel auto-deploy 正常;线上"还是旧的"多因 **PWA SW 缓存** + 修复落在更晚提交。

## 软上线 checklist(<50 信任用户 · 单设备 · 标 beta)· 天到周级

- [x] analyst 两修在 main(部署即生效)
- [x] module-data-network RLS —— 确认无生产表(local SQLite)
- [ ] **B3 关键路径可观测**:财务合并 / 删除 / 云同步 / 日报 的 `catch{}` 加日志(把"瞎着运营"变可 grep)。
- [ ] PWA SW 版本随构建变(现 VERSION 硬编码),让部署即时到用户
- [ ] onboarding 空态可用(不连任何源也有价值)
- [ ] 明确 beta 标 + 单设备提示

## 公开多用户上线 · 四大红项(2-4 个月,互相关联)

1. **数据完整性三件套**:读路径切到事实库 + signal 接 outbox(离线事实最终进云)+ 冲突从裸 LWW 升到带版本合并/冲突标记。
2. **RLS 全覆盖 + 隐私收尾**:核心云表已 RLS;补 Notion 撤销(S2)、复核所有云表。
3. **静默失败 → 可观测**:关键路径加日志 + 诚实降级(别再"故障=平稳")。
4. **关键路径行为测试**:覆盖①②③,让 green 可信。
外加:付费墙/计费从零建 + 定价定案。

## 依赖顺序

软上线(B3 + SW + onboarding 空态)→ 拉 20-50 人内测验留存 → 并行推四大红项 → 数据完整性接线完再开公开多用户(健康+财务静默丢数据是致命口碑事件,必须先接线)。

## 一句话诊断

贯穿所有审计的共性:**"声明齐全但运行时没接线"** —— 契约、aria、RLS 声明、fallback 都写了,就差最后一根线。上线就绪 ≠ 做新功能,= **把关键路径那根线接上**(读路径、outbox、冲突、日志、行为测试)。
