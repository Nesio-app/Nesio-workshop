/**
 * readability — URL 正文提取(批次193)。纯函数、无 DOM/网络依赖,可单测。
 *
 * Readability-lite:挑正文容器 → 去广告/导航/侧栏噪音 → **保留关键图片**(过滤小图/图标/
 * 追踪像素/广告)按位置转成行内 marker `![](绝对URL)` → 去标签、解实体、压空白、按段封顶。
 * 阅读器(ReaderView)识别 `![](url)` 段落 → 渲染成 <img>。
 */

// 广告/图标/追踪像素的图片 URL 特征 —— 命中即剔除,只留正文里的关键图。
export const JUNK_IMG_RE = /(1x1|pixel|spacer|blank\.gif|sprite|\bicons?\b|\blogos?\b|avatar|emoji|tracking|beacon|doubleclick|\/ads?\/|[-_]ad[-_.]|analytics|badge|button|\bthumb\b|placeholder)/i;

export function absUrl(src: string, base: string): string {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  try { return new URL(src, base || undefined).href; } catch { return ''; }
}

export function extractArticleText(html: string, pageUrl = ''): string {
  const pick = (re: RegExp): string => { const m = html.match(re); return m ? m[1] : ''; };
  let body =
    pick(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*id=["']js_)/i) ||
    pick(/<div[^>]*class=["'][^"']*rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*id=)/i) ||
    pick(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    pick(/<main[^>]*>([\s\S]*?)<\/main>/i);

  if (!body) {
    // 兜底:取「文本量最大且 ≥3 段」的 <div>(粗正文密度);再不行拼所有 <p>。
    let best = ''; let bestLen = 0;
    for (const m of html.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)) {
      const inner = m[1];
      const pCount = (inner.match(/<p[\s>]/gi) || []).length;
      if (pCount < 3) continue;
      const tlen = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
      if (tlen > bestLen) { best = inner; bestLen = tlen; }
    }
    body = best || (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).join('\n');
  }

  // 去噪:整块移除脚本/样式/导航/页眉页脚/侧栏/表单/图注/注释。
  body = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|form|aside|nav|header|footer|figcaption)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(link|meta|source|input)\b[^>]*\/?>/gi, '');

  // 关键图片 → 行内 marker(其余广告/图标/像素剔除)。data-src 兼容懒加载(WSJ 等常见)。
  const seenImg = new Set<string>();
  body = body.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = (/(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)["']/i.exec(attrs)?.[1] || '').trim();
    if (!src) return '';
    const w = Number(/\bwidth=["']?(\d+)/i.exec(attrs)?.[1] || 0);
    const h = Number(/\bheight=["']?(\d+)/i.exec(attrs)?.[1] || 0);
    if ((w && w <= 120) || (h && h <= 120)) return '';              // 小图/图标
    if (JUNK_IMG_RE.test(src)) return '';
    if (src.startsWith('data:') && src.length < 200) return '';      // 内联小占位
    const abs = absUrl(src, pageUrl);
    if (!abs || seenImg.has(abs)) return '';
    seenImg.add(abs);
    return `\n\n![](${abs})\n\n`;
  });

  const text = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < 40) return '';
  if (text.length <= 12000) return text;
  // 按段落封顶,别把图片 marker 切一半。
  let acc = '';
  for (const p of text.split(/\n{2,}/)) {
    if (acc.length + p.length + 2 > 12000) break;
    acc += (acc ? '\n\n' : '') + p;
  }
  return acc;
}
