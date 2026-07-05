/**
 * ADHD 脱水阅读引擎(批次 26)——移植自 reading-ios/web/import.js。
 *
 * 把任意长文(邮件正文、微信文章、粘贴文本、上传文件)切成「神经友好」短行:
 * 每行不超过 MAX_UNITS 个视觉单位,只含一个逻辑要点;
 * 动作句(练习/画出/Step…)打 ⚡ 标;公式单独成卡。
 * reading-ios 里是挂在 window 上的 IIFE,这里改成纯 TS 模块,浏览器/SSR 皆可 import。
 *
 * epub/pdf 解析需要 jszip / pdf.js,按需动态加载 CDN 脚本(仅在浏览器)。
 */

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

function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') {
    // SSR 兜底:粗暴去标签
    return normalizeText(html.replace(/<[^>]+>/g, ' '));
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer').forEach((n) => n.remove());
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
    if (sec.lines.length || chapters.length === 0) chapters.push(current);
  };

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.split('\n')[0].trim();
    const isHeading =
      trimmed.split('\n').length <= 2 &&
      (CHAPTER_RE.test(firstLine) || (firstLine.length < 40 && /^[第#]/.test(firstLine)));

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

let jszipReady: Promise<void> | null = null;
let pdfReady: Promise<void> | null = null;

function loadScript(src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      const wait = setInterval(() => {
        if (ready()) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(wait);
        resolve();
      }, 8000);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('无法加载解析库: ' + src));
    document.head.appendChild(s);
  });
}

function ensureJsZip(): Promise<void> {
  if (!jszipReady) {
    jszipReady = loadScript(
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      () => typeof (globalThis as Record<string, unknown>).JSZip !== 'undefined',
    );
  }
  return jszipReady;
}

function ensurePdfJs(): Promise<void> {
  if (!pdfReady) {
    pdfReady = loadScript(
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      () => typeof (globalThis as Record<string, unknown>).pdfjsLib !== 'undefined',
    );
  }
  return pdfReady;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function parseEpub(buffer: ArrayBuffer): Promise<string> {
  await ensureJsZip();
  const JSZip = (globalThis as any).JSZip;
  const zip = await JSZip.loadAsync(buffer);
  const containerXml: string | undefined = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('无效的 EPUB:缺少 container.xml');

  const rootfile = containerXml.match(/full-path="([^"]+)"/i)?.[1];
  if (!rootfile) throw new Error('无效的 EPUB:无法定位 OPF');

  const opf: string | undefined = await zip.file(rootfile)?.async('text');
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
    const html: string | undefined = await zip.file(path)?.async('text');
    if (html) out += htmlToText(html) + '\n\n';
  }

  if (!out.trim()) {
    const htmlFiles = Object.keys(zip.files).filter((p) => /\.(x?html?)$/i.test(p) && !p.startsWith('__'));
    for (const path of htmlFiles) {
      const html: string | undefined = await zip.file(path)?.async('text');
      if (html) out += htmlToText(html) + '\n\n';
    }
  }

  return normalizeText(out);
}

async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  await ensurePdfJs();
  const lib = (globalThis as any).pdfjsLib;
  if (!lib) throw new Error('PDF 解析库未就绪');

  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const loading = lib.getDocument({ data: buffer, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loading.promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it: any) => it.str).join(' ');
    if (line.trim()) text += line.trim() + '\n\n';
  }

  return normalizeText(text);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
