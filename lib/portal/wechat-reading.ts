/**
 * WeChat Reading import — 微信读书笔记导入(批次 22)。
 *
 * 微信读书没有开放 API,但 App 内「笔记 → 导出」能拿到纯文本/Markdown。
 * 这里解析那份文本:书名、章节、划线/想法 → LifeNode(preference,tags:微信读书)。
 * 兼容微信读书导出的常见结构:
 *   《书名》 / 作者
 *   ◆ 章节名
 *   >> 划线原文
 *   想法：xxx  (可选)
 * 也兼容裸文本:一行一条划线。
 */

export interface ReadingNote {
  book: string;
  author?: string;
  chapter?: string;
  highlight: string;
  thought?: string;
}

export function parseWechatReading(text: string): ReadingNote[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const notes: ReadingNote[] = [];
  let book = '';
  let author = '';
  let chapter = '';
  let pendingThoughtFor: ReadingNote | null = null;

  for (const raw of lines) {
    if (!raw) { pendingThoughtFor = null; continue; }

    // 书名《…》,同行或次行可能带作者
    const bookMatch = raw.match(/^《(.+?)》\s*(.*)$/);
    if (bookMatch) {
      book = bookMatch[1];
      author = bookMatch[2].replace(/^[/·—-]\s*/, '').trim();
      chapter = '';
      continue;
    }

    // 章节:◆ / # / 第x章
    const chapMatch = raw.match(/^(?:◆|#{1,3}|第.{1,6}[章节回])\s*(.+)$/);
    if (chapMatch && raw.length < 40) {
      chapter = chapMatch[1].replace(/^#+\s*/, '').trim();
      pendingThoughtFor = null;
      continue;
    }

    // 想法(接在上一条划线后):想法：/ 💭 / 批注：
    const thoughtMatch = raw.match(/^(?:想法|批注|感想)[：:]\s*(.+)$/) || raw.match(/^💭\s*(.+)$/);
    if (thoughtMatch && pendingThoughtFor) {
      pendingThoughtFor.thought = thoughtMatch[1].trim();
      pendingThoughtFor = null;
      continue;
    }

    // 划线:>> / 「…」 / 裸文本(足够长才算)
    let highlight = raw.replace(/^>>\s*/, '').replace(/^[「【]/, '').replace(/[」】]$/, '').trim();
    // 去掉行首的页码/位置标记
    highlight = highlight.replace(/^\d+\s*[.、]\s*/, '');
    if (highlight.length >= 4 && book) {
      const note: ReadingNote = { book, author: author || undefined, chapter: chapter || undefined, highlight };
      notes.push(note);
      pendingThoughtFor = note;
    }
  }

  return notes;
}
