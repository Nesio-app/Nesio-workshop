/**
 * 行为契约:化验单 PDF 读取(lib/health/lab-pdf.ts)+ 聊天图片缩略图(标注 A9-a)。
 *
 * PDF 这条路真正会出错、而且**出错了看起来毫无异样**的地方只有一个:分行。
 * pdf.js 给的是散落的文字块 + 坐标,不是行。合错了不会报错,只会:
 *   · 全拍平成一行 → lab-parse 一条也解不出来,用户以为「这 PDF 不支持」;
 *   · 上下行并成一行 → 参考区间和结果值混在一起,解析出**错误的偏高/偏低**。
 *     这比解不出来糟得多 —— 是医疗数据。
 * 所以这份测试的主体就是分行,拿真实化验单的坐标形状喂。
 *
 * 渲染/加载那半段碰 pdf.js 和 canvas,留给真机;这里只钉住纯逻辑与接线。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = stripComments;

const SRC = read('lib/health/lab-pdf.ts');
const CODE = strip(SRC);
// pdf.js 的加载 + CMap 配置 + 分行,2026-07-29 收到这一份里(阅读器导入也走它)。
const LOADER = read('lib/portal/pdfjs-loader.ts');
const LOADER_CODE = strip(LOADER);

// ── 纯函数:把不碰 DOM 的那几段抽出来跑 ────────────────────────────────────
/** 边界用**代码标识符**,不用注释/指令 —— 指令是会被清掉的(2026-07-29 就清过一次:
 *  原来切到 `/* eslint-disable`,去掉那条 disable 之后这条测试当场炸)。 */
function slice(src, startMark, endMark, why) {
  const start = src.indexOf(startMark);
  const end = endMark ? src.indexOf(endMark) : src.length;
  assert.ok(start > 0 && end > start, `${why} 结构变了,这条测试要跟着改`);
  return src.slice(start, end);
}
function loadPure() {
  const src = [
    // 起点是 groupItemsIntoRows 而不是 groupItemsIntoLines —— 后者现在是前者的薄封装
    // (2026-07-30 加了带坐标的版本给 statement 解析用,全仓仍只有一套分行逻辑)。
    // 从 Lines 切会漏掉它依赖的 Rows,当场 ReferenceError。
    slice(LOADER, 'export function groupItemsIntoRows', null, 'pdfjs-loader.ts'),
    slice(SRC, 'export function looksLikeTextLayer', 'export async function readLabPdf', 'lab-pdf.ts'),
  ].join('\n');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, Number, Array, Object, String });
  return mod.exports;
}
const M = loadPure();

/** 造一个 pdf.js 形状的文字块。y 在 PDF 坐标系里向上。 */
const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

// ── ① 分行:同一行的块要合起来,按 x 从左到右 ──────────────────────────────
{
  // 一张化验单的典型形状:项目名 / 结果 / 单位 / 参考区间 分散成四个块
  const items = [
    item('参考区间', 300, 700), item('单位', 240, 700), item('结果', 180, 700), item('项目', 60, 700),
    item('3.5-9.5', 300, 680), item('10^9/L', 240, 680), item('5.6', 180, 680), item('白细胞计数', 60, 680),
    item('130-175', 300, 660), item('g/L', 240, 660), item('142', 180, 660), item('血红蛋白', 60, 660),
  ];
  const lines = M.groupItemsIntoLines(items);
  assert.equal(lines.length, 3, `应该是 3 行,得到 ${lines.length}:${JSON.stringify(lines)}`);
  assert.equal(lines[0], '项目 结果 单位 参考区间', `行内没有按 x 排序:${lines[0]}`);
  assert.equal(lines[1], '白细胞计数 5.6 10^9/L 3.5-9.5');
  assert.equal(lines[2], '血红蛋白 142 g/L 130-175');
}

// ── ② 顺序:PDF 的 y 向上,必须**降序**才是从上到下 ─────────────────────────
// 写成升序不会报错,只会把整张单子读反(表头跑到最后)。日期/姓名的过滤全在前面几行,
// 反了之后表头行会混进指标区。
{
  const lines = M.groupItemsIntoLines([item('第三行', 10, 100), item('第一行', 10, 300), item('第二行', 10, 200)]);
  assert.deepEqual([...lines], ['第一行', '第二行', '第三行'], `行序反了:${JSON.stringify(lines)}`);
}

// ── ③ 容差:同一行的微小 y 抖动要并进来,相邻行不能被并掉 ───────────────────
{
  // 同行 1.2pt 抖动(加粗的箭头标记常见)→ 必须是一行
  const same = M.groupItemsIntoLines([item('5.6', 180, 680), item('↑', 220, 681.2), item('白细胞', 60, 680)]);
  assert.equal(same.length, 1, `同一行被拆开了:${JSON.stringify(same)}`);
  assert.equal(same[0], '白细胞 5.6 ↑');

  // 相邻两行间距 12pt(常见行高)→ 绝不能并成一行
  const two = M.groupItemsIntoLines([item('白细胞 5.6', 60, 680), item('血红蛋白 142', 60, 668)]);
  assert.equal(two.length, 2, `相邻两行被并了 —— 参考区间会跑到别的指标上:${JSON.stringify(two)}`);
}

// ── ④ 脏数据不许把它弄崩 ─────────────────────────────────────────────────
{
  assert.equal(M.groupItemsIntoLines([]).length, 0);
  assert.equal(M.groupItemsIntoLines([item('   ', 10, 10)]).length, 0, '纯空白块不该造出空行');
  // transform 缺失/含 NaN:跳过,不抛
  assert.equal(M.groupItemsIntoLines([{ str: 'x' }, { str: 'y', transform: [1, 0, 0, 1, NaN, 10] }]).length, 0);
}

// ── ⑤ 文字层 vs 扫描件的判据 ─────────────────────────────────────────────
// 只看「有没有文字」会把扫描件误判成文字版:扫描件也常带页码/水印的文字层,
// 然后解析出零条指标,还倒过来怪用户拍得不好。所以按**每页平均字符数**判。
{
  assert.equal(M.looksLikeTextLayer(['第 1 页'], 1), false, '只有页码的扫描件被当成文字版了');
  const dense = Array.from({ length: 20 }, (_, i) => `指标${i} 5.6 mmol/L 3.9-6.1`);
  assert.equal(M.looksLikeTextLayer(dense, 1), true);
  assert.equal(M.looksLikeTextLayer([], 0), false, '零页不该判成有文字层');
}

// ── ⑥ 接线:PDF 这条路必须真的接进了识别屏 ─────────────────────────────────
{
  const sheet = strip(read('components/portal/health/LabScanSheet.tsx'));
  assert.match(sheet, /readLabPdf\(/, 'LabScanSheet 没有调 readLabPdf —— PDF 入口是死的');
  assert.match(sheet, /accept="application\/pdf/, '文件选择框不收 PDF');
  // 带 capture 的 input 在手机上直接开相机,选不到 PDF —— 必须另有一个不带 capture 的
  assert.ok(
    /<input[^>]*ref=\{pdfRef\}[^>]*>/.test(sheet) && !/<input[^>]*ref=\{pdfRef\}[^>]*capture=/.test(sheet),
    '选 PDF 的那个 input 不能带 capture(带了会直接开相机,永远选不到文件)',
  );
  // 有文字层就**不许**再去调端上识别 —— 那是这条路全部的价值(零 OCR 误差 + 不依赖 IPA)
  assert.match(
    sheet, /kind === 'text'[^\n]*finishWithText/,
    '有文字层的 PDF 没有直接走解析 —— 又绕回 OCR 的话,PDF 支持就只剩「能选文件」这点好处',
  );
}

// ── ⑦ 不许悄悄改成上传 ───────────────────────────────────────────────────
// 这是化验单。整条路的前提是「文件不离开这台设备」。
{
  assert.ok(!/fetch\s*\(/.test(CODE), 'lab-pdf 里出现了 fetch —— 化验单必须全程本机');
  // CDN 加载在生产会被 CSP 拦掉(script-src 只放行 self 和 cdn.plaid.com),
  // 而且那也等于把解析依赖挂在外部主机上。必须走 npm 依赖。
  for (const [name, c] of [['lab-pdf', CODE], ['pdfjs-loader', LOADER_CODE]]) {
    assert.ok(!/https?:\/\/cdn\./.test(c), `${name} 从 CDN 拉解析库 —— CSP 会拦,而且离线不可用`);
  }
  assert.match(LOADER_CODE, /import\('pdfjs-dist'\)/, 'pdf.js 必须是动态 import 的本地依赖');
  // 化验单这条路必须经 openPdf 打开 —— 自己拼 getDocument 参数就会漏掉下面那几行 CMap。
  assert.match(CODE, /openPdf\(/, 'lab-pdf 没走统一的 openPdf,CMap 配置会漏');

  // ── CMap:中文 PDF 的命门,不是可选优化 ──────────────────────────────────
  // 2026-07-29 实测(真机跑出来的,不是推的):不传 cMapUrl 时,一份**带文字层**的
  // 中文化验单 getTextContent() 返回 0 个文字块 —— 不报错、不抛异常。
  // 上层于是把它判成「扫描件」,推给端上 OCR(而端上还得先重出 IPA)。
  // 也就是说:少这一行,这个功能对中文用户等于完全不可用,而且**看不出是坏的**。
  assert.match(LOADER_CODE, /cMapUrl:/, '没传 cMapUrl —— 中文 PDF 会提取出 0 个字,然后被误判成扫描件');
  assert.match(LOADER_CODE, /cMapPacked:\s*true/, 'cMapPacked 必须为 true(下发的是 .bcmap 二进制表)');
  assert.match(LOADER_CODE, /standardFontDataUrl:/, '缺 standardFontDataUrl,内嵌标准字体的 PDF 会掉字');
  // 资源必须真的躺在 public/ 里 —— 只写路径不带文件,线上就是一串 404,
  // 表现和「没传 cMapUrl」一模一样。
  const cmapDir = new URL('../public/pdfjs/cmaps', import.meta.url);
  assert.ok(fs.existsSync(cmapDir), 'public/pdfjs/cmaps 不存在 —— 跑 node scripts/sync-pdfjs-assets.mjs');
  const cmaps = fs.readdirSync(cmapDir);
  assert.ok(cmaps.length > 100, `cmaps 只有 ${cmaps.length} 个文件,像是没同步全`);
  for (const must of ['UniGB-UCS2-H.bcmap', 'GBK-EUC-H.bcmap']) {
    assert.ok(cmaps.includes(must), `缺 ${must} —— 简中 PDF 的常用编码表`);
  }
  assert.ok(fs.existsSync(new URL('../public/pdfjs/standard_fonts', import.meta.url)), 'standard_fonts 没同步');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['pdfjs-dist'], 'pdfjs-dist 不在 dependencies 里 —— 生产构建会缺');
}

// ── ⑧ A9-a:发出去的图要在气泡里看得见,而且不能撑爆聊天历史 ────────────────
{
  const chat = read('components/portal/NesioChatSheet.tsx')
    .split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
  assert.match(chat, /imageThumb\?:\s*string/, 'UiMessage 上没有缩略图字段');
  assert.match(chat, /className="nesio-chat-sent-thumb"/, '气泡里没有渲染缩略图');
  assert.match(read('app/globals.css'), /\.nesio-chat-sent-thumb\s*\{/, '缩略图样式没了 —— 会按原始像素撑破气泡');

  // 两条取图路径(相册 / 拍摄)都要挂上,少一条就有一半场景还是纯文字占位
  assert.ok(
    (chat.match(/makeThumb\(/g) || []).length >= 3,
    'makeThumb 的调用点少于「定义 + 相册 + 拍摄」三处 —— 有一条路的图还是显示不出来',
  );
  // **必须缩**:直接把原图 dataURL 塞进历史会撑爆 localStorage,
  // 而 saveHistory 的 catch 是静默的 —— 表现是「聊天记录突然不保存了」,极难查。
  //
  // 断言必须**框在 makeThumb 函数体里**:第一版写成全文件搜 toDataURL('image/jpeg', 0.x),
  // 结果被 CameraView.capture() 里那句无关的 0.8 喂饱了 —— 把 makeThumb 的压缩整个删掉
  // 测试照样绿(变异测试抓到的)。
  const thumbFn = (() => {
    const at = chat.indexOf('function makeThumb');
    assert.ok(at > 0, 'makeThumb 不见了 —— 缩略图会按原图存进聊天历史');
    const end = chat.indexOf('\nfunction ', at + 10);
    return chat.slice(at, end > at ? end : at + 2000);
  })();
  assert.match(thumbFn, /toDataURL\('image\/jpeg',\s*0?\.\d+\)/, 'makeThumb 没有压缩就存了');
  // 光断言「有 canvas.width =」不够 —— 写成 `canvas.width = img.width` 照样通过(又抓到一次)。
  // 要的是**宽高真的按 scale 算出来**。
  assert.match(
    thumbFn, /canvas\.width\s*=[^;]*\bscale\b/,
    'makeThumb 的画布宽度没有按缩放比算 —— 只压画质、不缩尺寸,省不下几倍,照样会撑爆配额',
  );
  assert.match(thumbFn, /canvas\.height\s*=[^;]*\bscale\b/, 'makeThumb 的画布高度没有按缩放比算');
  assert.match(thumbFn, /Math\.min\(1,\s*THUMB_PX/, 'scale 没有以 THUMB_PX 封顶(小图会被放大)');
  assert.match(chat, /const THUMB_PX = \d{2,3};/, '缩略图没有尺寸上限');
  const px = Number(/const THUMB_PX = (\d+);/.exec(chat)?.[1]);
  assert.ok(px > 0 && px <= 320, `THUMB_PX=${px} 太大 —— 聊天历史整条进 localStorage,图不能按原尺寸存`);
}

console.log('lab-pdf: OK(分行 · 行序 · 容差 · 文字层判据 · 接线 · 全程本机 · A9-a 缩略图)');
