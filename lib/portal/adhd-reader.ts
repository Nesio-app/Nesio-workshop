/**
 * ADHD 脱水阅读引擎(批次 26)——移植自 reading-ios/web/import.js。
 *
 * 把任意长文(邮件正文、微信文章、粘贴文本、上传文件)切成「神经友好」短行:
 * 每行不超过 MAX_UNITS 个视觉单位,只含一个逻辑要点;
 * 动作句(练习/画出/Step…)打 ⚡ 标;公式单独成卡。
 * reading-ios 里是挂在 window 上的 IIFE,这里改成纯 TS 模块,浏览器/SSR 皆可 import。
 *
 * epub 解压走 fflate(仓里已有的纯 JS 依赖),pdf 走 lib/portal/pdfjs-loader.ts。
 * 2026-07-29 之前这两个库是用 <script src="https://cdn.jsdelivr.net/..."> 现加载的,
 * 而 next.config.js 的 CSP `script-src` 只放行 'self' 和 cdn.plaid.com ——
 * 也就是说**线上导入 EPUB/PDF 一直是失败的**(本机 dev 不带 CSP,所以本地测起来一切正常)。
 */

import { unzip, strFromU8 } from 'fflate';
import { openPdf, groupItemsIntoLines } from './pdfjs-loader';

export interface ReadingLine {
  text?: string;
  tag?: string;
  kind?: 'normal' | 'action' | 'math' | 'formula';
  formula?: string;
  bubble?: string;
}

export interface ReaderSection {
  title: string;
  lines: ReadingLine[];
}

export interface ReaderChapter {
  title: string;
  sections: ReaderSection[];
}

export interface ReaderBook {
  id: string;
  title: string;
  author: string;
  category: string;
  spine: { gradient: string; label: string };
  chapters: ReaderChapter[];
  imported?: boolean;
  format?: string;
  addedAt?: number;
}

const MAX_UNITS = 42;
const MAX_FILE_MB = 48;

const ACTION_RE = /^(练习|注意|步骤|Exercise|Note:|Tip:|Try:|Practice:|画出|标出|写下|Step\s*\d|⚡)/i;
const CHAPTER_RE =
  /^(第[一二三四五六七八九十百千零\d]+[章篇节部回]|[Cc]hapter\s+\d+|[Pp]art\s+\d+|#{1,3}\s+\S)/;
const FORMULA_RE = /^[\s=+\-∑∫√Δ\\^_{}()[\].0-9a-zA-Z%]{4,}$/;

/**
 * 这一行是章节标题吗?
 *
 * 光看「以第X章开头」是不够的:中文正文里「第二章开始,他记录了每天被打断的次数。」
 * 同样以「第二章」开头。原来的判据还更松(以「第」开头且短于 40 字就算标题),于是
 * 「第二段接着讲……」这类**正文句子**被当成章名 —— 而标题分支是不保留正文的,
 * 那句话就整句消失了。中文书里以「第」开头的句子太常见,这个漏字是成片的。
 *
 * 加一条几乎不会错的负判据:**标题不以句末标点收尾**。
 */
function looksLikeHeading(line: string): boolean {
  const s = line.trim();
  if (!s || !CHAPTER_RE.test(s)) return false;
  if (/[。！？!?,，;；:：]$/.test(s)) return false;
  return measureUnits(s) <= 80;
}

/** 中日韩全角字符按 2 个视觉单位计,其余按 1。 */
function measureUnits(s: string): number {
  let w = 0;
  for (const c of s) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c) ? 2 : 1;
  }
  return w;
}

function normalizeText(raw: string): string {
  return String(raw || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 块级标签:它们之间必须留出段落边界。 */
const BLOCK_TAGS = 'p,div,section,article,blockquote,pre,figure,li,tr,h1,h2,h3,h4,h5,h6';

function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') {
    // SSR 兜底:粗暴去标签(块级标签先换成空行,理由同下)
    return normalizeText(
      html
        .replace(new RegExp(`</(${BLOCK_TAGS.replace(/,/g, '|')})>`, 'gi'), '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    );
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer').forEach((n) => n.remove());
  // textContent 会把所有文字**首尾相接**地拼出来,一个换行都没有。
  // 很多 epub/网页的 XHTML 是压成一行生成的(源码里本来就没有换行),于是整章
  // 会塌成一个巨型「段落」;更糟的是它开头往往正是章名,textToAdhdBook 一看
  // 「以第X章开头、只有一行」就把**整章**当成了标题 —— 正文一句都不剩,
  // 最后抛「未能从文件中提取有效段落」。所以先按块级标签补出段落边界。
  doc.querySelectorAll(BLOCK_TAGS).forEach((n) => n.after(doc.createTextNode('\n\n')));
  doc.querySelectorAll('br').forEach((n) => n.after(doc.createTextNode('\n')));
  return normalizeText(doc.body?.textContent || '');
}

function stripMarkdown(md: string): string {
  return normalizeText(
    md
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, ''),
  );
}

/** 把一个段落脱水成若干短行。 */
export function splitToAdhdLines(paragraph: string): ReadingLine[] {
  const p = paragraph.trim();
  if (!p) return [];

  if (FORMULA_RE.test(p) && p.length < 120) {
    return [{ kind: 'formula', formula: p }];
  }

  const isAction = ACTION_RE.test(p);
  const tag = isAction ? '⚡要点' : undefined;
  const kind: ReadingLine['kind'] = isAction ? 'action' : 'normal';

  if (measureUnits(p) <= MAX_UNITS) {
    return [{ text: p, kind, tag }];
  }

  const sentences = p.split(/(?<=[。！？.!?;；:：])\s*/).filter(Boolean);
  const lines: ReadingLine[] = [];

  const pushChunk = (chunk: string) => {
    const c = chunk.trim();
    if (c) lines.push({ text: c, kind, tag: lines.length === 0 ? tag : undefined });
  };

  for (const sent of sentences.length ? sentences : [p]) {
    if (measureUnits(sent) <= MAX_UNITS) {
      pushChunk(sent);
      continue;
    }

    const mostlyLatin = (sent.match(/[a-zA-Z]/g) || []).length > sent.length * 0.35;
    if (mostlyLatin) {
      const words = sent.split(/\s+/);
      let buf = '';
      for (const w of words) {
        const trial = buf ? `${buf} ${w}` : w;
        if (measureUnits(trial) > MAX_UNITS && buf) {
          pushChunk(buf);
          buf = w;
        } else buf = trial;
      }
      pushChunk(buf);
    } else {
      let buf = '';
      for (const c of sent) {
        const trial = buf + c;
        if (measureUnits(trial) > MAX_UNITS && buf) {
          pushChunk(buf);
          buf = c;
        } else buf = trial;
      }
      pushChunk(buf);
    }
  }

  return lines.length ? lines : [{ text: p.slice(0, 80), kind }];
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

const SPINE_HUES: Array<[string, string]> = [
  ['#6b7b8c', '#3d4a56'],
  ['#4A7C5F', '#2D5C42'],
  ['#7B5EA7', '#5C3E8A'],
  ['#2C5F8A', '#1A3A5C'],
  ['#8B5A3C', '#5C3A28'],
];

interface BookMeta {
  id?: string;
  title?: string;
  author?: string;
  format?: string;
}

/** 把整篇正文切章、切段、脱水成 ReaderBook。 */
export function textToAdhdBook(rawText: string, meta: BookMeta): ReaderBook {
  const text = normalizeText(rawText);
  if (!text) throw new Error('文件中没有可阅读的文本');

  const blocks = text.split(/\n\n+/);
  const chapters: ReaderChapter[] = [];
  let current: ReaderChapter = { title: '正文', sections: [{ title: '开始', lines: [] }] };

  const flushChapter = () => {
    const sec = current.sections[0];
    if (sec.lines.length || chapters.length === 0) {
      chapters.push(current);
      return;
    }
    // 一个没有任何正文的「章」,多半是把一句正文误判成了章名。
    // 直接丢掉就是丢字,所以退回成上一章的一行 —— 判据再准也要有这层兜底。
    chapters[chapters.length - 1]?.sections[0].lines.push(...splitToAdhdLines(current.title));
  };

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.split('\n')[0].trim();
    const isHeading = trimmed.split('\n').length <= 2 && looksLikeHeading(firstLine);

    if (isHeading) {
      flushChapter();
      const title = firstLine.replace(/^#+\s*/, '').slice(0, 60);
      const rest = trimmed.slice(firstLine.length).trim().replace(/\n/g, ' ');
      current = { title, sections: [{ title: '开篇', lines: [] }] };
      if (rest) current.sections[0].lines.push(...splitToAdhdLines(rest));
      continue;
    }

    const para = trimmed.replace(/\n/g, ' ');
    current.sections[0].lines.push(...splitToAdhdLines(para));
  }

  flushChapter();

  if (!chapters.some((ch) => ch.sections[0].lines.length)) {
    throw new Error('未能从文件中提取有效段落');
  }
  // 正文从第一个章名开始的书(绝大多数),开头那个占位的「正文」章是空的 ——
  // 留着目录里就有一个点进去什么都没有的条目。
  const withText = chapters.filter((ch) => ch.sections[0].lines.length);
  chapters.length = 0;
  chapters.push(...withText);

  const title = meta.title || '未命名';
  const hue = SPINE_HUES[Math.abs(hashCode(title)) % SPINE_HUES.length];

  return {
    id: meta.id || `import-${Date.now()}`,
    title,
    author: meta.author || '导入',
    category: '我的书架',
    spine: {
      gradient: `linear-gradient(135deg,${hue[0]},${hue[1]})`,
      label: title.slice(0, 2),
    },
    chapters,
    imported: true,
    format: meta.format || 'text',
    addedAt: Date.now(),
  };
}

/** 扁平化所有行,附带章节/小节索引,供渲染层用。 */
export interface FlatLine extends ReadingLine {
  chapterIndex: number;
  sectionIndex: number;
  lineIndex: number;
  chapterTitle: string;
  sectionTitle: string;
}

export function flatLines(book: ReaderBook): FlatLine[] {
  const out: FlatLine[] = [];
  book.chapters.forEach((ch, ci) => {
    ch.sections.forEach((sec, si) => {
      sec.lines.forEach((line, li) => {
        out.push({
          ...line,
          chapterIndex: ci,
          sectionIndex: si,
          lineIndex: li,
          chapterTitle: ch.title,
          sectionTitle: sec.title,
        });
      });
    });
  });
  return out;
}

export function lineCount(book: ReaderBook): number {
  return (book.chapters || []).reduce(
    (n, ch) => n + (ch.sections || []).reduce((m, s) => m + (s.lines || []).length, 0),
    0,
  );
}

function newId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 粘贴文本 → ReaderBook。 */
export function parsePastedText(
  text: string,
  options: { title?: string; author?: string } = {},
): ReaderBook {
  return textToAdhdBook(text, {
    id: newId(),
    title: options.title || '粘贴导入',
    author: options.author || '导入',
    format: 'paste',
  });
}

/* ---------- 文件解析(浏览器专用,epub/pdf 按需加载解析库)---------- */

function extOf(name: string): string {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function titleFromFilename(name: string): string {
  return String(name || '未命名')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 60);
}

function readFileAsText(file: File, encoding = 'UTF-8'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('读取文件失败'));
    r.readAsText(file, encoding);
  });
}

function readFileAsBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error || new Error('读取文件失败'));
    r.readAsArrayBuffer(file);
  });
}

/**
 * 解开 EPUB 的 zip,只取文本类条目。
 *
 * 用 fflate(纯 JS,仓里备份/同步已经在用),异步版跑在 worker 上 ——
 * 一本 40MB 的书同步解压会把主线程钉住好几秒。
 * filter 很重要:带插图的 epub 里九成体积是图片和字体,全解出来是白吃几百 MB 内存,
 * 而我们只要正文 XHTML + 目录(opf/ncx)+ container.xml。
 */
function unzipTextEntries(buffer: ArrayBuffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      { filter: (f) => /\.(x?html?|xml|opf|ncx)$/i.test(f.name) },
      (err, files) => {
        if (err) {
          reject(new Error('无法打开 EPUB:' + (err.message || '文件可能已损坏')));
          return;
        }
        const out: Record<string, string> = {};
        for (const [path, data] of Object.entries(files || {})) out[path] = strFromU8(data);
        resolve(out);
      },
    );
  });
}

async function parseEpub(buffer: ArrayBuffer): Promise<string> {
  const files = await unzipTextEntries(buffer);
  const containerXml = files['META-INF/container.xml'];
  if (!containerXml) throw new Error('无效的 EPUB:缺少 container.xml');

  const rootfile = containerXml.match(/full-path="([^"]+)"/i)?.[1];
  if (!rootfile) throw new Error('无效的 EPUB:无法定位 OPF');

  const opf = files[rootfile];
  if (!opf) throw new Error('无效的 EPUB:无法读取目录');

  const opfDoc = new DOMParser().parseFromString(opf, 'text/xml');
  const manifest: Record<string, string> = {};
  opfDoc.querySelectorAll('manifest > item, package > manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest[id] = href;
  });

  const spineIds = [...opfDoc.querySelectorAll('spine > itemref, package > spine > itemref')].map((n) =>
    n.getAttribute('idref'),
  );

  const base = rootfile.includes('/') ? rootfile.replace(/\/[^/]*$/, '/') : '';
  const resolvePath = (href: string) => {
    if (!href) return '';
    if (href.startsWith('/')) return href.slice(1);
    return base ? `${base}/${href}`.replace(/\/+/g, '/').replace(/([^/]+)\/\.\.\//g, '') : href;
  };

  let out = '';
  const ids = spineIds.length ? spineIds : Object.keys(manifest);
  for (const id of ids) {
    const href = (id && manifest[id]) || id || '';
    if (!/\.(x?html?|xml)$/i.test(href)) continue;
    const path = resolvePath(href);
    const html = files[path];
    if (html) out += htmlToText(html) + '\n\n';
  }

  if (!out.trim()) {
    // spine 解不出来(自制/残缺的 epub)时兜底:所有正文 XHTML 按路径顺序拼。
    const htmlFiles = Object.keys(files).filter((p) => /\.(x?html?)$/i.test(p) && !p.startsWith('__'));
    for (const path of htmlFiles.sort()) out += htmlToText(files[path]) + '\n\n';
  }

  return normalizeText(out);
}

/** 页眉页脚:纯页码那种行。单独成段会在阅读器里变成一张只写着「37」的卡片。 */
const PAGE_FURNITURE_RE = /^(第\s*)?\d{1,4}(\s*\/\s*\d{1,4})?\s*页?$/;

/** 行尾是句末标点 → 一段结束。中文书排版里这条几乎总成立。 */
const SENTENCE_END_RE = /[。！？…!?.](["'」』”)）]*)$/;

/** 拼接两行:中文行之间直接接,英文之间补空格(单词跨行才断开的)。 */
function glueLines(a: string, b: string): string {
  const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
  if (CJK.test(a.slice(-1)) || CJK.test(b.slice(0, 1))) return a + b;
  // 英文行末的连字符是断词符,去掉后直接接上:inter- + national → international
  if (a.endsWith('-')) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/**
 * 把按 y 分好的行还原成段落。
 *
 * PDF 里没有「段落」这个概念,只有行。原来的实现是把整页 `join(' ')` 拍平成一行,
 * 于是整本导入的书只有一个「正文」章 —— 章节标题淹在正文中间,目录是空的。
 * 这里用两条最稳的线索还原段落边界:
 *   · 行末是句末标点;
 *   · 行明显短于本页正常行宽(段末不满行,或本来就是标题)。
 * 判错的代价很小 —— 阅读器接着就要把每段再切成 ≤42 视觉单位的短行。
 */
function linesToParagraphs(lines: readonly string[]): string[] {
  const body = lines.map((l) => l.trim()).filter((l) => l && !PAGE_FURNITURE_RE.test(l));
  if (!body.length) return [];
  const widths = body.map(measureUnits).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] || 0;

  const paras: string[] = [];
  let buf = '';
  const flush = () => {
    const s = buf.trim();
    if (s) paras.push(s);
    buf = '';
  };
  for (const line of body) {
    if (looksLikeHeading(line)) {
      flush();
      paras.push(line); // 标题自己一段,textToAdhdBook 才认得出是章
      continue;
    }
    buf = buf ? glueLines(buf, line) : line;
    if (SENTENCE_END_RE.test(line) || measureUnits(line) < median * 0.75) flush();
  }
  flush();
  return paras;
}

async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  const pdf = await openPdf(buffer);
  const paragraphs: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // 逐页分行 → 分段。**不能**直接 join(' '):pdf.js 给的是散落的文字块加坐标,
    // 拍平之后表格/多栏会串行,而且整页变成一个巨型段落。
    paragraphs.push(...linesToParagraphs(groupItemsIntoLines(content.items)));
  }
  const text = normalizeText(paragraphs.join('\n\n'));
  if (!text) {
    // 扫描件(整页是一张图)走到这里。说清楚是哪种情况,别让用户以为是文件坏了。
    throw new Error('这份 PDF 里没有文字层(像是扫描件),暂时读不出文字');
  }
  return text;
}

async function extractTextFromFile(file: File): Promise<string> {
  const ext = extOf(file.name);

  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`文件超过 ${MAX_FILE_MB}MB 上限`);
  }

  switch (ext) {
    case 'txt':
    case 'text':
    case 'md':
    case 'markdown':
    case 'csv':
    case 'log':
    case 'json':
    case 'xml':
    case 'srt':
    case 'vtt': {
      let raw = await readFileAsText(file);
      if (ext === 'json') {
        try {
          const j = JSON.parse(raw);
          raw = typeof j === 'string' ? j : JSON.stringify(j, null, 2);
        } catch {
          /* 非 JSON 就按原文 */
        }
      }
      return ext === 'md' || ext === 'markdown' ? stripMarkdown(raw) : normalizeText(raw);
    }
    case 'html':
    case 'htm':
      return htmlToText(await readFileAsText(file));
    case 'epub':
      return parseEpub(await readFileAsBuffer(file));
    case 'pdf':
      return parsePdf(await readFileAsBuffer(file));
    default: {
      const asText = await readFileAsText(file);
      if (asText && (/[\u4e00-\u9fff]/.test(asText) || /[a-zA-Z]{4,}/.test(asText))) {
        return normalizeText(asText);
      }
      throw new Error(`暂不支持 .${ext || '未知'} 格式,请尝试 TXT / MD / EPUB / PDF / HTML`);
    }
  }
}

/** 文件 → ReaderBook。 */
export async function parseFile(
  file: File,
  options: { title?: string; author?: string } = {},
): Promise<ReaderBook> {
  const raw = await extractTextFromFile(file);
  return textToAdhdBook(raw, {
    id: newId(),
    title: options.title || titleFromFilename(file.name),
    author: options.author || '导入',
    format: extOf(file.name) || 'text',
  });
}

export const SUPPORTED_FORMATS = 'TXT · MD · HTML · EPUB · PDF · JSON · 粘贴文本';
export const MAX_IMPORT_MB = MAX_FILE_MB;
