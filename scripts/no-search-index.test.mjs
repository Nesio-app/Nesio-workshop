/**
 * 行为契约:不进搜索引擎(2026-07-31 用户:「谷歌可以搜到……可以搜不到么」)。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────────
 * 这个仓此前**一个 robots 设置都没有**:没有 robots.txt、metadata 里也没有 robots
 * 字段、响应头里也没有 X-Robots-Tag。等于默认敞开,于是网址真的被 Google 收录了。
 *
 * 注意用户要的**不是**「谁都进不来」—— 他明确说了「不登录可以本地用」,
 * 那是 Nesio 的本地优先设计(不登录也能记笔记、听本地歌)。所以 Vercel 那种
 * 平台级密码保护是错的方案:它连页面都不给加载。要的只是**搜不到**。
 *
 * ── 这份契约真正在守的一件事 ────────────────────────────────────────────────
 * robots.txt 里写的是 `Allow: /`。下一个人看到多半会以为是笔误 ——
 * 「不想被搜到怎么会 Allow?」然后顺手改成 `Disallow: /`。**那样会适得其反。**
 *
 * robots.txt 管的是**能不能爬**,不是**能不能收录**:
 *   · 改成 Disallow → 爬虫不再访问 → 读不到响应头里的 noindex
 *   · 于是它没有理由撤掉已经在索引里的旧条目 → 那行搜索结果**留在原地**,
 *     只是没了摘要,变成一行光秃秃的网址
 * 正确顺序是反的:先让它进得来、看到 noindex、把条目撤掉。
 *
 * 这个错误改完之后**没有任何症状**(本地、线上都一切正常),只有几个月后
 * 「怎么还能搜到」才会暴露 —— 正是契约该拦的那一类。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── ① 响应头:主力 ─────────────────────────────────────────────────────────
{
  const cfg = read('next.config.js');
  const m = /key: 'X-Robots-Tag', value: '([^']+)'/.exec(cfg);
  assert.ok(m, 'X-Robots-Tag 响应头不见了 —— 那是真正让爬虫撤掉条目的那一行');
  const v = m[1];
  for (const token of ['noindex', 'nofollow', 'noarchive']) {
    assert.ok(new RegExp(`\\b${token}\\b`).test(v), `X-Robots-Tag 要含 ${token}`);
  }
  // noarchive 的意义单说一句:没有它,即使从搜索结果里撤了,网页快照还能被翻出来。
  assert.ok(/\bnoarchive\b/.test(v), '要掐掉网页快照,否则撤了条目快照还在');
  // 必须作用于**全站**。只挂在某几条 source 上等于漏掉其余页面。
  assert.ok(
    /source: '\/\(\.\*\)', headers: securityHeaders/.test(cfg),
    'X-Robots-Tag 必须随 securityHeaders 作用于全站 /(.*) —— 挂在部分路径上等于没挡住',
  );
}

// ── ② robots.txt:**必须放行**,这是最反直觉的一条 ──────────────────────────
{
  const robots = read('app/robots.ts');
  assert.ok(/allow: '\/'/.test(robots), "robots.txt 必须 Allow: / —— 见文件头:改成 Disallow 会让旧条目永远撤不掉");
  assert.ok(
    !/disallow: '\/'[,\s]/.test(robots) && !/disallow: \['\/'\]/.test(robots),
    "不许出现全站 Disallow: / —— 那禁的是爬取不是收录,结果是搜索结果留在原地、只是没了摘要",
  );
  // 理由必须写在代码里。这条错误改完没有任何症状,只有注释能拦住下一个人。
  assert.ok(
    /能不能爬/.test(robots) && /能不能收录/.test(robots),
    'robots.ts 里要写清「爬取 ≠ 收录」这个区别 —— 没有它,Allow: / 看起来就像个笔误',
  );
  // 不给 sitemap:那是主动请人来收录用的,和这件事正好相反。
  assert.ok(!/sitemap/i.test(robots.replace(/\/\*[\s\S]*?\*\//g, '')), '不许给 sitemap —— 那是招人来收录的');
  assert.ok(!fs.existsSync(new URL('../app/sitemap.ts', import.meta.url)), '不许有 sitemap.ts');
}

// ── ③ metadata:纵深(有些爬虫只读 HTML 不读响应头)──────────────────────────
{
  const layout = read('app/layout.tsx');
  assert.ok(/robots:\s*\{/.test(layout), 'metadata 里要有 robots 字段');

  // ⚠️ 必须把**顶层** robots.index 和**嵌套的** googleBot.index 分开看。
  // 第一版没分,于是把顶层改成 index:true 时,断言匹配到了 googleBot 里那个
  // index:false —— 照样绿。嵌套结构上用「文件里有没有这个串」去断言,
  // 分不清是哪一层的,等于没断言。
  const robotsBlock = layout.slice(layout.indexOf('robots: {'));
  const topLevel = robotsBlock.slice(0, robotsBlock.indexOf('googleBot'));
  assert.ok(/index:\s*false/.test(topLevel), 'metadata robots.index(顶层)必须 false');
  assert.ok(/follow:\s*false/.test(topLevel), 'metadata robots.follow(顶层)必须 false');
  // (?<![a-zA-Z]) 是必须的:`noimageindex: true` 里含子串 `index: true`,
  // 不加前瞻的话它会被误判成「顶层开了收录」—— 我刚被自己这条断言抓了一次。
  assert.ok(!/(?<![a-zA-Z])index:\s*true/.test(topLevel), '顶层不许出现 index: true');

  const googleBot = /googleBot:\s*\{([^}]*)\}/.exec(robotsBlock);
  assert.ok(googleBot, 'googleBot 要单独再写一遍 —— Google 对自家 bot 认这一支');
  assert.ok(/index:\s*false/.test(googleBot[1]), 'googleBot.index 必须 false');
  assert.ok(!/(?<![a-zA-Z])index:\s*true/.test(googleBot[1]), 'googleBot 里不许 index: true(noimageindex: true 不算)');
}

// ── ④ 三处口径必须一致 ────────────────────────────────────────────────────
//
// 最坏的情况不是漏了一处,而是**三处互相打架**:响应头说 noindex、meta 说 index。
// 爬虫按哪个来是它自己的事,而我们连自己想要什么都没说清楚。
{
  const cfg = read('next.config.js');
  const layout = read('app/layout.tsx');
  const headerSaysNoIndex = /key: 'X-Robots-Tag', value: '[^']*noindex/.test(cfg);
  // 同上:只看**顶层**那个 index,别被 googleBot 里的同名字段蒙混过去。
  const block = layout.slice(layout.indexOf('robots: {'));
  const metaSaysNoIndex = /index:\s*false/.test(block.slice(0, block.indexOf('googleBot')));
  assert.equal(headerSaysNoIndex, metaSaysNoIndex, '响应头和 meta 必须说同一件事,不许一个 noindex 一个 index');
}

console.log('no-search-index: OK(响应头全站 noindex / robots.txt 刻意放行好让旧条目撤得掉 / meta 纵深 / 三处口径一致)');
