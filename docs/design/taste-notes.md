# 品味旁注(taste-skill × Nesio DS)

> 读 [taste-skill](https://github.com/Leonxlnx/taste-skill) 的 anti-slop 纪律,**不推翻** `design-system/nesio/` 与 CLAUDE.md Apple/warm-coach 规则。
> 2026-07-27 吸收要点(短)。

## 设计读(本产品)

Reading this as: **个人实验 OS 的洞察/成长/财务/健康面**,受众是自己;气质偏 **calm coach / Apple-y 产品 UI**,不是落地页。

Dials(相对 taste-skill):`VARIANCE 4` · `MOTION 3` · `DENSITY 5`(产品面,非 marketing)。

## 必守(漏网检查清单)

1. **颜色**:只用 CSS 变量;禁 CLAUDE.md 废弃色表(`#8b5cf6` / `#3b82f6` / `#ef4444` / `#10b981` / `#f59e0b` / `#f0f4ff` 等)。
2. **文字层级**:标题 `var(--text-h*)` + ink;辅助 `var(--text-sm/xs)` + muted;启发句可用 serif。
3. **容器**:圆角 `radius-sm/md/xl`;间距 4px 网格 `space-*`;能去掉边框阴影就不做假卡片。
4. **状态三件套**:空态 / 加载 / 失败+重试 同口径(异步必有可见失败)。
5. **成长页例外**:允许启发叙事与派生内容;弱化积分/仪表盘感;主路径「今天教练带你看一件事」。

## 本轮已修

- Finance 月趋势:面积折线 + 柱对照 + 一句启发(非纯柱堆)
- Body Ledger:血糖折线加面积填充
- Growth:`ng-coach-lead` serif 引导句;疗愈隐藏 POINTS 文案
- LearningStatusPanel:去掉 ranker「学了 N 次」夸张展示
