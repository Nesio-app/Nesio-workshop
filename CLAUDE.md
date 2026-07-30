# Nesio / 宝盒 — Claude Code Guidelines

**先读仓库根目录的 [STATE.md](STATE.md)** — 当前纪元(两代产品交接状态)、进行中迁移、
红线(CI 契约、守卫规则)、欠账清单都在那里。改重大状态时同步更新它。


## 语言
中文回答，中文思考。

---

## Design System 规范

**设计系统源文件：** `design-system/nesio/`
**Token 总入口：** `design-system/nesio/tokens/colors.css` · `typography.css` · `spacing.css` · `effects.css`
**已应用到：** `app/globals.css`（`:root, .portal-root` 块 + night mode 块）

### 颜色规则（重要）

**禁止在组件里硬编码色值**。所有颜色必须用 CSS 变量：

| 用途 | 变量 | Day 值 |
|------|------|--------|
| 主强调色（蓝）| `var(--portal-blue-deep)` | `#588ce3` |
| 主强调（alias）| `var(--portal-accent)` | = blue-deep |
| 透明强调（淡）| `var(--portal-accent-soft)` | `rgba(88,140,227,.10)` |
| 透明强调（中）| `var(--portal-accent-soft-md)` | `rgba(88,140,227,.18)` |
| 边框强调 | `var(--portal-accent-border)` | `rgba(88,140,227,.25)` |
| 次强调（冷区）| `var(--portal-cool-accent)` | `#588ce3` |
| 文字主色 | `var(--portal-ink)` | `#1e2a3a` |
| 文字次色 | `var(--portal-muted)` | `#5a6d82` |
| 分割线 | `var(--portal-line)` | `rgba(88,140,227,.14)` |
| 背景面 | `var(--portal-bg)` | `#f4f8fd` |
| **完成/好** | `var(--status-go)` | `#5a9e7a` |
| 完成（背景）| `var(--status-go-soft)` | `#d9ece1` |
| **待办/琥珀** | `var(--status-gentle)` | `#c9923f` |
| 待办（背景）| `var(--status-gentle-soft)` | `#f3e4cc` |
| **信息/中性** | `var(--status-calm)` | `#6b8fc9` |
| 信息（背景）| `var(--status-calm-soft)` | `#dfe8f6` |
| **真实风险** | `var(--status-risk)` | `#cf6b6b` |
| 风险（背景）| `var(--status-risk-soft)` | `#f5d9d9` |

**❌ 以下颜色已被废弃，遇到立即替换：**
- `#8b5cf6` / `rgba(139,92,246,...)` → `var(--portal-cool-accent)`
- `#3b6ef0` / `#6366f1` / `#3b82f6` → `var(--portal-blue-deep)`
- `#ef4444` / `rgba(239,68,68,...)` → `var(--status-risk)` / `var(--status-risk-soft)`
- `#10b981` / `rgba(16,185,129,...)` → `var(--status-go)` / `var(--status-go-soft)`
- `#f59e0b` / `rgba(245,158,11,...)` → `var(--status-gentle)` / `var(--status-gentle-soft)`
- `#f0f4ff` / `#e8effe` → `var(--portal-accent-soft)`

**例外（不要改）：**
- Google / Apple 第三方 logo SVG 里的品牌色
- `MoodSheet.tsx` 里情绪轮的情绪颜色（`#FFD166`, `#FF8FAB` 等）——这是情绪语义调色板，不是 UI 强调色
- Canvas 2D context 不支持 CSS 变量，用 `getComputedStyle` 读取后使用

### 字体规则

```css
font-family: var(--font-sans);     /* 正文：Noto Sans SC 级联 */
font-family: var(--font-serif);    /* 引用/标题：Noto Serif SC */
```

字重用 `var(--weight-regular/medium/semibold/bold)`，字号用 `var(--text-body/sm/xs/h3/h2/h1/display)`。

### 间距 & 圆角规则

- 间距统一用 `var(--space-1)` ~ `var(--space-16)`（4px 网格）
- 圆角：chips/buttons `--radius-sm (12px)`，卡片 `--radius-md (16px)`，sheets `--radius-xl (28px)`，pill `--radius-pill`

### 图标规则

| 类型 | 路径 |
|------|------|
| 底部导航图标 | `public/assets/icons/nav/*.svg` |
| Logo / 晶体 | `public/assets/logo/treasurebox.svg` |
| 工具模块图标 | `public/icons/tools/*.svg` |
| AI 对话图标 | `public/icons/ai/*.svg` |

导入方式通过 `lib/portal/nesio-design-system-assets.mjs` 中的 `nesioBrandAssets` / `nesioToolIcons` / `nesioAiIcons`。

---

## 主题切换

```html
<html data-portal-theme="day">   <!-- 默认 -->
<html data-portal-theme="night"> <!-- 夜间 -->
```

所有颜色 token 已在 `html[data-portal-theme="night"]` 块中声明覆盖值，无需手动判断主题。

---

## 文案语气（warm-coach）

- 避免：逾期 / 失败 / 未完成 / 风险很高
- 改为：「还有一件事可以轻轻处理」/ 「先保存，稍后决定」
- 不用红色制造焦虑；`--status-risk` 仅用于真实安全/到期风险
- 每个提示都提供「跳过 / 稍后 / 不再提醒」出口

---

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools directly.

## Design rules

- **Every async action must have a visible failure state.** Buttons that
  trigger fetch/AI/TTS must render explicit error UI (message + retry),
  never silently return to idle. Root cause of multiple "按钮没反应" bugs
  (听简报, Gmail sync). No optimistic UI without a failure branch.
- **Never swallow storage write failures.** localStorage/IndexedDB writes
  that can drop user data must dispatch a visible event on failure
  (see lib/portal/storage-health.ts).
- **New API routes that spend money or read private data must call
  `guardAiRoute`** (lib/portal/api-auth.ts) and be added to
  docs/api-routes.md.
- **New localStorage keys must be registered** in
  `scripts/storage-key-registry.test.mjs` (KNOWN_KEYS). Unregistered keys
  default to `durable` — meaning they silently enter the backup file and get
  cloud-synced. This already leaked connector tokens and the admin secret
  once. Decide the class with one question: *is it correct for this value to
  start from scratch on a new device?* Yes → `cache`, no → `durable`,
  credential → `auth` (+ AUTH_KEYS). See docs/storage-keys.md.
