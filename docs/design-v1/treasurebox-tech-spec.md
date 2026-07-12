# 宝盒 · AI 个性化引擎 · 技术规格文档

**版本**: v1.0 · **对应原型**: treasurebox-redesign.html v14 · **日期**: 2026-06-19

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────┐
│                   用户行为层                      │
│  点击 / 输入 / 心情记录 / 任务完成 / 停留时段     │
└──────────────────────┬──────────────────────────┘
                       │ 埋点事件流
                       ▼
┌─────────────────────────────────────────────────┐
│               数据采集服务                        │
│  被动采集（时段/频率）+ 主动采集（心情/记录）      │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│            用户模型分析引擎（后台）               │
│   行为模式识别 · 置信度评分 · 洞察生成            │
└──────────┬──────────────────────────┬───────────┘
           │                          │
           ▼                          ▼
   UserProfile API             Insights Queue API
   （定期全量更新）             （事件驱动推送）
           │                          │
           └─────────────┬────────────┘
                         ▼
┌─────────────────────────────────────────────────┐
│              前端个性化渲染层                     │
│  文案槽位填充 · 洞察卡片时机控制 · 反馈回收        │
└─────────────────────────────────────────────────┘
```

---

## 2. 核心数据结构

### 2.1 UserProfile

```typescript
interface UserProfile {
  userId: string;
  name: string;
  daysSinceStart: number;

  energyPattern: {
    low: DayOfWeek[];             // 能量低谷日，如 ['monday']
    high: DayOfWeek[];            // 能量高峰日，如 ['friday']
    peakHourRange: [number, number]; // 活跃时段，如 [22, 23]
  };

  moodTrend: 'rising' | 'stable' | 'recovering' | 'low';
  lastMoodColor: string;          // hex，来自 Plutchik 色盘
  moodHistory: MoodEntry[];       // 近 30 天

  prefersPace: 'fast' | 'slow';
  procrastinates: string[];       // 如 ['email', 'reports']
  recentFocus: string;

  dataHealth: {
    items: number;                // 0-100，各数据域覆盖度
    expenses: number;
    mood: number;
    relationships: number;
    health: number;
  };

  memories: MemoryCard[];
  profileVersion: number;
  lastUpdatedAt: string;          // ISO8601
}

type DayOfWeek = 'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
```

### 2.2 MemoryCard

```typescript
interface MemoryCard {
  id: string;
  category: '节律' | '情绪' | '习惯' | '偏好' | '关系' | '目标';
  content: string;                // ≤ 30 字，自然语言
  confidence: number;             // 0-100
  evidenceCount: number;          // 支撑数据点数量
  createdAt: string;
  userVerified: boolean | null;   // null=未反馈
}
```

### 2.3 Insight（洞察推送）

```typescript
interface Insight {
  id: string;
  type: 'pattern' | 'milestone' | 'correlation' | 'recommendation';
  content: string;                // ≤ 50 字，对用户展示
  source: string;                 // ≤ 30 字，数据来源说明
  confidence: number;             // 0-100
  priority: 'high' | 'normal';
  displayAfter?: string;          // 不早于此时间展示
  expiresAt?: string;
  relatedMemoryId?: string;
}
```

### 2.4 PersonalizationSlots（前端文案槽位）

```typescript
interface PersonalizationSlots {
  greeting: string;               // 首页问候语
  quote: string;                  // 首页引言（可含 HTML）
  remindBarText: string;          // 提醒条（可含 <b> 标签）
  energyNote: string;             // 今日能量注释
  actionCardText: string;         // 行动卡主文案（可含 <em> 标签）
  moodDotColor: string;           // hex
  dayBadge: string | null;        // null 则不显示
}
```

---

## 3. 后端 API 接口

### 3.1 获取个性化槽位文案

```
GET /api/v1/personalization/slots
Authorization: Bearer {token}

Response 200:
{
  "slots": PersonalizationSlots,
  "profileVersion": 34,
  "generatedAt": "2026-06-19T09:41:00Z"
}
```

**调用时机**: App 进入前台时，缓存有效期 30 分钟。

---

### 3.2 获取待推送洞察

```
GET /api/v1/insights/pending
Authorization: Bearer {token}
Query: ?limit=1&minConfidence=75

Response 200:
{
  "insights": Insight[],
  "hasMore": false
}
```

**调用时机**: 与 slots 接口并发，每次展示 ≤ 1 条。

---

### 3.3 获取 UserProfile 全量

```
GET /api/v1/profile
Authorization: Bearer {token}

Response 200:
{
  "profile": UserProfile,
  "slots": PersonalizationSlots,   // 一次请求同步返回，减少 RTT
  "pendingInsights": Insight[]
}
```

**调用时机**: 首次登录、设置页进入时。

---

### 3.4 提交洞察反馈

```
POST /api/v1/insights/{insightId}/feedback
Authorization: Bearer {token}
Body: { "positive": boolean }

Response 200: { "acknowledged": true }
```

---

### 3.5 提交心情记录

```
POST /api/v1/mood
Authorization: Bearer {token}
Body: {
  "color": "#74b9ff",
  "recordedAt": "2026-06-19T09:41:00Z"
}

Response 201: { "moodId": "...", "trend": "recovering" }
```

---

## 4. 前端个性化槽位表

所有需要个性化的 DOM 节点及其驱动字段：

| DOM id | 驱动字段 | 降级值（无数据时） |
|--------|---------|-----------------|
| `gz-name` | `slots.greeting` | `早安，{name}` |
| `gz-quote` | `slots.quote` | 达芬奇名言 |
| `tb-day-badge` | `slots.dayBadge` | 不显示（display:none） |
| `rb-main-text` | `slots.remindBarText` | `今天有 N 件事` |
| `energy-note-txt` | `slots.energyNote` | `✨ 昨晚睡得好` |
| `ac-text` | `slots.actionCardText` | 通用提醒文案 |
| `mood-dot` | `slots.moodDotColor` | `#f6c90e` |
| `insight-card` | `pendingInsights[0]` | display:none |
| `ic-body` | `pendingInsights[0].content` | — |
| `ic-source` | `pendingInsights[0].source` | — |
| `mem-prog-fill` | `profile.memories.length / 50` | width: 0% |
| `mem-prog-lbl` | 由 memories.length 生成 | `宝盒正在了解你` |
| `mem-list` | `profile.memories[]` | 引导空状态 |
| `dh-list` | `profile.dataHealth` | 全部 0% |

---

## 5. Insight 推送逻辑

### 5.1 置信度阈值

| 置信度 | 处理方式 |
|--------|---------|
| ≥ 90% | 直接推送 |
| 75–89% | 推送，措辞用"我注意到…" |
| 60–74% | 入队，等待更多数据 |
| < 60% | 不推送，继续训练 |

### 5.2 前端展示时机（客户端控制）

```
收到 pendingInsights 时：

IF priority === 'high':
  → 立即显示
ELSE IF 主动打开 App（非通知唤起）:
  IF 当前时间在 08:00–22:00:
    IF 今日未展示过洞察:
      → 显示洞察卡片
  ELSE:
    → 入队，下次打开展示
```

### 5.3 频率限制

- 同一用户每日最多展示 **1 条** 洞察卡片
- 同一 `relatedMemoryId` 的洞察，间隔 ≥ 7 天
- 用户点"不太对"后，该洞察 30 天内不再出现

---

## 6. 数据采集埋点

### 必采事件

| 事件名 | 触发时机 | 关键字段 |
|--------|---------|---------|
| `app_open` | App 进入前台 | `timestamp`, `daysSinceInstall` |
| `screen_view` | 页面切换 | `screen`, `durationMs` |
| `mood_log` | 选择心情颜色 | `color`, `timestamp` |
| `task_complete` | 勾选任务 | `taskId`, `timestamp`, `dayOfWeek` |
| `task_skip` | 点击"下一条" | `taskId`, `timestamp` |
| `insight_shown` | 洞察卡片展示 | `insightId`, `confidence` |
| `insight_feedback` | 点击反馈 | `insightId`, `positive` |
| `memory_viewed` | 进入记忆页 | `memoryCount` |

### 被动信号（用于节律分析）

| 信号 | 计算方式 |
|------|---------|
| 活跃时段 | `app_open` 时间分布，取 P75 区间 |
| 高效时段 | `task_complete` 时间分布，过滤周末 |
| 能量低谷 | `task_skip` 按星期聚合，取高值日 |

---

## 7. 降级策略

| 场景 | 前端处理 |
|------|---------|
| API 超时（> 3s） | 使用 localStorage 缓存的上次 slots，静默继续 |
| 无缓存 + API 失败 | 使用硬编码默认文案（PROFILES[1]） |
| daysSinceStart < 7 | 隐藏洞察卡片，记忆列表仅显示引导空状态 |
| 置信度不足 | 不更新对应文案槽位，保留上一次值 |
| 用户清除数据 | 全部重置为第 1 天默认状态 |

---

## 8. 前端状态管理

```javascript
AppState = {
  profile: UserProfile | null,      // localStorage 缓存，有效期 30 分钟
  slots: PersonalizationSlots,      // 当前渲染用文案
  pendingInsights: Insight[],       // sessionStorage，当次会话有效
  insightShownToday: boolean,       // localStorage，按自然日重置
  // 仅原型演示用，生产删除：
  demoDay: 1 | 34
}
```

---

## 9. 里程碑触发（后续迭代）

| 触发条件 | 展示内容 |
|---------|---------|
| 第 7 天 | 「一周了，宝盒对你有了第一印象」摘要卡 |
| 第 30 天 | 「第一个月」完整记忆报告 + 行为洞察 |
| 第 90 天 | AI 自动生成专属语气描述，替代 tone 选项 |
| memories.length ≥ 10 | 解锁「查看全部记忆」入口 |
| dataHealth 域 ≥ 3 | 解锁跨域关联洞察（如消费+情绪关联） |

---

## 10. 文案生成原则

后台生成个性化文案时遵循以下规则：

1. **不做道德评价** — 描述行为模式，不说"你不够努力"
2. **不制造亏欠感** — 用"通常""倾向"而非"总是""从不"
3. **置信度透明** — 内部记录置信度，用户可在记忆页查看
4. **可纠正** — 每条记忆都有"不太对"反馈入口
5. **长度限制** — 洞察 content ≤ 50 字，memory content ≤ 30 字，避免打断用户心流
