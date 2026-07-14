/**
 * 行为契约:URL 正文提取(批次193 Readability-lite)。
 * 验证:保留正文 + 关键图片(相对→绝对 marker);去广告/导航/页脚/脚本/图注/图标/追踪像素;过短返回空。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/readability.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), URL, RegExp, Set, Number, Array, String, Math, console });
const { extractArticleText } = mod.exports;

const html = `
<html><head><title>T</title></head><body>
<nav>首页 关于 广告投放 登录</nav>
<script>var x = trackingBeacon();</script>
<article>
  <h2>标题一</h2>
  <p>这是正文第一段,足够长以通过密度与长度门槛,讲述了文章的主要内容与观点脉络。</p>
  <img src="/media/hero.jpg" width="900" height="500" alt="配图">
  <p>这是正文第二段,继续展开论述,补充了更多的细节和背景信息供读者参考对照。</p>
  <img src="https://cdn.example.com/icons/logo-32.png" width="32" height="32">
  <img src="https://t.example.com/pixel/1x1.gif">
  <figcaption>图注:不该进正文</figcaption>
</article>
<footer>版权所有 联系我们</footer>
</body></html>`;

const out = extractArticleText(html, 'https://news.example.com/story');
assert.ok(out.includes('正文第一段') && out.includes('正文第二段'), '保留正文段落');
assert.ok(out.includes('![](https://news.example.com/media/hero.jpg)'), '关键图片转 marker + 相对→绝对');
assert.ok(!out.includes('广告投放') && !out.includes('版权所有') && !out.includes('trackingBeacon'), '去导航/页脚/脚本');
assert.ok(!out.includes('logo-32') && !out.includes('1x1.gif'), '去图标/追踪像素小图');
assert.ok(!out.includes('图注'), '去 figcaption');

assert.equal(extractArticleText('<p>hi</p>', 'https://x.com'), '', '内容过短返回空');

console.log('readability: OK');
