/**
 * node-display — App 生成的节点名的显示层语言转换(批次 14)。
 *
 * 背景:批次 12 起「此刻」等 App 生成的节点名按保存时的界面语言产出,
 * 但更早保存的旧数据永远是中文——英文界面下标题冒中文(用户截图)。
 * 存储不动(数据是历史事实),只在显示层把「可识别的生成模式」按当前
 * 语言转换;用户自己输入的名字永远原样。
 */

const MOMENT_EMOTIONS: Array<[zh: string, en: string]> = [
  ['开心', 'Joyful'], ['兴奋', 'Excited'], ['感动', 'Moved'], ['平静', 'Calm'],
  ['满足', 'Content'], ['感激', 'Grateful'], ['疲惫', 'Tired'], ['空洞', 'Empty'],
  ['难过', 'Sad'], ['焦虑', 'Anxious'], ['烦躁', 'Restless'], ['生气', 'Angry'],
];

/**
 * 剥标题里的系统噪音(批次 126·设计「标题永远干净,绝不甩原始邮件头」):
 * 尖括号邮件头片段 <no-reply@…>、裸邮件地址 return@amazon.com、Re:/Fwd:/回复: 前缀。
 * 原文本身不动(存储是历史事实、详情页「原始记录」折叠区仍看得到);只清显示层标题。
 */
/**
 * 剥行内 markdown 记号(QA:2191 条 flomo 笔记标题/正文原样露出 `![](https://…favicon.i`、
 * 走走看轮播露出 `**`)。图片语法整体删掉,链接留文字,加粗/斜体/行内码只留内容。
 * 只作用显示层 —— 存储原文不动。
 */
export function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, ' ')   // ![alt](url) 整体删(截断的半个也删)
    .replace(/!\[\]?\(?$/g, ' ')                // 行尾被截断的 ![ / ![]( 残骸
    .replace(/\[([^\]]*)\]\(([^)]*)\)?/g, '$1') // [text](url) → text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')          // **bold** / __bold__
    .replace(/(\*\*|__)/g, '')                   // 落单的 ** / __
    .replace(/`([^`]*)`/g, '$1')                 // `code`
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // # 标题记号
    .replace(/^\s{0,3}>\s?/gm, '')               // > 引用记号
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function cleanTitleNoise(name: string): string {
  const s = stripMarkdownInline(name)
    .replace(/<[^>]*>/g, ' ')                              // <no-reply@info.thorne.com>
    .replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, ' ')          // return@amazon.com
    .replace(/^\s*(?:re|fwds?|fw|回复|答复|转发)\s*[:：]\s*/i, '') // Re: / Fwd: / 回复:
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:：·,\-—、|]+|[\s:：·,\-—、|]+$/g, '')     // 剥净后遗留的首尾标点
    .trim();
  return s || name; // 全被剥空 → 退回原名(至少不空)
}

/** 显示层节点名:先剥噪音,再做 此刻 · X ↔ This moment · X 语言转换。 */
export function displayNodeName(name: string, dict: string): string {
  const cleaned = cleanTitleNoise(name);
  for (const [zh, en] of MOMENT_EMOTIONS) {
    if (cleaned === `此刻 · ${zh}`) return dict === 'en' ? `This moment · ${en}` : cleaned;
    if (cleaned === `This moment · ${en}`) return dict === 'zh' ? `此刻 · ${zh}` : cleaned;
  }
  return cleaned;
}
