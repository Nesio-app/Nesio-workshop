/**
 * pdfjs-loader — 全站唯一的 pdf.js 入口(2026-07-29)。
 *
 * 仓里有两处要读 PDF:化验单识别(lib/health/lab-pdf.ts)和阅读器导入(adhd-reader.ts)。
 * 它们原来各写一套加载方式,而阅读器那套是 `<script src="https://cdn.jsdelivr.net/...">` ——
 * **在生产上一直是坏的**:next.config.js 的 CSP `script-src` 只放行 'self' 和 cdn.plaid.com,
 * 那个 <script> 会被浏览器直接拦掉,onerror 触发,用户看到的是「无法加载解析库」。
 * (本机 dev 不带 CSP,所以本地测一切正常 —— 这类 bug 只在生产出现。)
 *
 * 收到这一份的目的不只是去 CDN,更是让下面这三件事**只有一个地方会写错**:
 *   ① CMap —— 中文 PDF 的命门。不传 cMapUrl,getTextContent() 对 CID-keyed(中日韩)
 *      字体返回**零个文字块**,不报错不抛异常。上层于是判成「没有文字层」。
 *      2026-07-29 实测:一份带文字层的中文 PDF,不传时提取 0 字符,传了之后 151 字符。
 *   ② worker 路径 —— 也必须同源(CSP 的 worker-src 是 'self' blob:)。
 *   ③ 分行 —— pdf.js 给的是散落文字块 + 坐标,不是行。见 groupItemsIntoLines。
 *
 * 资源随包下发在 public/pdfjs/(scripts/sync-pdfjs-assets.mjs 同步,挂在 build:server 上)。
 *
 * 契约:scripts/lab-pdf.test.mjs(分行纯函数)、scripts/reader-import.test.mjs(不许再回 CDN)。
 */

/** pdf.js 的 TextItem 里我们用得到的那几个字段(不引它的类型,免得把整包拖进类型图)。 */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, e, f];e = x,f = y。y 在 PDF 坐标系里**向上**增长。 */
  transform: number[];
  width?: number;
}

/**
 * pdf.js 的接口面 —— 只声明这里真正用到的那几个成员。
 * 刻意不 import 它自带的类型:那会把整包类型图拖进构建,而这个模块是动态加载的。
 */
export interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
}
export interface PdfJs {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(opts: Record<string, unknown>): { promise: Promise<PdfDoc> };
}

/** cmaps / standard_fonts 的下发路径。同源,受 CSP 的 'self' 允许。 */
const PDF_ASSET_BASE = '/pdfjs';

let libPromise: Promise<PdfJs> | null = null;

/** 动态 import 本地依赖(自己的 chunk,按需加载,离线也能用)。 */
export async function loadPdfJs(): Promise<PdfJs> {
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
 * 打开一份 PDF。所有调用方都必须走这里,别自己拼 getDocument 参数 ——
 * 漏掉 cMapUrl 的那份对中文 PDF 就是**静默失效**(见文件头 ①)。
 */
export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PdfDoc> {
  const lib = await loadPdfJs();
  return lib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    // ⚠️ CMap 不是可选优化,是中文 PDF 能不能读出字的开关。资源在 public/pdfjs/,
    // 不能走 CDN:CSP 的 connect-src 不放行,而且离线就废了。
    cMapUrl: `${PDF_ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSET_BASE}/standard_fonts/`,
    // 不需要执行 PDF 里的脚本/表单逻辑,关掉少一个攻击面。
    isEvalSupported: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
  }).promise;
}

/**
 * 把一页的文字块按 y 重新分成行,行内按 x 从左到右拼。
 *
 * @param tolerance 同一行的 y 容差(pt)。给 2.5:小于半个字高。
 *   太小 → 同一行里字号略有差异的块(比如加粗的「↑」)会被拆成两行;
 *   太大 → 上下两行会被并成一行(化验单上就是参考区间和结果值混在一起,解析必错)。
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
    // PDF 的 y 向上,所以**降序**才是从上到下(写成升序会把整份文档读反 —— 表头跑到最后)
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts
      .sort((a, b) => a.x - b.x)
      // 块之间补一个空格:pdf.js 常把「5.6」和「mmol/L」拆成两块,不补就粘成「5.6mmol/L」,
      // 而下游找单位/词边界靠的是空白。多余的空格由下游自己吸收。
      .map((p) => p.s.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean);
}
