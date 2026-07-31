/**
 * 行为契约:2026-07-29「整体风格设计不一致」那一批的防回退锁。
 *
 * 用户逐条列了 13 处。其中会被后人无意中改回去的是这几条 ——
 * 它们的共同点是「散在各处、单看每处都合理,合起来才是不一致」:
 *
 *   ①  分段控件曾有五套实现(健康/成长/美味/日程/衣橱各一套)。收敛到
 *       components/portal/ui/SegTabs.tsx 之后,任何一处「就这儿特殊一下」
 *       都会让五套重新长出来 → 这里锁住:五个调用方必须用 SegTabs,
 *       旧的类名必须在 CSS 里彻底消失(留着就会被下一个人再引用)。
 *   ②  家务/车两页曾卡在加载态 —— 真因是 fetch **没有超时**,不是动效问题。
 *       删掉 signal 或 AbortController,页面就又能永远转下去了 → 锁住超时。
 *   ③  衣橱曾一律用 👕 / 👍 / 👎 原生 emoji,和站内描边图标混着用。
 *
 * 有意不锁的:海报/瓦片的 filter 数值、颜色深浅 —— 那是审美参数,该能随时调。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** 剥注释再断言 —— 本仓踩过多次「注释里提了一句就把断言喂饱了」。 */
const code = stripComments;

// ── ① 分段控件只有一套 ────────────────────────────────────────────────────────
{
  const CALLERS = [
    'components/portal/health/HealthDashboard.tsx',
    'components/portal/insights/GrowthTab.tsx',
    'components/portal/insights/SchedulePanel.tsx',
    'components/portal/insights/WardrobePanel.tsx',
    'components/portal/cooking/CookingSheet.tsx',
    // 2026-07-29 复审补录:这两处也是各写一套(第 6、7 套),一并收编。
    // 2026-07-30 移除 BodyLedgerPanel:main 的 bug2 批把它的三个子 tab 整个删了
    // (今日账本内容直接作为主体),这份名单钉的是「有 tab 就得用 SegTabs」,
    // 没有 tab 的文件留在名单里只会让契约红在一件已经做对的事上。
  ];
  for (const f of CALLERS) {
    const c = code(read(f));
    assert.match(c, /from '\.\.\/ui\/SegTabs'/, `${f} 没有用统一的分段控件 SegTabs —— tab 又要长出第 N 套了`);
    assert.match(c, /<SegTabs\b/, `${f} import 了 SegTabs 却没用上`);
  }

  const css = read('app/globals.css');
  assert.match(css, /\.nesio-seg\s*\{/, 'globals.css 里没有 .nesio-seg —— SegTabs 会渲染成裸按钮');
  assert.match(css, /\.nesio-seg-tab\.is-active\s*\{/, '.nesio-seg-tab.is-active 缺失 —— 选中态看不出来');
  // 旧的四套必须彻底删掉:留在 CSS 里就会被下一个人再引用,不一致立刻回来。
  for (const dead of ['.nesio-health-subtab', '.ng-subtabs', '.nesio-bl-tab', '.nesio-tl-seg']) {
    assert.ok(!css.includes(dead), `旧分段控件样式 ${dead} 还在 globals.css 里 —— 删干净,否则会被重新引用`);
  }
  // 日程那套借的是「设置行」样式当 tab,最不像 tab 的一处
  const sched = code(read('components/portal/insights/SchedulePanel.tsx'));
  assert.ok(
    !/nesio-settings-option[^-]/.test(sched),
    'SchedulePanel 又拿 .nesio-settings-option(设置行样式)当 tab 用了',
  );
}

// ── ② 每个「转圈」都必须有尽头 ────────────────────────────────────────────────
// 用户看到的是「卡死在加载中…」/「卡死在正在向车问好…」。动效再好看也救不了
// 一条永不返回的 fetch —— 超时才是修复本身。
{
  // 超时实现只有一份:lib/portal/fetch-timeout.ts。它本身必须真的会 abort。
  const helper = code(read('lib/portal/fetch-timeout.ts'));
  assert.match(helper, /new AbortController\(\)/, 'fetchWithTimeout 没有 AbortController —— 它就不是「带超时」的 fetch');
  assert.match(helper, /setTimeout\(\(\)\s*=>\s*ctrl\.abort\(\)/, 'fetchWithTimeout 造了 controller 却没人到点 abort');
  assert.match(helper, /signal:\s*ctrl\.signal/, 'fetchWithTimeout 没把 signal 传给 fetch(等于没超时)');
  // 调用方自己的 signal 不能被吃掉 —— 直接覆盖会悄悄废掉「组件卸载时取消」。
  assert.match(helper, /addEventListener\('abort'/, 'fetchWithTimeout 覆盖了调用方的 signal 而没有合流,调用方的取消能力被吃掉了');

  // 三个曾经/可能卡死的加载路径必须走它,而不是裸 fetch。
  for (const [f, why] of [
    ['lib/family/family-client.ts', '家务页会永远停在「加载中…」'],
    ['components/portal/TeslaPanel.tsx', '车深度休眠时会永远停在「正在向车问好…」'],
    ['components/portal/insights/AdminOpsPanel.tsx', '运营页会永远停在加载态'],
  ]) {
    const c = code(read(f));
    assert.match(c, /fetchWithTimeout\(/, `${f} 的 fetch 没有超时 —— ${why}`);
    assert.ok(
      !/(?<!With)\bfetch\(/.test(c.replace(/fetchWithTimeout\(/g, 'FWT(')),
      `${f} 里还有裸 fetch( —— 漏掉的那条照样会把界面挂死`,
    );
  }

  // 等待态本身也要是卡片 + 骨架,不是一行裸灰字(用户原话:「裸文字、无卡片、无动效」)。
  // 光断言「文件里有 LoadingCard」不够 —— 三处等待态里退化一处照样绿(变异测试抓到的)。
  // 所以逐个盯**分支本身**。
  assert.match(
    code(read('components/portal/family/FamilySharingSheet.tsx')),
    /\{loading && \(\s*<LoadingCard/,
    '家务页顶层的 loading 分支又变回裸文字了',
  );
  assert.equal(
    (code(read('components/portal/family/FamilySharingSheet.tsx')).match(/<LoadingCard\b/g) || []).length, 3,
    '家务页三处等待态(家庭列表 / 家庭板 / 账本)必须都是 LoadingCard —— 少一处就有一屏是裸文字',
  );
  assert.match(
    code(read('components/portal/TeslaPanel.tsx')),
    // 2026-07-30:这个分支加了 timeoutMs 兜底(#12「加载条一直不消失」),
    // 从单行 return 变成带括号的多行 JSX —— 判据仍然是「这个分支返回的是 LoadingCard」。
    /state === 'loading'\)\s*\{\s*return \(?\s*<LoadingCard/,
    '车页的 loading 分支又变回裸文字了',
  );
  assert.match(read('app/globals.css'), /\.nesio-skeleton-bar\s*\{/, '骨架条样式没了 —— LoadingCard 会渲染成空白');
}

// 什么算「原生 emoji」:**默认就以彩色 emoji 呈现**的字符。
//   · 0x1F000–0x1FAFF 整段(👕 🚗 🎁 …);
//   · 0x2600–0x27BF 这一段是混的 —— ☔ ⚡ ⏰ 是彩色 emoji,而 ★ ✓ ✕ ✎ ☑ 是**排版符号**,
//     全站拿来当难度星/勾叉在用,不该被当成 emoji 抓。所以这段只列默认彩显的那几个。
//   · 任何字符 + U+FE0F(emoji 变体选择符)一律算 —— ⚠️ 就是靠它变彩的。
const DEFAULT_EMOJI_2600 = new Set([...'⌚⌛⏩⏪⏫⏬⏰⏳☔☕♈♉♊♋♌♍♎♏♐♑♒♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽']);
const isEmoji = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x1f000 && c <= 0x1faff) || DEFAULT_EMOJI_2600.has(ch) || c === 0xfe0f;
};

// ── ③ 衣橱里不许再出现原生 emoji ─────────────────────────────────────────────
{
  const w = code(read('components/portal/insights/WardrobePanel.tsx'));
  const emoji = [...w].filter(isEmoji);
  assert.equal(
    emoji.length, 0,
    `衣橱里又混进原生 emoji 了(${[...new Set(emoji)].join(' ')})—— 站内是描边图标系统,见 components/portal/icons.tsx`,
  );
  // 衣物缩略图占位必须按类别分,不能又退回「所有衣服一个图标」
  assert.match(w, /<GarmentIcon\s+type=\{[^}]*garmentType\}/, '衣物占位图标没有按类别区分(上装/下装/外套…又变成同一个了)');
  // 洞察宫格的衣橱入口不能再用「书签/收藏夹」
  const ins = code(read('components/portal/InsightsSheet.tsx'));
  assert.match(ins, /case 'wardrobe': return <IconHanger \/>/, '洞察宫格的衣橱图标又变回书签了');
}

// ── ④ 三个「出错页」都不许脱离主题 ──────────────────────────────────────────
// 原来 not-found / error / global-error 三份都是硬编码 #588ce3 + 系统 emoji。
// 上一轮只修了 not-found,另两份是同一个模板复制出来的 —— 一起锁,否则改一个漏两个。
for (const f of ['app/not-found.tsx', 'app/error.tsx', 'app/global-error.tsx']) {
  const nf = code(read(f));
  // 先摘掉 var(--x, #fff) 这种**兜底**值(那是 token 缺失时的最后一道,全站惯例),
  // 剩下任何裸色值都算硬编码。
  const nfColors = nf.replace(/var\([^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(nfColors),
    `${f} 又硬编码色值了(${(nfColors.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(' ')})—— 全站有四套可切换皮肤,写死的颜色只对其中一套`);
  assert.match(nf, /var\(--portal-accent[,)]/, `${f} 的主按钮没有走强调色 token`);
  assert.ok(![...nf].some(isEmoji), `${f} 又用回系统 emoji 了`);
}

// ── ⑤ 界面上不许出现原生 emoji(全 components 扫,不只衣橱)────────────────────
// 数据层可以继续存 emoji 字符串(跨版本/跨仓共享,迁移代价大),但渲染层必须过
// icons.tsx 的 EmojiIcon 转成描边图标。这条盯的是**渲染**,所以放行三类:
//   · icons.tsx 里那张转换表本身;
//   · 聊天的 emoji 表情选择器(那是用户要发的内容,不是 UI 图标);
//   · 纯数据常量行(icon: '📖' / emoji: '⚡' 这种,渲染层会转)。
{
  const SKIP = ['components/portal/icons.tsx'];
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.(tsx|ts)$/.test(e.name) || SKIP.includes(rel)) continue;
      const c = code(read(rel));
      c.split('\n').forEach((line, i) => {
        if (!/[<>{]/.test(line)) return;                       // 非 JSX/表达式行不看
        // 纯数据常量行(icon: '📖' / emoji: '⚡'):渲染层会经 EmojiIcon 转换,放行
        if (/\b(icon|emoji)\s*:\s*(s\.\w+\s*\|\|\s*)?'/.test(line) && !/<[A-Za-z]/.test(line)) return;
        if (/\].map\(\(em\)/.test(line) || /'😊'/.test(line)) return; // 表情选择器
        if ([...line].some(isEmoji)) offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
  };
  walk('components');
  assert.equal(
    offenders.length, 0,
    `界面上又出现原生 emoji(渲染层必须走 icons.tsx 的 EmojiIcon):\n  ${offenders.join('\n  ')}`,
  );
}

console.log('ui-consistency: OK(分段控件唯一 · 加载态有尽头 · 衣橱无 emoji · 404 跟主题)');
