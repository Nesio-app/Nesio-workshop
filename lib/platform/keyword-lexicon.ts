/**
 * Keyword Lexicon — shared pattern vocabulary for rule-based classifiers.
 *
 * attention-engine (calendar titles), email-signals (subjects) and
 * today-view-model (memory nodes) each kept their own word lists for the
 * same concepts; "生日/航班/就诊" lived in three places. The *patterns*
 * are shared here; per-consumer metadata (icons, priorities, card copy)
 * stays local to each consumer.
 *
 * Each pattern is the union of every variant that previously existed, so
 * swapping a local list for the lexicon only widens matches, never narrows.
 */

export const LEXICON = {
  flight: /flight|航班|机票|登机|起飞|出发|乘机|飞往|飞\s*\w|itinerary|e-ticket|电子客票|booking.?confirm/i,
  medical: /doctor|医生|医院|诊所|手术|检查|复诊|复查|挂号|预约.*医|dental|牙科|体检|看诊|取药|配药|打针|疫苗|产检/i,
  exam: /exam|考试|考核|测试|quiz|托福|雅思|gre|gmat/i,
  deadline: /due|deadline|截止|到期|缴费|付款|租金|房租|还款|逾期|最后一天|last.?day|expires|过期/i,
  birthday: /birthday|生日|寿|满月/i,
  anniversary: /纪念日|周年|忌日|anniversary/i,
  travel: /旅行|出行|搬家|入住|check.?in|酒店.*到达|到达.*酒店|hotel|住宿|民宿/i,
  meeting: /meeting|会议|review|面试|interview|周会|同步|1on1|standup|stand.up|sync|call/i,
  appointment: /预约|appointment|挂号|复诊|interview.?confirm|面试|约好|会面/i,
  health: /健康|健身|运动|睡眠|饮食|减肥|体重|跑步|锻炼|复诊|体检|用药|打卡/i,
  package: /快递|包裹|delivery|package|shipped|order shipped|物流|派送|到件|签收/i,
  bill: /账单|invoice|payment due|bill|缴费|扣款|还信用卡|月租|续费/i,
  verification: /验证码|verification code|confirm your email|邮箱验证|二次验证/i,
  reminder: /reminder|提醒|don.?t forget|别忘了|温馨提示/i,
  booking: /机票|酒店|预订|订单|行程|快递|外卖|booking|flight|hotel|ticket|order/i,
} as const;

export type LexiconCategory = keyof typeof LEXICON;

/** Test text against one category. */
export function matchesCategory(text: string, category: LexiconCategory): boolean {
  return LEXICON[category].test(text);
}

/** First matching category from an ordered list (first match wins). */
export function firstMatch(text: string, categories: readonly LexiconCategory[]): LexiconCategory | null {
  for (const c of categories) {
    if (LEXICON[c].test(text)) return c;
  }
  return null;
}
