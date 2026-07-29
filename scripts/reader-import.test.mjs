/**
 * 行为契约:阅读器导入(lib/portal/adhd-reader.ts)。
 *
 * 2026-07-29 修的是一个**只在生产出现**的 bug:EPUB/PDF 的解析库原来是现场
 * `<script src="https://cdn.jsdelivr.net/...">` 拉的,而 next.config.js 的 CSP
 * script-src 只放行 'self' 和 cdn.plaid.com —— 浏览器直接拦掉,用户看到「无法加载解析库」。
 * 本机 dev 不带 CSP,所以这个 bug 在本地怎么测都是好的。这类 bug 只能靠契约锁住。
 *
 * 这里钉三件事:
 *   ① 解析库必须来自 npm 依赖,任何 lib/ 下的模块都不许再用 CDN <script> 加载;
 *   ② EPUB 解压走 fflate,而且**只解文本条目** —— 不过滤的话一本带插图的书会把
 *      几百 MB 图片一起解进内存(48MB 上限的 zip 解开可能是它的好几倍);
 *   ③ PDF 分行→分段。原来是整页 `join(' ')` 拍平成一行,后果是导入的书
 *      永远只有一个「正文」章,章节标题淹在正文里 —— 目录是空的。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = read('lib/portal/adhd-reader.ts');
const CODE = strip(SRC);

/** 边界一律用**代码标识符**:注释和指令会被 strip 掉,拿它们切片迟早断。 */
function slice(startMark, endMark) {
  const start = SRC.indexOf(startMark);
  const end = SRC.indexOf(endMark);
  assert.ok(start > 0 && end > start, `adhd-reader.ts 结构变了(找不到 ${startMark}),这条测试要跟着改`);
  return SRC.slice(start, end);
}

/** 把不碰 DOM 的那几段抽出来真跑。fflate 用真库。 */
function loadPure() {
  const src = [
    slice('const MAX_UNITS', '/** 扁平化所有行'),              // 常量 + 文本处理 + 切章切段
    slice('function unzipTextEntries', 'async function parseEpub'),
    slice('/** 页眉页脚', 'async function parsePdf'),
    'module.exports = { linesToParagraphs, glueLines, unzipTextEntries, PAGE_FURNITURE_RE,'
      + ' textToAdhdBook, htmlToText, looksLikeHeading };',
  ].join('\n');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  // 抽出来的片段不含顶部那句 import,unzip / strFromU8 是自由变量 —— 从这里喂真库进去。
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    Math, Number, Array, Object, String, Promise, Uint8Array, Error, RegExp, JSON, Date,
    unzip: fflate.unzip, strFromU8: fflate.strFromU8,
  });
  return mod.exports;
}
const M = loadPure();

// ── ① 解析库不许再从 CDN 加载 ────────────────────────────────────────────────
{
  assert.ok(
    !/cdn\.jsdelivr|unpkg\.com|cdnjs\./.test(CODE),
    'adhd-reader 又从 CDN 拉解析库了 —— 线上 CSP 直接拦掉,表现是「无法加载解析库」,而本地 dev 一切正常',
  );
  assert.ok(
    !/createElement\('script'\)/.test(CODE),
    'adhd-reader 又在动态插 <script> —— 除 cdn.plaid.com 外的外部脚本一律被 CSP 拦',
  );
  assert.ok(!/JSZip/.test(CODE), 'JSZip 的残留 —— 它是 CDN 全局变量,线上永远是 undefined');
  assert.match(CODE, /from 'fflate'/, 'EPUB 解压没走 fflate(仓里已有的纯 JS 依赖)');
  assert.match(CODE, /from '\.\/pdfjs-loader'/, 'PDF 没走统一的 pdfjs-loader —— CMap 配置会漏,中文 PDF 提取出 0 个字');

  // 全仓兜底:lib/ 下任何模块都不许再长出 CDN 脚本加载。
  // (plaid 是 CSP 白名单里的第三方 SDK,只能在 app/ 与 components/ 出现,故这里只扫 lib/。)
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/https?:\/\/(cdn|unpkg)\./.test(strip(read(rel)))) offenders.push(rel);
    }
  };
  walk('lib');
  assert.equal(offenders.length, 0, `lib/ 下有模块从 CDN 加载资源(CSP 会拦):\n  ${offenders.join('\n  ')}`);
}

// ── ② EPUB:真造一个 zip 解一遍 ───────────────────────────────────────────────
{
  const epub = fflate.zipSync({
    'mimetype': fflate.strToU8('application/epub+zip'),
    'META-INF/container.xml': fflate.strToU8('<container><rootfile full-path="OEBPS/book.opf"/></container>'),
    'OEBPS/book.opf': fflate.strToU8('<package><manifest/></package>'),
    'OEBPS/ch1.xhtml': fflate.strToU8('<html><body><p>第一章</p></body></html>'),
    // 一本真书里体积几乎全在这类文件上 —— 必须被 filter 挡掉,否则 48MB 的 epub
    // 解开就是几百 MB 常驻内存,手机上直接被系统杀掉。
    'OEBPS/images/cover.jpg': new Uint8Array(2048),
    'OEBPS/fonts/song.ttf': new Uint8Array(4096),
  });
  const files = await M.unzipTextEntries(epub.buffer.slice(epub.byteOffset, epub.byteOffset + epub.byteLength));
  const keys = Object.keys(files).sort();
  assert.deepEqual(
    keys, ['META-INF/container.xml', 'OEBPS/book.opf', 'OEBPS/ch1.xhtml'],
    `解出来的条目不对(${keys.join(' ')})—— 少了 container.xml/opf 就打不开书,多了图片/字体就是白吃内存`,
  );
  assert.match(files['OEBPS/ch1.xhtml'], /第一章/, '解出来的中文乱了 —— strFromU8 要按 UTF-8 解');
}

// ── ③ PDF:行 → 段落 ────────────────────────────────────────────────────────
{
  // 一页书的典型形状:一个**带副标题的长章名** + 三段正文 + 页码。
  // 章名故意写长(≈ 正常行宽):短标题会被「短行 = 段末」那条规则顺手切开,
  // 于是把 CHAPTER_RE 那条分支整个删掉测试照样绿(变异测试抓到的)。
  // 第二段末行故意**不带标点**,用来钉住「短行也算段末」——否则那条判据可以删掉不被发现。
  const lines = [
    '第三章 在很吵的环境里保持专注的几个办法',
    '这是第一段的第一行文字它写满了整整一行没有断开继续往下走',
    '这是第一段的第二行,到这里句子结束了。',
    '第二段从这里开始也是满满的一行文字继续排下去直到行末为止',
    '这一段的末行没有标点收尾',
    '第三段又是满满一行文字排到行末为止继续往下走没有停顿',
    '最后结束。',
    '37',
  ];
  const paras = M.linesToParagraphs(lines);
  assert.equal(
    paras[0], '第三章 在很吵的环境里保持专注的几个办法',
    '章节标题没有独立成段 —— 导入的书会只有一个「正文」章,目录是空的',
  );
  assert.equal(paras.length, 4, `应该切成「标题 + 三段」,得到 ${paras.length} 段:${JSON.stringify(paras)}`);
  assert.match(paras[1], /第一行文字.*第二行/s, '同一段的两行没有合起来');
  assert.ok(!paras.some((p) => p.includes('37')), '页码被当成正文了 —— 阅读器里会出现一张只写着「37」的卡片');
  // 英文原著:段内两行合并时,跨行的单词不能粘成一个词
  const en = M.linesToParagraphs([
    'The quick brown fox jumps over the lazy dog and keeps',
    'running until it finally stops.',
  ]);
  assert.equal(en.length, 1, `英文段被切开了:${JSON.stringify(en)}`);
  assert.match(en[0], /keeps running/, '英文跨行的两个词粘成了一个 —— 合并时没走 glueLines');

  // 中文行之间不能凭空多出空格
  assert.ok(!/\s/.test(M.glueLines('中文', '接着')), '中文两行拼接时多插了空格');
  // 英文单词跨行:补空格;行末连字符是断词符,要去掉
  assert.equal(M.glueLines('hello', 'world'), 'hello world', '英文两行拼接没补空格,单词会粘连');
  assert.equal(M.glueLines('inter-', 'national'), 'international', '英文断词的连字符没去掉');

  // 全拍平成一行是原来的 bug —— 这里反过来钉一下:整页正文不该塌成 1 段
  assert.ok(M.linesToParagraphs(lines).length > 1, '所有行又被拍平成一段了');
  assert.equal(M.linesToParagraphs([]).length, 0);
  assert.equal(M.linesToParagraphs(['   ', '']).length, 0, '空白行不该造出空段落');
}

// ── ④ 切章:别把正文当成章名吃掉 ───────────────────────────────────────────────
// 下面这几条是**在真浏览器里跑一本真 EPUB 时才暴露出来的**,读代码看不出来:
// 原判据是「以『第』开头且短于 40 字 = 章名」,而中文正文里
// 「第二段接着讲……」「第二天他……」这种句子极常见。被判成章名的那一行,
// 正文一个字都不会留下 —— 是成片的丢字,而且导入还显示成功。
{
  assert.equal(M.looksLikeHeading('第一章 起点'), true, '真章名没被认出来');
  assert.equal(M.looksLikeHeading('第二段接着讲他把手机放进抽屉的那个下午。'), false,
    '以「第」开头的正文句被当成章名 —— 这一句会整句消失');
  assert.equal(M.looksLikeHeading('第二章开始,他记录了每天被打断的次数,并发现了一个规律。'), false,
    '以句末标点收尾的句子不可能是章名');
  // 整段没有标点的正文(PDF 里很常见,标点常被识别成别的字符)不能因为开头两个字就整段变成章名
  assert.equal(
    M.looksLikeHeading('第三章讲的内容包括注意力的生理基础和环境设计的关系以及如何在日常生活里一步步做出改变'),
    false, '一整段被当成章名 —— 标题不该有这么长,而判成标题这段就没了',
  );

  const book = M.textToAdhdBook(
    ['第一章 起点', '这是第一章的正文,写了一段话。', '第二段接着讲他把手机放进抽屉的那个下午。',
      '第二章 转折', '第二章开始,他记录了每天被打断的次数,并发现了一个规律。'].join('\n\n'),
    { title: '专注力' },
  );
  // 比字符串,不比数组:vm 里造的数组原型和这边不是同一个,deepStrictEqual 会假红。
  assert.equal(book.chapters.map((c) => c.title).join(' | '), '第一章 起点 | 第二章 转折',
    `切章不对:${JSON.stringify(book.chapters.map((c) => c.title))}(空的占位章要去掉,正文不能变成章名)`);
  const all = book.chapters.flatMap((c) => c.sections[0].lines.map((l) => l.text || '')).join('');
  for (const must of ['手机放进抽屉', '每天被打断的次数']) {
    assert.ok(all.includes(must), `正文「${must}」在切章时丢了`);
  }

  // 判据再准也要有兜底:一个没有正文的「章」被丢掉时,它那行字不能跟着消失。
  // (真书里连着两行标题很常见 —— 章名 + 副标题。)
  const two = M.textToAdhdBook(['第一章 起点', '第二章 转折', '这里才是正文,前面两行是连着的标题。'].join('\n\n'), {});
  const twoText = two.chapters.map((c) => c.title).join(' ')
    + two.chapters.flatMap((c) => c.sections[0].lines.map((l) => l.text || '')).join('');
  assert.ok(twoText.includes('第一章 起点'), '连着两个标题时,前一个整行消失了 —— 空章不能连字一起丢');
  assert.ok(twoText.includes('这里才是正文'), '正文丢了');
}

// ── ⑤ HTML→文本:块级标签之间必须留出段落边界 ────────────────────────────────
// textContent 是首尾相接的,一个换行都没有。很多 epub 的 XHTML 是压成一行生成的,
// 于是整章塌成一个巨型段落 —— 而它开头恰好是章名,整章就被当成一个标题,
// 正文全丢,最后抛「未能从文件中提取有效段落」。真跑一本 epub 才会撞见。
{
  const text = M.htmlToText('<html><body><h1>第一章 起点</h1><p>第一段。</p><p>第二段。</p></body></html>');
  assert.ok(/第一章 起点\s*\n/.test(text), `标题和正文粘在一起了:${JSON.stringify(text)}`);
  assert.equal(text.split(/\n\n+/).length, 3, `段落边界没还原出来:${JSON.stringify(text)}`);
  // 上面跑的是 SSR 的正则兜底(Node 里没有 DOMParser)。浏览器分支同样要补边界。
  assert.match(CODE, /BLOCK_TAGS\).forEach\(\(n\) => n\.after\(/, '浏览器分支没有给块级标签补段落边界');
}

// ── ⑥ 接线:导入这条路真的调到了新解析 ────────────────────────────────────────
{
  assert.match(CODE, /openPdf\(buffer\)/, 'parsePdf 没走 openPdf');
  assert.match(CODE, /linesToParagraphs\(groupItemsIntoLines\(/, 'PDF 文字块没有先分行再分段(拍平的老写法回来了)');
  // 扫描件读不出字时必须说清楚,不能抛一句含糊的「未能提取有效段落」让用户以为文件坏了
  assert.match(CODE, /没有文字层/, '扫描 PDF 读不出字时没有给出可理解的提示');
}

console.log('reader-import: OK(无 CDN · EPUB 只解文本 · PDF 分行分段 · 接线)');
