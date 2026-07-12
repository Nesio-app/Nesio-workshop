# 设计规范 v1 落地 · 遗留清单(design debt)

> 用户 2026-07-12 授权:按设计规范一次改完,中间不停,看最终成品;遇到拿不准
> 或需要更大改动的先记在这里,最后一期统一解决。逐页对齐时随手登记。

## 待最后一期解决

- [x] **今天页 · 置顶卡上轨 + 去白框(批次 117,用户「白色框去掉」)**:PinnedAttentionCard 从白卡
  彻底重构成时间线**裸节点** —— 复用 `.nesio-collapsed-row`/`.nesio-collapsed-dot--pinned`(实心
  accent 点、无 box-shadow 白环),「绝不能错过」变 accent 小旗(`.nesio-pinned-flag`)作 kicker 前缀,
  倒计时进 `.nesio-collapsed-sub`(进行中=暖橙 #f0a040)。与折叠区节点同构同轨,自动对齐(不再靠
  margin-left:30px + ::before)。**本地仍无日历事件、pinned 分支没实测**(来自 Google Calendar 同步,
  非 life-graph);等真机(用户有日历数据)确认圆点对齐 + 小旗/倒计时排版。旧 `.nesio-pinned-card*`
  CSS 成死代码(无害,留待清理)。
- [x] **今天页 · 时间线除心情最多 2 项 + 加号尾节点 + 实心点去白边(批次 117,用户三连反馈)**:
  ①CAP 从 4 改 `pinned ? 1 : 2`(心情 + 至多 2 要紧事,置顶算 1);②尾节点「稍后·还有 N 件」符号
  改虚线圈 + 号(`.nesio-tl-more-plus`);③所有节点圆点/复选圈/心情方块去掉 `box-shadow: 0 0 0 3px
  var(--portal-bg)` 白环 —— 竖轨(z-index:0)从节点(z-index:1,不透明底)背后穿过,是「线穿珠」不留
  白圈;④首项实心「现在」用 `:not(:has(.nesio-pinned-node))` 门控(有置顶卡时首折叠项应空心)。
  预览实测(haze-blue):心情波纹 → 空心复选圈×2 → 稍后+号,轨线连续、无白环、+ 号居中渲染。
- [x] **心情 12 色定稿 + 符号/标题跟随记录情绪 + 光韵质感(批次 119,用户「心情标志和显色随心情变、
  联动一致、低饱和有光韵」)**:①`--emotion-*` 12 色全换 design-spec.html 定稿(关键:平静 #74A98F 绿
  → #8FAAB0 蓝灰;满足/焦虑等整体降饱和)——情绪盘与首页第一拍同源 var,自动联动一致;②MoodBeat 重做:
  读 `attributes.emotion`(退而反查 emotionLabel)→ 注入 `--mood-c: var(--emotion-<id>)`,符号 + 标题词
  都染当天情绪色,标题 = 情绪词(染色)· 能量高/中/低;③心情方块按记忆球质感:哑光白核 radial + 情绪色
  柔光晕(box-shadow 光韵)+ 边缘一丝透色(非白边),暗色=白雾球 + 情绪色光晕;④已记/未记两态:未记
  邀请态淡紫 #9a90c8「此刻,你感觉——」,已记染情绪色。**踩坑**:(a)`--mood-c` 默认值别声明在符号本体上
  会盖掉从 button 内联继承的情绪色,改用各处 color-mix 的 fallback;(b)fallback 链 `emotionLabel ?? name`
  空串漏兜(?? 只兜 null),改 `||`,否则旧无情绪数据标题空;(c)hasEmotion 门控能量词,避免退回名(已含
  能量)时重复。预览实测(强制平静):符号+标题+光晕全平静蓝灰,标题「平静·能量中」不重复。
- [x] **今天页 · 心情符号单曲线 + 去白边(批次 118,用户「一道曲线,没有白边」)**:①MoodRipple 从
  双波纹改成规范 mood-node.html 权威的**单条情绪波纹**(path `M4 13c2 0 2.4-4 3.8-4s1.9 6 3.8 6
  2.4-8 3.8-8 1.9 5 3.8 5`,viewBox 0 0 24 24);②`.nesio-tl-dot--mood` 去掉发白描边(旧
  `color-mix(status 55%, transparent)` 在浅底泛白 = 白边)→ `border: none`,只留情绪色软底 + 波纹,
  竖轨从软底背后穿过不留白。预览实测:pathCount=1、borderWidth=0、单曲线软方块无白边。

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
- [x] **批次 120 · 记忆球按图 5(用户「记忆球用图 5 设计」)**:①三颗球此前是**空**渐变球(无符号)+
  旧 radial 把光晕色灌进球身(到 100% jar-halo)。改「白打底、色作晕」:球身哑光低饱和白(radial 到
  边缘只一丝透色),颜色只在后面一圈柔和光晕(box-shadow 光韵)+ 同色符号;②三球加符号:核心=星
  (IconStar)、收藏=书签(新增 IconBookmark)、项目=文件夹(IconFolder);③类别识别色取 12 色定稿语义色
  (星·金 emotion-joy / 书签·暗红 emotion-angry / 文件夹·绿 emotion-content),稳定不随皮肤;④暗色=白雾球
  + 一圈彩色光晕(深底衬更明显)。预览实测日/夜两版:白/白雾球 + 金/红/绿光晕 + 同色符号,对齐图 5。

## 卡片与来源(批次 121 起)

- [x] **批次 121 · 统一卡片模板「分类为主,来源为辅」**:记忆卡按 design-spec.html「卡片与来源」重构 ——
  ①**分类图标领头**(`.nesio-memory-card-lead`,辅助色 chip,置顶左)标明「这是什么」,分类为主
  (此前图标在右下、次要);②干净标题 + 一句话摘要不变;③**加回来源徽章**(`.nesio-memory-card-source`,
  右下中性 muted 小 chip)—— 批次 8 曾因「来源 chip 与类型图标重复」删掉,现在图标上移、来源下沉,
  重复问题解开,来源为辅落地;④**不确定标「待确认」**(`.nesio-memory-card-pending`,琥珀 chip,
  `confidence<0.6` 触发);⑤来源徽章只标外部来源(邮件/日历/拍照/Notion/Keep/语音/系统),manual
  自己记的不标(噪音)。sourceBadge/isNodeUncertain 纯函数。预览实测:图标领头 + 强制注入验证
  「邮件·待确认·今天」徽章样式(来源中性灰、待确认琥珀、时间靠右)。

- [x] **批次 122 · 卡片模板补齐(用户细化 4 图)**:批次 121 只做了图标+来源,细看设计还差三处 ——
  ①顶部**分类图标 + 分类名文字**(情绪/物品/承诺/事件…),不只图标(`.nesio-memory-card-cat` 图标+名一行;
  心情记录 health_state+feeling → 「情绪」而非「健康」,categoryLabelForCard);②来源徽章**带图标**
  (sourceMeta 返 {label, icon},6 种:▤手记/🎙语音/📷拍照/✉邮件/📅日历/📍位置(place 类)+ Notion/Keep);
  ③**手记(自己记的)也显示来源**——批次 121 为「减噪音」把 manual 藏了是**错的**,设计里「此刻·满足」
  就标「手记·今天16:40」,改成 6 种来源全显。预览实测:情绪/承诺/物品 分类名 + ▤手记 徽章 + 今天。
  **待续(设计还有)**:节点详情页富结构(关键信息 key-value / 原始记录折叠 / 相关记忆·同一商家)、
  命名对齐(特办/多面镜/足迹…)、标题 AI 归一化绝不甩邮件头。

- [x] **批次 123 · 记忆页删统计卡 + 项目挪进球(用户圈红 X)**:①**删「承诺/最近」统计数字卡**——
  memory-narrator.ts 的 buildCommitmentCard/buildActivityCard(title 承诺/最近、body=count)是设计明说要
  去掉的「统计格数字」,删掉;buildNarratorCards 只留 remember(念念叙事,非统计,用户没 X);顺手清死
  代码(DOMAIN_EN/topDomain/nodeDomain/relativeFutureLabel/now() 全删)。②**删「我的项目」独立 section**——
  项目挪进记忆罐「项目」球:点球 setProjOpen 内联展开(同核心/收藏球),展开区含项目卡 + 「+新建」入口
  (.nesio-mem-jar-create)。记忆页现为设计布局:搜索 → 记忆罐 3 球 → 收纳条 → 全部记忆。预览实测:
  统计卡消失、我的项目 header 无、项目球点击内联展开 + 新建按钮可见。

## 命名对齐 · 洞察/详情(批次 124-127)

- [x] **批次 124-126 · 卡片与来源全章落地**:详情页来源行(来自 {来源}·provider · 时间,带图标)+
  可信度统一(删「比较确定/可能相关」,只没把握标「待确认」)+ 阅读原文/回复显眼按钮排 + 关键信息段标 +
  原始记录·邮件原文折叠 + 标题永远干净(cleanTitleNoise 剥 `<邮件头>`/裸邮件地址/Re:Fwd: 前缀,
  在 displayNodeName 一处覆盖卡片+详情)。「07 卡片与来源」整章齐。
- [x] **批次 127 · 洞察页命名对齐**:洞察 tab「认知/Cognition」→「多面镜/Mirror」(设计命名;内容本就是
  MirrorLetterTab 五面镜信件体 老友/苏格拉底/荣格/盲区侦探/斯多葛);足迹英文 Footprints→Places;
  标题 Insight→Insights。契约只钉 livingError 类型不钉 label,安全。Lab·认知模型(内部)保留。

## 今天页时间线新规格(批次 128 起,用户「首页有些变动」)

新规格(mockup):所有节点同尺寸圆 26px,只靠符号 + 颜色分。节点系统:心情=波纹+环形能量、
关键=星(琥珀实心+绝不能错过)、定时=钟、折叠=…、记一笔=话筒(末尾常驻)。连线:实线=已入线、
虚线=记一笔草稿位。能量=环形量表(替文字,低30%/中58%/高88%)。

- [x] **批次 128 · 环形能量表 + 记一笔话筒节点**:①MoodBeat 情绪词后缀加 `EnergyRing`(弧长按能量
  高88%/中58%/低30%,色随情绪 --mood-c),**替掉「能量高/中/低」文字**;②FocusSection 时间线末尾加
  常驻 `.nesio-tl-capture`(虚线话筒圈 = 草稿位):点话筒→nesio-open-voice(说一句)、点文字→
  nesio-open-tell(打字),无输入框。预览实测:平静◯ 能量环 + 底部「点话筒说一句,或记一下…」。
- [x] **批次 129 · 节点符号系统 + 26px 统一圆**:所有时间线节点统一 26px 圆(rail 右移 13px、marker 左缘 0
  圆心 x13、margin 归 0),只靠符号 + 颜色分:心情=波纹(方块→圆)、关键=星(琥珀实心 IconStar)、
  定时=钟(IconClock,有具体时间的日历项)、纪念日=礼物(IconGift)、任务=复选圆圈、折叠=…(替 + 号)、
  记一笔=话筒。触控区/完成勾适配 26px。撤首项自动填 accent(会盖符号)。预览实测(奶茶皮肤日):
  波纹圆 + 复选圆×2 + …虚线圈 + 底部话筒圈,全 26px 连轨。**仍待**:虚线连线段到话筒草稿位(现只虚线圈)。
- [ ] **待续 · 任务 AI 细化重画(图2)**:克制清单(圆 checkbox、子步骤细线缩进、完成划掉)、「太难」
  递归再拆、语气温柔;去掉亮蓝大按钮和层层套框。

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
