# 设计规范 v1 落地 · 遗留清单(design debt)

> 用户 2026-07-12 授权:按设计规范一次改完,中间不停,看最终成品;遇到拿不准
> 或需要更大改动的先记在这里,最后一期统一解决。逐页对齐时随手登记。

## 待最后一期解决

- [ ] **今天页 · 置顶卡上轨(批次 109 写了 CSS 但未验证)**:PinnedAttentionCard 给了 margin-left:30px
  + 左侧实心 accent 圆点(::before)让它坐上竖轨,但**本地无日历事件、没法实测**(pinned 卡来自
  Google Calendar 同步,不是 life-graph 节点,种不出来)。等有日历数据的真机验证圆点对齐 + 缩进
  是否 OK;若偏了微调 left/top/margin。

- [x] **回顾卡(去年今日)—— 批次 105 已做**。用户定案「整年整月纪念日优先」:周年(同月同日
  ±3,≥1 年)>月纪念(同 day-of-month ±3,≥3 月)>兜底(一年前这一周 ±7);带心情/照片/地点/
  旅行的加权;没有符合的不渲染。lib/portal/retrospect.ts 纯函数 + RetrospectCard 自读 life-graph,
  放问候下面,点开复用 MemoryNodeDetail。实测(种 2025-07-12 记忆)「去年今天」正确翻出、
  衬线卡片、玫瑰色、点开进详情。
- [x] **今天页时间线 + 心情第一拍 + 接下来(批次 107,用户「直接做」)**:今日焦点→「接下来·
  今天要紧的几件」;MoodBeat 组件读今天最近心情作时间线「现在/今天」第一拍(能量→色调,
  点开进洞察趋势;没记则邀请),竖轨连线串起下面的要紧事。**踩坑**:MoodBeat 原放
  components/portal/today/ 触发 platform-leak(today 面不许直接 import life-graph,要走
  TodayViewModel)——移到 components/portal/(同 RetrospectCard)即可直连。**预览种记忆**:
  要同时写 localStorage['nesio-life-graph-v1'] **和** IDB nesio-blobs/blobs/同键(hydration
  权威源,IDB 有数据就压 localStorage;只种 localStorage 会被异步水合清掉)。
- [x] **夜间皮肤不跟色卡(批次 104 已做)**。核实发现比想的更严重:夜间+皮肤是**半亮崩坏**
  (日间浅底 token 漏进夜间)——因日间色卡块没做主题隔离,同特异性下靠后覆盖了夜间深底。
  修:①日间色卡 4 块全加 `:not([data-portal-theme="night"])` 隔离;②加 4 组
  `html[data-portal-theme="night"][data-palette="X"]`(含 `.portal-root` 后代,**关键**:app 在
  .portal-root 里、它自带整套 token,只改 html 不够)覆写夜间强调色系;③夜间硬编码
  `#96c7f3`/`rgba(88,140,227)` 用法全换 token(定义不动)。实测夜间+灰粉:深底玫瑰,活动态
  「今天」也变玫瑰,无蓝离群。
- [ ] **紫色 AI 头像渐变**:`.portal-ai-bot-avatar`(#5867f5→#7d54ee)、
  `.portal-ai-video-avatar`(#5867f5→#f39a2e)是独立紫/橙强调色,不是品牌蓝离群。
  要不要一并收进皮肤 token,待定(可能是有意的区分色)。
- [ ] **各页衬线嗓音**:记忆/洞察/多面镜/足迹的情感性标题可考虑上衬线(念念口吻),
  结构性标题保持无衬线。逐页主观精修,留最后一期整体看。
- [ ] **Foursquare 精度**:批次 101 已加诊断,等用户读诊断确认 key 状态(可能是加错
  Vercel 项目 / 旧版 v3 key)。非代码问题的话记这里。

## 记忆页记忆罐(批次 110 起)

- [x] **批次 110 · 记忆罐 hero**:记忆页顶部三颗水晶球(白珍珠核 + 皮肤色光晕)——
  收藏夹(pinned)/ 项目(active projects)/ 全部记忆(total)。用户定「现有数据映射」,
  「核心记忆」概念暂不做(数据里只有一级 pin)。CSS `.nesio-mem-jar*`,halo 走
  --portal-accent/--status-go/--status-gentle。点:收藏夹→展开收藏、项目→开/滚项目、全部→聚焦搜索。
- [x] **批次 113**:收纳区对齐 mockup —— 独立「收纳」段 + 横条卡(空间/未归位/件数/估值,inventoryStats)。
- [x] **批次 114**:核心记忆 —— pins.ts 加平行 core store(loadCore/isCore/toggleCore/CORE_UPDATED_EVENT);
  长按记忆卡加「标为核心记忆」;记忆罐改 核心记忆(amber·定义你)/收藏夹/项目,点核心球展开核心记忆;
  全部记忆挪到下方区块。实测标核心 → 球计数 0→1 响应。

## 已解决(逐页登记)

- [x] **批次 100**:今天页问候升衬线显示嗓音 + 区块标注收紧 + FAB 中心水晶球随皮肤。
- [x] **批次 102**:logo 水晶立方体随皮肤(NesioMark 内联 SVG,token 驱动,替换全站 img)。
- [x] **批次 102**:引导页 logo 底托 `.nesio-ob-logo-wrap` 硬编码蓝 → token 渐变。
- [x] **批次 104**:夜间皮肤跟色卡 —— 日间块主题隔离 + 4 组夜间色卡 token(含 .portal-root)
  + 夜间硬编码蓝(#96c7f3/rgba88,140,227)全 token 化。夜间半亮崩坏根治。
- [x] **批次 105**:今天页回顾卡(去年今日)—— retrospect.ts + RetrospectCard,周年/月纪念优先。
- [x] **批次 106**:夜间深底带皮肤色温(用户提供灰粉·夜 mockup)—— 每套夜版给暖/冷深底 +
  暖白字 + 皮肤色 line/sheet/zone;根因修:`html[data-portal-theme="night"] .portal-root`
  此前**硬编码冷蓝直接背景**(特异性高过 token 背景),改用 `var(--portal-bg-gradient)`,
  否则夜间选皮肤底色永远冷蓝。proactive 卡硬编码冷蓝 → 中性玻璃 + 皮肤边。实测灰粉/灰绿
  夜各自暖玫瑰/灰绿深底,零蓝离群。
