/**
 * Context Extraction — Capability (Domain-Capability PRD v1 §6.2).
 *
 * Rule-based v1: turn raw text into a SignalContext (domain + people / places /
 * objects / intent). Assets-first, since 财物 is the launch domain. AI may
 * upgrade this later (v2), but every field here is a SUGGESTION until the user
 * confirms — confidence.userConfirmed stays false (§6.2 绝对控制优先).
 *
 * Implements the §7.3 worked example end to end:
 *   "Linda 的礼物在储物间蓝盒子里"
 *   → { domain: assets, people: [Linda], objects: [礼物],
 *       places: [储物间, 蓝盒子], intent: find_later }
 */

import type { FrontDomain } from './domain-taxonomy';
import type { SignalContext } from './context';

// ── Domain classification (keyword → front domain) ──────────────────────────

// 2026-08-01 用户点名扩容(Domains 三合一:sensitivity 退场,FrontDomain 接手 + 机器判定关键词扩充)——
// 用户手写了一版新关键词草案,这里对齐进原有 5 桶(不新开桶,FrontDomain 只有这 5 个)。
// 「成长/反思/镜子内容」没有字面并进 health(那是身体信号的桶,反思更贴 growth 已有的「复盘」),
// 「reader 高亮划线」不是靠关键词猜的——见 node-context.ts 的非文本判据(有专属数据标记)。
const DOMAIN_KEYWORDS: Array<{ domain: FrontDomain; words: RegExp }> = [
  { domain: 'assets', words: /(放在|存在|收纳|盒子|抽屉|储物|物品|买|购|账单|订阅|续费|预算|花了|剩.{0,3}瓶|快递|发票|收入|支出|退款|投资|价格|费用|订单|税金|资产)/ },
  { domain: 'health', words: /(睡|运动|健身|训练|跑步|血糖|药|医院|体检|身体|饮食|卡路里|心率)/ },
  { domain: 'energy', words: /(焦虑|情绪|冥想|低能量|恢复|疲惫|压力|心理|独处|放空|grounding)/ },
  { domain: 'growth', words: /(会议|任务|项目|工作|学习|阅读|论文|刷题|笔记|复盘|反思|知识|学业|deadline|截止)/ },
  { domain: 'life', words: /(生日|礼物|旅行|朋友|妈妈|爸爸|家人|聚餐|约会|纪念日|音乐|衣服|美食|穿搭|家务|愿望|足迹|饭店|剧场)/ },
];

// 批次 146:分类不准的根 —— 旧逻辑「首个命中赢 + 零命中一律默认 life + 置信度硬编码 0.7」,
// 连「洗澡」这种零关键词的都自信标成 life。改成:按「命中关键词数」给每个域打分取最高,
// 并返回真实置信度(零命中压到很低,让下游标『待确认』而不是装懂)。
function countHits(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (text.match(g) || []).length;
}
/** 零命中返回 null(不装懂猜 life)——给 node-context.ts 的「关键词兜底,猜不出才退到粗粒度 type 映射」用。
 *  跟 classifyDomain 用同一张关键词表,不重复维护;classifyDomain 自己的零命中行为(→ life 低置信,
 *  给 isNodeUncertain 标「待确认」)是 extractContext()/语音捕获路径依赖的既有行为,不动它。 */
export function classifyDomainFromText(text: string): FrontDomain | null {
  const scored = DOMAIN_KEYWORDS
    .map((k) => ({ domain: k.domain, hits: countHits(text, k.words) }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.length ? scored[0].domain : null;
}

function classifyDomain(text: string): { domain: FrontDomain; secondary: FrontDomain[]; confidence: number } {
  const scored = DOMAIN_KEYWORDS
    .map((k) => ({ domain: k.domain, hits: countHits(text, k.words) }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (scored.length === 0) {
    // 一个关键词都没命中 —— 别装懂:life 只作兜底,置信度压到很低 → isNodeUncertain 标「待确认」。
    return { domain: 'life', secondary: [], confidence: 0.25 };
  }
  const secondary = scored.slice(1).map((s) => s.domain);
  // 唯一命中、或明显领先第二名 → 高置信;多域并列 → 中(仍可能要人确认)。
  const clear = scored.length === 1 || scored[0].hits > (scored[1]?.hits ?? 0);
  return { domain: scored[0].domain, secondary, confidence: clear ? 0.85 : 0.55 };
}

// ── Entity extraction ───────────────────────────────────────────────────────

const PLACE_WORDS = /(储物间|储藏室|抽屉|柜子|盒子|玄关|厨房|卧室|客厅|阳台|车里|办公室|公司|咖啡馆|书房|包里|背包|行李箱)/g;
const OBJECT_HINTS = /(礼物|护照|钥匙|充电器|药|喷雾|文件|书|相机|耳机|手表|证件|发票|收据)/g;
// Person: a 1-4 char name immediately before 的, or common family terms.
const PERSON_BEFORE_DE = /([A-Za-z一-龥]{1,4})的/g;
const FAMILY_TERMS = /(妈妈|爸爸|爷爷|奶奶|外婆|外公|老婆|老公|女儿|儿子|妹妹|弟弟|姐姐|哥哥)/g;

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

function matchAll(text: string, re: RegExp, group = 0): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(text)) !== null) {
    out.push(m[group]);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

function extractPeople(text: string): string[] {
  const named = matchAll(text, PERSON_BEFORE_DE, 1)
    // drop pronouns / non-names that precede 的
    .filter((w) => !/^(我|你|他|她|它|这|那|今|明|昨|的|了)$/.test(w) && !/[，。、,.\s]/.test(w));
  const family = matchAll(text, FAMILY_TERMS, 0);
  return dedupe([...named, ...family]);
}

// ── Intent ──────────────────────────────────────────────────────────────────

function inferIntent(text: string, domain: FrontDomain): string {
  if (/(放在|存在|在.{1,8}(里|中)|收纳|位置)/.test(text)) return 'find_later';
  if (/(提醒|别忘|记得|到期|续费|过期)/.test(text)) return 'remind';
  if (/(安排|计划|几点|明天|下周|约)/.test(text)) return 'schedule';
  if (/(感觉|状态|情绪|今天很)/.test(text)) return 'reflect';
  return domain === 'assets' ? 'find_later' : 'log';
}

// ── Main ────────────────────────────────────────────────────────────────────

export function extractContext(text: string, opts?: { aiConfidence?: number }): SignalContext {
  const trimmed = text.trim();
  const { domain, secondary, confidence: domainConf } = classifyDomain(trimmed);

  const people = extractPeople(trimmed);
  const places = dedupe(matchAll(trimmed, PLACE_WORDS, 0));
  const objects = dedupe(matchAll(trimmed, OBJECT_HINTS, 0));
  const intent = inferIntent(trimmed, domain);

  const ctx: SignalContext = {
    domain,
    secondaryDomains: secondary.length ? secondary : undefined,
    people: people.length ? people : undefined,
    places: places.length ? places : undefined,
    objects: objects.length ? objects : undefined,
    intent,
    confidence: {
      // 批次 146:有 AI 置信度就用 AI 的,否则用规则分类的真实置信度(不再硬编码 0.7 —— 那正是
      // 「零命中也标 0.7」的病根)。低置信 → 下游 isNodeUncertain 标「待确认」交人核对。
      ai: opts?.aiConfidence ?? domainConf,
      userConfirmed: false, // suggestion only until the user confirms (§6.2)
      userEdited: false,
    },
  };
  return ctx;
}
