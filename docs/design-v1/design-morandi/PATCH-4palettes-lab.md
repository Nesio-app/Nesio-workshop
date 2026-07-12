# 补丁:实验板块「低饱和配色」→ 4 套可选色卡

> 目标:把 app 现有的**单开关** `低饱和配色(预览)`(批次 31,`data-lowsat=1` 单套)升级成 **4 选 1 色卡选择器**,四套 = 用户选定的
> ① 蓝灰·灰粉点睛 ② 沙米·奶茶暖调 ③ 雾霾蓝·柔 ④ 灰绿·治愈。机制不变(只覆写 `--portal-*` token,一处切换全站换装),仅从布尔升级为枚举。
> 基准:`origin/treasurebox main`(tip e73f8ca)。改 3 个文件。

---

## 1) `lib/portal/module-overrides.ts` —— 布尔 → 枚举(向后兼容旧 lowsat)

替换批次 31 那段(`LOWSAT_KEY` / `isLowSatThemeOn` / `setLowSatTheme` / `applyLowSatTheme`):

```ts
/** 批次 31→N:低饱和配色预览。单开关升级为 4 选 1 色卡;'' = 默认蓝。 */
export type PaletteId = '' | 'bluegray-rose' | 'milktea' | 'haze-blue' | 'sage';
const PALETTE_KEY = 'nesio-theme-palette-v1';
const LEGACY_LOWSAT_KEY = 'nesio-theme-lowsat-v1';

export const PALETTES: { id: PaletteId; zh: string; en: string; hint: string }[] = [
  { id: 'bluegray-rose', zh: '蓝灰 · 灰粉点睛', en: 'Slate + rose', hint: '冷调精致' },
  { id: 'milktea',       zh: '沙米 · 奶茶暖调', en: 'Milk tea',     hint: '温润 muji' },
  { id: 'haze-blue',     zh: '雾霾蓝 · 柔',     en: 'Haze blue',    hint: '保留品牌蓝' },
  { id: 'sage',          zh: '灰绿 · 治愈',     en: 'Sage',         hint: '自然疗愈' },
];

export function getPalette(): PaletteId {
  if (typeof window === 'undefined') return '';
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    if (v && PALETTES.some(p => p.id === v)) return v as PaletteId;
    // 旧用户迁移:老的 lowsat 单套 → 映射到雾霾蓝
    if (localStorage.getItem(LEGACY_LOWSAT_KEY) === '1') return 'haze-blue';
  } catch { /* ignore */ }
  return '';
}
export function setPalette(id: PaletteId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PALETTE_KEY, id);
    localStorage.removeItem(LEGACY_LOWSAT_KEY); // 清理旧键
  } catch { /* ignore */ }
  applyPalette();
}
export function applyPalette(): void {
  if (typeof document === 'undefined') return;
  const id = getPalette();
  const root = document.documentElement;
  if (id) root.setAttribute('data-palette', id);
  else root.removeAttribute('data-palette');
  root.removeAttribute('data-lowsat'); // 旧属性不再使用
}

// ── 向后兼容:保留旧导出名,避免别处引用报错 ──
export function isLowSatThemeOn(): boolean { return getPalette() !== ''; }
export function setLowSatTheme(on: boolean): void { setPalette(on ? 'haze-blue' : ''); }
export const applyLowSatTheme = applyPalette;
```

> 调用处:原本在 app 启动/水合时调用 `applyLowSatTheme()` 的地方(Portal.tsx),`applyLowSatTheme` 仍存在(= `applyPalette`),无需改。

---

## 2) `app/globals.css` —— 把批次 31 单块换成 4 组 token

删掉 `html[data-lowsat="1"], html[data-lowsat="1"] .portal-root { … }` 整块,替换为下面 4 组。每组结构与原块一致,只是数值不同。

```css
/* ══ 低饱和配色 · 4 套色卡(用户选定)。只覆写 token,一处切换全站换装 ══ */

/* ① 蓝灰底 + 灰粉点睛 —— 冷调精致 */
html[data-palette="bluegray-rose"], html[data-palette="bluegray-rose"] .portal-root {
  --portal-blue-deep:#b06f68; --portal-blue-mid:#d9bdb8; --portal-blue-light:#f2ddd9;
  --portal-bg-gradient:
    radial-gradient(ellipse 85% 60% at 12% 0%, rgba(204,209,215,0.55), transparent 55%),
    radial-gradient(ellipse 70% 55% at 88% 6%, rgba(242,221,217,0.45), transparent 50%),
    linear-gradient(165deg,#f9faf5 0%,#e2e5e8 50%,#ccd1d7 100%);
  --portal-bg:#f2f4f5; --portal-line:rgba(120,125,135,0.14);
  --portal-cool:#e7ebee; --portal-cool-accent:#7d8a97;
  --portal-warm:#f3e9e7; --portal-warm-accent:#b0736c;
  --portal-neutral:#ecebe9; --portal-neutral-accent:#a2a3ab;
  --portal-accent:#c07f79;
  --portal-accent-soft:rgba(192,127,121,0.10); --portal-accent-soft-md:rgba(192,127,121,0.18);
  --portal-accent-soft-lg:rgba(192,127,121,0.28); --portal-accent-border:rgba(192,127,121,0.25);
  --status-go:#7d9b91; --status-go-soft:#e6ede9;
  --status-gentle:#c08a6f; --status-gentle-soft:#f2e6df;
  --status-calm:#8a95a3; --status-calm-soft:#e7eaee;
  --portal-muted:#6b7280; --portal-ink:#3a3c43;
}

/* ② 沙米 / 奶茶暖调 —— 温润 muji */
html[data-palette="milktea"], html[data-palette="milktea"] .portal-root {
  --portal-blue-deep:#a98f66; --portal-blue-mid:#cdbb9c; --portal-blue-light:#eae0cf;
  --portal-bg-gradient:
    radial-gradient(ellipse 85% 60% at 12% 0%, rgba(217,204,181,0.55), transparent 55%),
    radial-gradient(ellipse 70% 55% at 88% 6%, rgba(234,224,207,0.5), transparent 50%),
    linear-gradient(165deg,#f2ece0 0%,#e6dbc8 50%,#d9ccb5 100%);
  --portal-bg:#f3efe6; --portal-line:rgba(120,110,90,0.14);
  --portal-cool:#e9ebe6; --portal-cool-accent:#7f8a78;
  --portal-warm:#efe6d8; --portal-warm-accent:#a98f66;
  --portal-neutral:#ece7dd; --portal-neutral-accent:#a5a29a;
  --portal-accent:#a98f66;
  --portal-accent-soft:rgba(169,143,102,0.10); --portal-accent-soft-md:rgba(169,143,102,0.18);
  --portal-accent-soft-lg:rgba(169,143,102,0.28); --portal-accent-border:rgba(169,143,102,0.25);
  --status-go:#7f9a6e; --status-go-soft:#e8ede2;
  --status-gentle:#b58a5a; --status-gentle-soft:#f0e6d6;
  --status-calm:#a9a58a; --status-calm-soft:#ece9df;
  --portal-muted:#74716a; --portal-ink:#3c3a35;
}

/* ③ 雾霾蓝 · 柔 —— 保留品牌蓝 */
html[data-palette="haze-blue"], html[data-palette="haze-blue"] .portal-root {
  --portal-blue-deep:#5f7890; --portal-blue-mid:#a9c2d5; --portal-blue-light:#dceaf3;
  --portal-bg-gradient:
    radial-gradient(ellipse 85% 60% at 12% 0%, rgba(95,120,144,0.20), transparent 55%),
    radial-gradient(ellipse 70% 55% at 88% 6%, rgba(220,234,243,0.65), transparent 50%),
    linear-gradient(165deg,#e6f0f6 0%,#c9dced 55%,#9fbcd4 100%);
  --portal-bg:#eef4f8; --portal-line:rgba(80,100,120,0.14);
  --portal-cool:#e0ecf3; --portal-cool-accent:#5f7890;
  --portal-warm:#eef2f5; --portal-warm-accent:#6f88a0;
  --portal-neutral:#e7edf1; --portal-neutral-accent:#9fb0c2;
  --portal-accent:#6f88a0;
  --portal-accent-soft:rgba(111,136,160,0.10); --portal-accent-soft-md:rgba(111,136,160,0.18);
  --portal-accent-soft-lg:rgba(111,136,160,0.28); --portal-accent-border:rgba(111,136,160,0.25);
  --status-go:#5f8f8a; --status-go-soft:#e0eeec;
  --status-gentle:#b0895f; --status-gentle-soft:#f0e6da;
  --status-calm:#8fa3b2; --status-calm-soft:#e6ecf0;
  --portal-muted:#647585; --portal-ink:#2f3743;
}

/* ④ 灰绿 · 治愈 —— 自然疗愈 */
html[data-palette="sage"], html[data-palette="sage"] .portal-root {
  --portal-blue-deep:#6f8b7f; --portal-blue-mid:#b6ccc2; --portal-blue-light:#e0ebe6;
  --portal-bg-gradient:
    radial-gradient(ellipse 85% 60% at 12% 0%, rgba(111,139,127,0.18), transparent 55%),
    radial-gradient(ellipse 70% 55% at 88% 6%, rgba(224,235,230,0.6), transparent 50%),
    linear-gradient(165deg,#eef3f0 0%,#d9e6df 55%,#c0d3c8 100%);
  --portal-bg:#eef3f0; --portal-line:rgba(90,110,100,0.14);
  --portal-cool:#e2ede8; --portal-cool-accent:#6f8b7f;
  --portal-warm:#eef2ee; --portal-warm-accent:#7a9b6e;
  --portal-neutral:#e8ede9; --portal-neutral-accent:#a3b0a6;
  --portal-accent:#7f9b8f;
  --portal-accent-soft:rgba(127,155,143,0.10); --portal-accent-soft-md:rgba(127,155,143,0.18);
  --portal-accent-soft-lg:rgba(127,155,143,0.28); --portal-accent-border:rgba(127,155,143,0.25);
  --status-go:#6f9b8a; --status-go-soft:#e2ede8;
  --status-gentle:#b0956a; --status-gentle-soft:#f0e9db;
  --status-calm:#93a897; --status-calm-soft:#e7ece8;
  --portal-muted:#64756b; --portal-ink:#33403a;
}
```

> 设计原则「首页满渐变、内页浅底」已由 token 天然满足:`--portal-bg-gradient` 只用于首页容器,列表/图表页用 `--portal-bg`(浅色),四套都给了对应浅底。

---

## 3) `components/portal/SettingsSheets.tsx` —— 单开关 → 4 色卡单选

import 改:
```ts
import { …, getPalette, setPalette, PALETTES, type PaletteId } from '@/lib/portal/module-overrides';
```
state 改:`const [lowSatOn…]` → `const [palette, setPaletteState] = useState<PaletteId>('');`
水合处:`setLowSatOn(isLowSatThemeOn());` → `setPaletteState(getPalette());`

把那颗「低饱和配色(预览)」`<button>` 整块替换为:
```tsx
<div className="nesio-settings-option" style={{ display:'block' }}>
  <span className="nesio-settings-option-label">
    {L(dict, `低饱和配色(预览)${palette ? '· 已开启' : ''}`, `Low-saturation palette (preview)${palette ? ' · on' : ''}`)}
  </span>
  <span className="nesio-settings-option-hint">
    {L(dict, '点一张即时全站换装,再点「默认蓝」还原。', 'Tap a card to reskin instantly; tap Default blue to restore.')}
  </span>
  <div className="nesio-palette-grid">
    {/* 默认蓝 */}
    <button type="button"
      className={`nesio-palette-card${palette === '' ? ' nesio-palette-card--on' : ''}`}
      onClick={() => { setPalette(''); setPaletteState(''); }}>
      <span className="nesio-palette-sw" data-p="default" />
      <span className="nesio-palette-name">{L(dict, '默认蓝', 'Default blue')}</span>
    </button>
    {PALETTES.map(p => (
      <button key={p.id} type="button"
        className={`nesio-palette-card${palette === p.id ? ' nesio-palette-card--on' : ''}`}
        onClick={() => { setPalette(p.id); setPaletteState(p.id); }}>
        <span className="nesio-palette-sw" data-p={p.id} />
        <span className="nesio-palette-name">{L(dict, p.zh, p.en)}</span>
        <span className="nesio-palette-hint">{p.hint}</span>
      </button>
    ))}
  </div>
</div>
```

配套小样式(加到 globals.css 设置区附近):
```css
.nesio-palette-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:10px}
.nesio-palette-card{display:flex;flex-direction:column;align-items:flex-start;gap:4px;
  padding:10px;border:1.5px solid var(--portal-line);border-radius:12px;background:transparent;cursor:pointer;text-align:left}
.nesio-palette-card--on{border-color:var(--portal-ink);background:var(--portal-accent-soft)}
.nesio-palette-sw{width:100%;height:30px;border-radius:8px;border:1px solid rgba(0,0,0,.06)}
.nesio-palette-sw[data-p="default"]{background:linear-gradient(135deg,#cfe0f6,#a9c6ef)}
.nesio-palette-sw[data-p="bluegray-rose"]{background:linear-gradient(135deg,#f9faf5,#ccd1d7);box-shadow:inset -10px 0 0 -4px #c07f79}
.nesio-palette-sw[data-p="milktea"]{background:linear-gradient(135deg,#f2ece0,#d9ccb5);box-shadow:inset -10px 0 0 -4px #a98f66}
.nesio-palette-sw[data-p="haze-blue"]{background:linear-gradient(135deg,#e6f0f6,#9fbcd4);box-shadow:inset -10px 0 0 -4px #5f7890}
.nesio-palette-sw[data-p="sage"]{background:linear-gradient(135deg,#eef3f0,#c0d3c8);box-shadow:inset -10px 0 0 -4px #7f9b8f}
.nesio-palette-name{font-size:13px;font-weight:800;color:var(--portal-ink)}
.nesio-palette-hint{font-size:10.5px;font-weight:600;color:var(--portal-muted)}
```

---

## 落地与验证
1. 三处改完 → `npm run build` 应无类型错误(旧 `isLowSatThemeOn/setLowSatTheme` 仍导出,兼容其余引用)。
2. 设置 › 实验功能 › 低饱和配色:点 4 张卡应即时换装,点「默认蓝」还原;刷新后保持(localStorage)。
3. 旧用户(已开 lowsat)首次进入自动迁移到「雾霾蓝」,不突兀。
4. 深色模式:本补丁只覆写日间 token;夜间(`data-portal-theme="night"`)未动 —— 如需夜间也换,再各加一组 `html[data-portal-theme="night"][data-palette="X"]`(可后续)。

> 说明:本补丁针对 **treasurebox 仓**(app 本体),不在本 keep2notion 仓。此文档 = 可直接照抄的改动清单。
