/**
 * lab-pdf — 化验单 PDF → 文字行(健康镜头 B 屏,2026-07-29 第二批)。
 *
 * 用户问「拍化验单也可以是识别上传的 pdf 么」。能,而且**对多数化验单比拍照更好**:
 * 医院/体检中心出的 PDF 基本都带文字层,直接把文字读出来就行 ——
 *   · 零 OCR 误差(拍照识别会把 0/O、1/l、5/S 认混,而化验值差一位数就是另一回事);
 *   · 不依赖端上 Vision,**网页端也能用**,也不用等重出 IPA;
 *   · 一样零上传:pdf.js 在浏览器里跑,文件从头到尾没离开这台设备。
 * 只有**扫描件**(整页就是一张图的 PDF)才需要渲染成图再走 Vision。
 *
 * ── 这里最容易做错的一件事 ───────────────────────────────────────────────────
 * pdf.js 的 getTextContent() 给的不是「行」,是一堆**散落的文字块**加各自的坐标。
 * 仓里已有的阅读器(lib/portal/adhd-reader.ts)是 `items.map(it => it.str).join(' ')` ——
 * 对连续正文没问题,对化验单是灾难:整页会被拍平成一行,
 *   「白细胞计数 5.6 10^9/L 3.5-9.5 中性粒细胞 3.1 ...」
 * 而 lab-parse 是**按行**解析的(一行 = 一个指标),拍平之后一条都解不出来。
 * 所以这里必须按 y 坐标重新分行、行内按 x 排序 —— 和 Swift 那边 Vision 的行合并
 * 是同一件事,只是坐标系反了(PDF 的 y 向上,Vision 的 y 向下)。
 *
 * ── 为什么不用 CDN 加载 pdf.js ────────────────────────────────────────────────
 * next.config.js 的 CSP 里 script-src 只放行 'self' 和 cdn.plaid.com。
 * adhd-reader 那套 `loadScript('https://cdn.jsdelivr.net/...')` 在生产上会被直接拦掉。
 * 所以这里走 npm 依赖 + 动态 import(打进自己的 chunk,按需加载,离线也能用)。
 *
 * 契约:scripts/lab-pdf.test.mjs(分行逻辑是纯函数,可直接单测)。
 */

/** pdf.js 的 TextItem 里我们用得到的那几个字段(不引它的类型,免得把整包拖进类型图)。 */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, e, f];e = x,f = y。y 在 PDF 坐标系里**向上**增长。 */
  transform: number[];
  width?: number;
}

export type LabPdfRead =
  | { kind: 'text'; lines: string[]; pages: number }
  | { kind: 'scanned'; images: string[]; pages: number };

/** 页数上限。化验单没有 30 页的;定这个是防止有人误传一本 PDF 书把内存吃光。 */
export const MAX_PDF_PAGES = 30;
/** 扫描件渲染上限 —— 每页都渲染成图再逐张 OCR 很慢,先做前几页。 */
export const MAX_SCAN_PAGES = 6;

/**
 * 把一页的文字块按 y 重新分成行,行内按 x 从左到右拼。
 *
 * @param tolerance 同一行的 y 容差(pt)。给 2.5:小于半个字高。
 *   太小 → 同一行里字号略有差异的块(比如加粗的「↑」)会被拆成两行;
 *   太大 → 上下两行会被并成一行,参考区间和结果值混在一起,解析必错。
 *
 * 纯函数,不碰 pdf.js —— 所以可以直接喂假数据单测。
 */
export function groupItemsIntoLines(items: readonly PdfTextItem[], tolerance = 2.5): string[] {
  const rows: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = [];
  for (const it of items) {
    const s = typeof it.str === 'string' ? it.str : '';
    if (!s.trim()) continue;
    const t = it.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const x = t[4];
    const y = t[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.parts.push({ x, s });
    else rows.push({ y, parts: [{ x, s }] });
  }
  return rows
    // PDF 的 y 向上,所以**降序**才是从上到下(写成升序会把整张化验单读反 —— 表头跑到最后)
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts
      .sort((a, b) => a.x - b.x)
      // 块之间补一个空格:pdf.js 常把「5.6」和「mmol/L」拆成两块,不补就粘成「5.6mmol/L」,
      // 而 lab-parse 找单位靠的是空白边界。多余的空格由 lab-parse 自己吸收。
      .map((p) => p.s.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean);
}

/**
 * 判断这份 PDF 是「有文字层」还是「扫描件」。
 *
 * 判据是**每页平均可见字符数**,不是「有没有文字」—— 扫描件也常带一两行水印/页码文字层,
 * 只看有无会把扫描件误判成文字版,然后解析出零条指标、还怪用户拍得不好。
 */
export function looksLikeTextLayer(lines: readonly string[], pages: number): boolean {
  const chars = lines.join('').replace(/\s/g, '').length;
  return pages > 0 && chars / pages >= 40;
}

/** cmaps / standard_fonts 的下发路径。同源,受 CSP 的 'self' 允许。 */
const PDF_ASSET_BASE = '/pdfjs';

/**
 * pdf.js 的接口面 —— 只声明这里真正用到的那几个成员。
 * 刻意不 import 它自带的类型:那会把整包类型图拖进构建,而这个模块是动态加载的。
 * (仓里 adhd-reader.ts 用的是 `any` + eslint-disable,但那条 disable 引用的规则
 *  在本仓 eslint 配置里根本不存在 → 反而报 error。别把那个模式复制过来。)
 */
interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage> }
interface PdfJs {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(opts: Record<string, unknown>): { promise: Promise<PdfDoc> };
}

let libPromise: Promise<PdfJs> | null = null;
async function loadPdfJs(): Promise<PdfJs> {
  if (!libPromise) {
    libPromise = import('pdfjs-dist').then((mod) => {
      const lib = mod as unknown as PdfJs;
      // worker 也来自本包(CSP 的 worker-src 允许 'self' 与 blob:)。
      if (lib.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
      }
      return lib;
    });
  }
  return libPromise;
}

/**
 * 读一份化验单 PDF。
 * 有文字层 → 直接给行(最好的情况,零 OCR);
 * 扫描件   → 渲染成 PNG dataURL,交给调用方送去端上 Vision。
 *
 * 全程本机:pdf.js 在浏览器里解析,不发一个字节出去。
 */
export async function readLabPdf(file: File | Blob): Promise<LabPdfRead> {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({
    data: new Uint8Array(buf),
    // ⚠️ CMap 是**中文 PDF 的命门**,不是可选优化。
    // pdf.js 解 CID-keyed(中日韩)字体要查 CMap 表;不给的话 getTextContent()
    // 返回**零个文字块** —— 不报错、不抛异常,就是什么都没有。上层于是把一份
    // 好端端的文字版中文化验单判成「扫描件」,推去端上 OCR(而端上还得先重出 IPA)。
    // 2026-07-29 实测:不带这两行时,一份带文字层的中文化验单提取出 0 个字符。
    // 资源随包下发在 public/pdfjs/(scripts/sync-pdfjs-assets.mjs 同步)——
    // 不能走 CDN:CSP 的 connect-src 不放行,而且离线就废了。
    cMapUrl: `${PDF_ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSET_BASE}/standard_fonts/`,
    // 化验单不需要执行 PDF 里的脚本/表单逻辑,关掉少一个攻击面。
    isEvalSupported: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
  }).promise;

  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const lines: string[] = [];
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    lines.push(...groupItemsIntoLines(content.items));
  }

  if (looksLikeTextLayer(lines, pages)) return { kind: 'text', lines, pages };

  // 扫描件:渲染成图。2 倍缩放 —— 1 倍下小字 OCR 掉字率明显更高。
  const images: string[] = [];
  const scanPages = Math.min(pages, MAX_SCAN_PAGES);
  for (let i = 1; i <= scanPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
  }
  return { kind: 'scanned', images, pages };
}
