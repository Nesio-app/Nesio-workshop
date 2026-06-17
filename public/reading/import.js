/**
 * 书籍导入：多格式解析 + ADHD 脱水分行 + IndexedDB 存储
 */
(function (global) {
  const DB_NAME = 'neuro_reading_imports';
  const STORE = 'books';
  const MAX_UNITS = 42;
  const MAX_FILE_MB = 48;

  const ACTION_RE = /^(练习|注意|步骤|Exercise|Note:|Tip:|Try:|Practice:|画出|标出|写下|Step\s*\d|⚡)/i;
  const CHAPTER_RE =
    /^(第[一二三四五六七八九十百千零\d]+[章篇节部回]|[Cc]hapter\s+\d+|[Pp]art\s+\d+|#{1,3}\s+\S)/;
  const FORMULA_RE = /^[\s=+\-∑∫√Δ\\^_{}()[\].0-9a-zA-Z%]{4,}$/;

  let jszipReady = null;
  let pdfReady = null;

  function measureUnits(s) {
    let w = 0;
    for (const c of s) {
      w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c) ? 2 : 1;
    }
    return w;
  }

  function loadScript(src, globalCheck) {
    if (globalCheck && globalCheck()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-src="${src}"]`)) {
        const wait = setInterval(() => {
          if (!globalCheck || globalCheck()) {
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

  function ensureJsZip() {
    if (!jszipReady) {
      jszipReady = loadScript(
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
        () => typeof global.JSZip !== 'undefined'
      );
    }
    return jszipReady;
  }

  function ensurePdfJs() {
    if (!pdfReady) {
      pdfReady = loadScript(
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        () => typeof global.pdfjsLib !== 'undefined'
      );
    }
    return pdfReady;
  }

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\uFEFF/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,nav,header,footer').forEach((n) => n.remove());
    return normalizeText(doc.body?.textContent || '');
  }

  function stripMarkdown(md) {
    return normalizeText(
      md
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''))
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, '')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
    );
  }

  function splitToAdhdLines(paragraph) {
    const p = paragraph.trim();
    if (!p) return [];

    if (FORMULA_RE.test(p) && p.length < 120) {
      return [{ kind: 'formula', formula: p }];
    }

    const isAction = ACTION_RE.test(p);
    const tag = isAction ? '⚡要点' : undefined;
    const kind = isAction ? 'action' : 'normal';

    if (measureUnits(p) <= MAX_UNITS) {
      return [{ text: p, kind, tag }];
    }

    const sentences = p.split(/(?<=[。！？.!?;；:：])\s*/).filter(Boolean);
    const lines = [];

    const pushChunk = (chunk) => {
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

  function textToAdhdBook(rawText, meta) {
    const text = normalizeText(rawText);
    if (!text) throw new Error('文件中没有可阅读的文本');

    const blocks = text.split(/\n\n+/);
    const chapters = [];
    let current = { title: '正文', sections: [{ title: '开始', lines: [] }] };

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

    const spineLabel = (meta.title || '书').slice(0, 2);
    const hues = [
      ['#6b7b8c', '#3d4a56'],
      ['#4A7C5F', '#2D5C42'],
      ['#7B5EA7', '#5C3E8A'],
      ['#2C5F8A', '#1A3A5C'],
      ['#8B5A3C', '#5C3A28'],
    ];
    const hue = hues[Math.abs(hashCode(meta.title)) % hues.length];

    return {
      id: meta.id || `import-${Date.now()}`,
      title: meta.title || '未命名',
      author: meta.author || '导入',
      category: '我的书架',
      spine: {
        gradient: `linear-gradient(135deg,${hue[0]},${hue[1]})`,
        label: spineLabel,
      },
      chapters,
      imported: true,
      format: meta.format || 'text',
      addedAt: Date.now(),
    };
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return h;
  }

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function titleFromFilename(name) {
    return String(name || '未命名')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  async function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('读取文件失败'));
      r.readAsText(file, encoding || 'UTF-8');
    });
  }

  async function readFileAsBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('读取文件失败'));
      r.readAsArrayBuffer(file);
    });
  }

  async function parseEpub(buffer) {
    await ensureJsZip();
    const zip = await global.JSZip.loadAsync(buffer);
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    if (!containerXml) throw new Error('无效的 EPUB：缺少 container.xml');

    const rootfile = containerXml.match(/full-path="([^"]+)"/i)?.[1];
    if (!rootfile) throw new Error('无效的 EPUB：无法定位 OPF');

    const opf = await zip.file(rootfile)?.async('text');
    if (!opf) throw new Error('无效的 EPUB：无法读取目录');

    const opfDoc = new DOMParser().parseFromString(opf, 'text/xml');
    const manifest = {};
    opfDoc.querySelectorAll('manifest > item, package > manifest > item').forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) manifest[id] = href;
    });

    const spineIds = [...opfDoc.querySelectorAll('spine > itemref, package > spine > itemref')].map((n) =>
      n.getAttribute('idref')
    );

    const base = rootfile.includes('/') ? rootfile.replace(/\/[^/]*$/, '/') : '';
    const resolvePath = (href) => {
      if (!href) return '';
      if (href.startsWith('/')) return href.slice(1);
      return base ? `${base}/${href}`.replace(/\/+/g, '/').replace(/([^/]+)\/\.\.\//g, '') : href;
    };

    let out = '';
    const ids = spineIds.length ? spineIds : Object.keys(manifest);
    for (const id of ids) {
      const href = manifest[id] || id;
      if (!/\.(x?html?|xml)$/i.test(href)) continue;
      const path = resolvePath(href);
      const html = await zip.file(path)?.async('text');
      if (html) out += htmlToText(html) + '\n\n';
    }

    if (!out.trim()) {
      const htmlFiles = Object.keys(zip.files).filter((p) => /\.(x?html?)$/i.test(p) && !p.startsWith('__'));
      for (const path of htmlFiles) {
        const html = await zip.file(path)?.async('text');
        if (html) out += htmlToText(html) + '\n\n';
      }
    }

    return normalizeText(out);
  }

  async function parsePdf(buffer) {
    await ensurePdfJs();
    const lib = global.pdfjsLib;
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
      const line = content.items.map((it) => it.str).join(' ');
      if (line.trim()) text += line.trim() + '\n\n';
    }

    return normalizeText(text);
  }

  async function extractTextFromFile(file) {
    const ext = extOf(file.name);
    const buf = await readFileAsBuffer(file);

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
          } catch (_) {}
        }
        return ext === 'md' || ext === 'markdown' ? stripMarkdown(raw) : normalizeText(raw);
      }
      case 'html':
      case 'htm':
        return htmlToText(await readFileAsText(file));
      case 'epub':
        return parseEpub(buf);
      case 'pdf':
        return parsePdf(buf);
      default: {
        const asText = await readFileAsText(file);
        if (asText && (/[\u4e00-\u9fff]/.test(asText) || /[a-zA-Z]{4,}/.test(asText))) {
          return normalizeText(asText);
        }
        throw new Error(`暂不支持 .${ext || '未知'} 格式，请尝试 TXT / MD / EPUB / PDF / HTML`);
      }
    }
  }

  async function parseFile(file, options) {
    const opts = options || {};
    const raw = await extractTextFromFile(file);
    const title = opts.title || titleFromFilename(file.name);
    const author = opts.author || '导入';
    const format = extOf(file.name) || 'text';

    return textToAdhdBook(raw, {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      author,
      format,
    });
  }

  function parsePastedText(text, options) {
    const opts = options || {};
    return textToAdhdBook(text, {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: opts.title || '粘贴导入',
      author: opts.author || '导入',
      format: 'paste',
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBook(book) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(book);
      tx.oncomplete = () => resolve(book);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadBooks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteBook(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function lineCount(book) {
    return (book.chapters || []).reduce(
      (n, ch) => n + (ch.sections || []).reduce((m, s) => m + (s.lines || []).length, 0),
      0
    );
  }

  global.BookImport = {
    parseFile,
    parsePastedText,
    textToAdhdBook,
    saveBook,
    loadBooks,
    deleteBook,
    lineCount,
    supportedFormats: 'TXT · MD · HTML · EPUB · PDF · JSON · 粘贴文本',
  };
})(window);
