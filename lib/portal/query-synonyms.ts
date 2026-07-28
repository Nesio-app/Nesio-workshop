/**
 * query-synonyms — 中英同义词扩展(2026-07-28,用户标注 PDF1 图7「还需要提高智能」)。
 *
 * 复现的那个场景:用户问「8 月份的医生预约」,念念答「没有直接看到与"医生预约"相关的明确条目」,
 * 可日历里明明有 "Appointment with MedPsych Integrated"。问题不在模型笨,在**检索根本没召回**:
 *   · 记录是英文的(Google 日历原样同步),问句是中文的;
 *   · 现有检索是关键词/子词匹配 —— 中文 token「医生」「预约」和英文标题一个字都对不上;
 *   · 语义向量重排是付费云的(免费层根本不跑),所以这条缝一直敞着。
 *
 * 这里补一层**确定性的双语同义词扩展**:把问句里的词扩成同一组的中英说法,一起去匹配。
 * 零 AI、零网络、免费层就能用 —— 正是「免费=端上/确定性」那条线该干的事。
 *
 * 分数上刻意压一档:同义词命中比原词命中低(见调用方),避免「预约」把所有含 appointment 的
 * 东西都顶到前面,盖过真正精确的匹配。
 *
 * 维护:发现搜不到的,往 SYNONYM_GROUPS 里加一组就行 —— 一组内所有词互为同义。
 * 契约测试:scripts/query-synonyms.test.mjs。
 */

/** 一组 = 互为同义的中英说法。全部小写;匹配时按「包含」判定,所以短词要谨慎。 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // ── 医疗健康(图7 那条就死在这里)──
  ['医生', '看病', '门诊', '复诊', '就诊', 'doctor', 'physician', 'clinic', 'medical', 'md', 'dr'],
  ['预约', '约了', '挂号', 'appointment', 'appt', 'booking', 'scheduled', 'visit'],
  ['医院', '诊所', 'hospital', 'health center', 'healthcare', 'medcenter'],
  ['牙医', '看牙', 'dentist', 'dental', 'orthodont'],
  ['体检', '检查', 'checkup', 'check-up', 'physical', 'screening', 'lab work'],
  ['药', '吃药', '处方', 'medication', 'prescription', 'pharmacy', 'refill', 'rx'],
  ['疫苗', '打针', 'vaccine', 'vaccination', 'immunization', 'shot'],
  ['保险', 'insurance', 'copay', 'deductible', 'claim'],
  // ── 日程 / 会议 ──
  // 注意别放裸单字「会」:社会/机会/一会儿/会员卡 都会被它拖进会议组(自查实测 10 条探测句中招 4 条)。
  ['会议', '开会', 'meeting', 'standup', 'sync', 'call', '1:1', 'review'],
  ['日程', '安排', '行程', 'schedule', 'calendar', 'agenda', 'itinerary'],
  ['提醒', '记得', 'reminder', 'remind', 'due'],
  ['生日', 'birthday', 'bday'],
  ['纪念日', 'anniversary'],
  // ── 出行 ──
  ['航班', '飞机', '机票', 'flight', 'airline', 'boarding', 'departure'],
  ['酒店', '住宿', '民宿', 'hotel', 'motel', 'airbnb', 'reservation', 'check-in'],
  ['火车', '高铁', 'train', 'rail', 'amtrak'],
  ['租车', '打车', 'rental car', 'uber', 'lyft', 'taxi'],
  ['旅行', '出差', '度假', 'trip', 'travel', 'vacation', 'business trip'],
  // ── 购物 / 订单 ──
  ['订单', '下单', '买了', 'order', 'ordered', 'purchase', 'checkout'],
  ['快递', '发货', '物流', '包裹', 'shipped', 'shipment', 'delivery', 'delivered', 'package', 'tracking'],
  ['退货', '退款', 'return', 'refund'],
  // ── 钱 ──
  ['账单', '缴费', 'bill', 'invoice', 'statement', 'payment due'],
  ['还款', '信用卡', 'credit card', 'repayment', 'autopay'],
  ['工资', '发薪', 'salary', 'payroll', 'paycheck', 'direct deposit'],
  ['房租', '租金', 'rent', 'lease'],
  // ── 学校 / 孩子 ──
  ['学校', '上学', 'school', 'campus', 'district'],
  ['老师', 'teacher', 'instructor', 'professor'],
  ['家长会', 'parent-teacher', 'pta', 'conference'],
  ['作业', 'homework', 'assignment'],
  ['夏令营', '营地', 'camp', 'summer camp'],
  // ── 运动 / 身体 ──
  ['健身', '训练', '锻炼', 'workout', 'training', 'gym', 'exercise'],
  ['跑步', 'run', 'running', 'jog'],
  ['瑜伽', 'yoga', 'pilates'],
  ['睡眠', '睡觉', 'sleep', 'bedtime'],
  // ── 家务 / 房子 ──
  ['家务', '打扫', '清洁', 'chore', 'cleaning', 'clean', 'tidy'],
  ['维修', '修理', '师傅', 'repair', 'fix', 'maintenance', 'plumber', 'electrician', 'hvac'],
  ['搬家', 'moving', 'move out', 'movers'],
  // ── 宠物 ──
  ['宠物', '猫', '狗', 'pet', 'cat', 'dog', 'vet', '兽医'],
  // ── 工作 ──
  ['面试', 'interview'],
  ['简历', 'resume', 'cv'],
  ['项目', 'project', 'launch', 'milestone', 'deadline'],
];

/** 词 → 它所属的组(可能属多组;取并集)。构建一次,查表 O(1)。 */
const INDEX: Map<string, Set<number>> = (() => {
  const m = new Map<string, Set<number>>();
  SYNONYM_GROUPS.forEach((group, gi) => {
    for (const term of group) {
      const k = term.toLowerCase();
      const s = m.get(k);
      if (s) s.add(gi); else m.set(k, new Set([gi]));
    }
  });
  return m;
})();

/**
 * 把查询词扩成同义词。返回**新增的**词(不含原词),调用方给它们更低的权重。
 *
 * 判定用「包含」而不是全等:token「医生预约」也能命中「医生」和「预约」两组。
 * 短词必须全等才算,分两类:
 *   · 拉丁 ≤2 字母('dr'/'md'/'rx'/'cv'):否则 'android' 里的 dr、'command' 里的 md 到处误爆;
 *   · **任何单字**(中文的「药」「猫」「狗」这类):单字太容易成为别的词的一部分,
 *     反向包含('药'∈'买药水')还行,正向包含就会把「一会儿」判成开会。
 * 中文两字词(医生/预约/快递)是正经词,仍按包含匹配。
 */
export function expandQueryTerms(tokens: readonly string[]): string[] {
  const have = new Set(tokens.map((t) => t.toLowerCase()));
  const groups = new Set<number>();
  for (const raw of tokens) {
    const t = raw.toLowerCase().trim();
    if (!t) continue;
    for (const [term, gs] of INDEX) {
      const shortTerm = [...term].length === 1 || (term.length <= 2 && /^[a-z]+$/.test(term));
      const hit = shortTerm ? t === term : (t.includes(term) || term.includes(t));
      if (hit) for (const g of gs) groups.add(g);
    }
  }
  const out: string[] = [];
  for (const g of groups) {
    for (const term of SYNONYM_GROUPS[g]) {
      const k = term.toLowerCase();
      if (!have.has(k)) { have.add(k); out.push(k); }
    }
  }
  return out;
}

/** 这个查询有没有能扩的同义词(UI 想说明「顺带也搜了英文说法」时用)。 */
export function hasSynonyms(tokens: readonly string[]): boolean {
  return expandQueryTerms(tokens).length > 0;
}

/**
 * 同义词**真的**在这批语料里搭上桥了吗 —— 不是「有词可扩」,是「扩出来的词确实命中了内容」。
 *
 * 给跨语言缺口提示(cross-lingual-gap)用。那套提示的判据是「问句是中文 + 语料里有一批
 * 英文 + 没跑语义向量」→ 提醒用户「英文记录这次可能没搜到」。但同义词层上线后,
 * 中英之间已经有一条确定性的桥了:问「医生预约」照样能捞到 "Appointment with …"。
 * 这时候还提示,就成了「找到了,同时又说可能没找到」—— 自相矛盾,而且正是用户抱怨的
 *「还需要提高智能」的一部分。所以只有**桥没搭上**时才保留那句提示。
 *
 * 用「扩出来的词命中语料」而不是「有词可扩」来判,是为了不过度消音:同义词只覆盖
 * 四十来个生活领域,问到覆盖不到的事情时,那句提示仍然是诚实且必要的。
 */
export function synonymsBridged(tokens: readonly string[], corpusTexts: readonly string[]): boolean {
  const extra = expandQueryTerms(tokens);
  if (!extra.length) return false;
  for (const text of corpusTexts) {
    const t = text.toLowerCase();
    for (const s of extra) if (t.includes(s)) return true;
  }
  return false;
}
