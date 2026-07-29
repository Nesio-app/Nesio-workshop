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
 * 直接 `items.map(it => it.str).join(' ')`(阅读器原来就是这么写的)对连续正文还行,
 * 对化验单是灾难:整页会被拍平成一行,
 *   「白细胞计数 5.6 10^9/L 3.5-9.5 中性粒细胞 3.1 ...」
 * 而 lab-parse 是**按行**解析的(一行 = 一个指标),拍平之后一条都解不出来。
 * 所以必须按 y 坐标重新分行、行内按 x 排序 —— 和 Swift 那边 Vision 的行合并
 * 是同一件事,只是坐标系反了(PDF 的 y 向上,Vision 的 y 向下)。
 * 这段逻辑连同 pdf.js 的加载/CMap 配置一起收在 lib/portal/pdfjs-loader.ts,全仓一份。
 *
 * 契约:scripts/lab-pdf.test.mjs。
 */

import { openPdf, groupItemsIntoLines, type PdfTextItem } from '../portal/pdfjs-loader';

export type { PdfTextItem };
export { groupItemsIntoLines };

export type LabPdfRead =
  | { kind: 'text'; lines: string[]; pages: number }
  | { kind: 'scanned'; images: string[]; pages: number };

/** 页数上限。化验单没有 30 页的;定这个是防止有人误传一本 PDF 书把内存吃光。 */
export const MAX_PDF_PAGES = 30;
/** 扫描件渲染上限 —— 每页都渲染成图再逐张 OCR 很慢,先做前几页。 */
export const MAX_SCAN_PAGES = 6;

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

/**
 * 读一份化验单 PDF。
 * 有文字层 → 直接给行(最好的情况,零 OCR);
 * 扫描件   → 渲染成 PNG dataURL,交给调用方送去端上 Vision。
 *
 * 全程本机:pdf.js 在浏览器里解析,不发一个字节出去。
 */
export async function readLabPdf(file: File | Blob): Promise<LabPdfRead> {
  const buf = await file.arrayBuffer();
  const doc = await openPdf(buf);

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
