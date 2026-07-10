/**
 * 待办判定启发式(批次 31)——语音/文字的确定性分类补丁。
 *
 * QA 实锤:同一句「洗衣服」一次被存成 ⭐偏好、一次 🚩承诺。根因:说一句的规则
 * 抽取只按 domain 定 signal type,家务类无 domain → 'observation' → preference。
 * 这里用动作动词 + 时间词做一层确定性判定:像待办的,一律 task(→ commitment),
 * 分类不再看运气。纯函数,零 AI。
 */

const ACTION_VERBS = /^(洗|买|打扫|收拾|整理|预约|交|取|寄|修|办|还|约|联系|打电话|发|做|搬|扔|倒|签|填|订|接|送|问|查|换|退|挂号|缴|付)/;
const TIME_WORDS = /(今天|明天|后天|今晚|早上|上午|中午|下午|傍晚|晚上|周[一二三四五六日天]|礼拜[一二三四五六日天]|下周|这周|月底|\d{1,2}\s*点|\d{1,2}:\d{2})/;
const INTENT_WORDS = /(记得|别忘|要去|得去|需要|待办|todo)/i;
const EN_TASK = /\b(need to|remember to|don'?t forget|remind me|todo|to-do|buy|call|pick up|clean|wash|book|pay|schedule|return|fix|email|submit)\b/i;
const EN_TIME = /\b(today|tomorrow|tonight|this (week|morning|afternoon|evening)|next week|mon|tue|wed|thu|fri|sat|sun)(day)?\b/i;

/** 这句话像不像一件要做的事。短句(≤40 字)才判 —— 长文更可能是想法/日记。 */
export function looksLikeTask(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 40) return false;
  if (ACTION_VERBS.test(t)) return true;
  if (INTENT_WORDS.test(t)) return true;
  if (EN_TASK.test(t)) return true;
  // 光有时间词不算(「今天好累」是心情);时间词 + 短动宾才算
  if ((TIME_WORDS.test(t) || EN_TIME.test(t)) && t.replace(TIME_WORDS, '').replace(EN_TIME, '').trim().length >= 2
      && (ACTION_VERBS.test(t.replace(TIME_WORDS, '').trim()) || EN_TASK.test(t))) return true;
  return false;
}
