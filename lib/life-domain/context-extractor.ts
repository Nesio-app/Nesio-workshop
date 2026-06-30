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

const DOMAIN_KEYWORDS: Array<{ domain: FrontDomain; words: RegExp }> = [
  { domain: 'assets', words: /(放在|存在|收纳|盒子|抽屉|储物|物品|买|购|账单|订阅|续费|预算|花了|剩.{0,3}瓶|快递|发票)/ },
  { domain: 'health', words: /(睡|运动|健身|训练|跑步|血糖|药|医院|体检|身体|饮食|卡路里|心率)/ },
  { domain: 'energy', words: /(焦虑|情绪|冥想|低能量|恢复|疲惫|压力|心理|独处|放空|grounding)/ },
  { domain: 'growth', words: /(会议|任务|项目|工作|学习|阅读|论文|刷题|笔记|复盘|deadline|截止)/ },
  { domain: 'life', words: /(生日|礼物|旅行|朋友|妈妈|爸爸|家人|聚餐|约会|纪念日)/ },
];

function classifyDomain(text: string): { domain: FrontDomain; secondary: FrontDomain[] } {
  const hits = DOMAIN_KEYWORDS.filter((k) => k.words.test(text)).map((k) => k.domain);
  if (hits.length === 0) return { domain: 'life', secondary: [] };
  return { domain: hits[0], secondary: hits.slice(1) };
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
  const { domain, secondary } = classifyDomain(trimmed);

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
      ai: opts?.aiConfidence ?? 0.7,
      userConfirmed: false, // suggestion only until the user confirms (§6.2)
      userEdited: false,
    },
  };
  return ctx;
}
