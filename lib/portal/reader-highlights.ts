/**
 * 阅读器高亮 —— 划词「高亮」/ 底部「圈选(选读)」共用的本地标记存储。
 *
 * 按文档 id 存一组高亮片段(精确子串);渲染时把段落切成 高亮/非高亮 小段套 <mark>。
 * 纯本地(localStorage),无网络、无 AI。切段逻辑纯函数、可单测(不碰 window)。
 * 「功能以现有为准」:这是阅读器唯一新增的小能力,收进记忆/问念念/复制都走现成的。
 */

const KEY = 'nesio-reader-highlights-v1';
export const READER_HIGHLIGHTS_EVENT = 'nesio-reader-highlights-updated';

type Store = Record<string, string[]>;

function loadAll(): Store {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Store; } catch { return {}; }
}

function saveAll(all: Store): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(READER_HIGHLIGHTS_EVENT));
  } catch { /* 配额满就不存,不阻塞阅读 */ }
}

/** 读某文档的全部高亮片段。 */
export function loadHighlights(docId: string): string[] {
  const v = loadAll()[docId];
  return Array.isArray(v) ? v : [];
}

/** 加一条高亮(去重、去空、限长防爆)。返回加完后的全集。 */
export function addHighlight(docId: string, text: string): string[] {
  const t = text.trim();
  if (!t) return loadHighlights(docId);
  const all = loadAll();
  const list = Array.isArray(all[docId]) ? all[docId] : [];
  if (!list.includes(t)) list.unshift(t);
  all[docId] = list.slice(0, 200); // 每篇至多 200 条,超了丢最旧
  saveAll(all);
  return all[docId];
}

/** 删一条高亮(精确匹配)。返回删完后的全集。 */
export function removeHighlight(docId: string, text: string): string[] {
  const all = loadAll();
  const list = (Array.isArray(all[docId]) ? all[docId] : []).filter((x) => x !== text.trim());
  all[docId] = list;
  saveAll(all);
  return list;
}

/** 有则删、无则加(划词高亮按钮的语义)。 */
export function toggleHighlight(docId: string, text: string): { on: boolean; list: string[] } {
  const t = text.trim();
  const has = loadHighlights(docId).includes(t);
  return has ? { on: false, list: removeHighlight(docId, t) } : { on: true, list: addHighlight(docId, t) };
}

export interface Segment { text: string; mark: boolean }

/**
 * 把一个段落按高亮片段切成 高亮/非高亮 小段(纯函数)。
 * 用布尔遮罩累加所有片段命中的字符区间,再合并连续同态的字符 → 稳、可覆盖重叠。
 */
export function segmentParagraph(text: string, snippets: string[]): Segment[] {
  if (!text) return [];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const raw of snippets) {
    const s = raw.trim();
    if (s.length < 1) continue;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(s, from);
      if (idx < 0) break;
      for (let i = idx; i < idx + s.length; i++) marks[i] = true;
      from = idx + s.length;
    }
  }
  const out: Segment[] = [];
  let cur = '';
  let curMark = marks[0];
  for (let i = 0; i < text.length; i++) {
    if (marks[i] === curMark) { cur += text[i]; continue; }
    out.push({ text: cur, mark: curMark });
    cur = text[i];
    curMark = marks[i];
  }
  if (cur) out.push({ text: cur, mark: curMark });
  return out;
}
