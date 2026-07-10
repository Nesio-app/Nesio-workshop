/**
 * 本地任务模板库(批次 39)—— 粉碎任务的默认引擎。
 *
 * 用户定案:粉碎任务不默认打联网 AI(慢、要网、烧钱)。常见任务用手写的
 * 诚实模板(参考竞品口径:真实步骤 + 真实分钟数,等待也算一步),命中即秒出;
 * 不命中回落通用骨架;联网 AI 只走卡上显式「AI 细化」按钮。
 * 纯函数、零依赖 —— iOS 原生壳接 Apple 端上模型前,这就是"本地模型"。
 */

export interface TemplateStep { name: string; emoji: string; durationMin: number }
interface TaskTemplate { match: RegExp; matchEn?: RegExp; steps: TemplateStep[]; stepsEn: TemplateStep[] }

const T = (name: string, durationMin: number, emoji = '·'): TemplateStep => ({ name, emoji, durationMin });

const TEMPLATES: TaskTemplate[] = [
  {
    match: /洗衣/, matchEn: /\blaundry|wash(ing)? (the )?clothes\b/i,
    steps: [T('分类衣物(按颜色、材质)', 3), T('放入洗衣机,加洗涤剂', 2), T('选程序,启动', 1), T('等待洗衣机洗涤完成', 35), T('取出晾晒或烘干', 4)],
    stepsEn: [T('Sort clothes by color & fabric', 3), T('Load washer, add detergent', 2), T('Pick a cycle, start', 1), T('Wait for the wash to finish', 35), T('Hang or tumble-dry', 4)],
  },
  {
    match: /买菜|去超市|采购/, matchEn: /\bgrocer(y|ies)|supermarket\b/i,
    steps: [T('列购物清单(看冰箱缺什么)', 5), T('出门到超市', 15), T('按清单选购', 20), T('结账回家', 15), T('食材归位入冰箱', 5)],
    stepsEn: [T('Write the list (check the fridge)', 5), T('Head to the store', 15), T('Shop the list', 20), T('Check out & head home', 15), T('Put groceries away', 5)],
  },
  {
    match: /洗碗|刷碗/, matchEn: /\bdo (the )?dishes|wash dishes\b/i,
    steps: [T('收拢碗筷到水槽,倒掉残渣', 3), T('冲洗、洗涤剂刷洗', 8), T('清水过净,沥干摆放', 4)],
    stepsEn: [T('Gather dishes, scrape scraps', 3), T('Scrub with soap', 8), T('Rinse & rack to dry', 4)],
  },
  {
    match: /打扫|收拾房间|大扫除|整理房间/, matchEn: /\bclean (the )?(room|house)|tidy( up)?\b/i,
    steps: [T('把明显的杂物归位', 8), T('桌面台面擦一遍', 6), T('地面吸尘或扫拖', 12), T('倒垃圾,换垃圾袋', 4)],
    stepsEn: [T('Put stray items back', 8), T('Wipe surfaces', 6), T('Vacuum or mop the floor', 12), T('Take out trash, new bag', 4)],
  },
  {
    match: /做饭|做晚饭|做午饭|煮饭/, matchEn: /\bcook (dinner|lunch|a meal)\b/i,
    steps: [T('定菜单,取出食材', 5), T('洗切备菜', 12), T('下锅烹饪', 18), T('摆盘开吃,顺手泡上锅', 3)],
    stepsEn: [T('Decide the dish, pull ingredients', 5), T('Wash & prep', 12), T('Cook', 18), T('Plate up; soak the pan', 3)],
  },
  {
    match: /写报告|写文档|写方案|写总结/, matchEn: /\bwrite (a |the )?(report|doc|summary)\b/i,
    steps: [T('列出 3 个要点提纲', 8), T('先写最熟的一段', 20), T('补齐其余段落', 25), T('通读一遍,改错别字', 8)],
    stepsEn: [T('Outline 3 key points', 8), T('Draft the easiest section first', 20), T('Fill in the rest', 25), T('Read through, fix typos', 8)],
  },
  {
    match: /回邮件|回复邮件|清邮件/, matchEn: /\b(reply|clear|answer) (to )?emails?\b/i,
    steps: [T('扫一遍收件箱,标出必回的', 5), T('先回最简单的一封', 5), T('逐封回完标出的', 15)],
    stepsEn: [T('Scan inbox, flag must-replies', 5), T('Answer the easiest one first', 5), T('Work through the flagged ones', 15)],
  },
  {
    match: /打电话|联系.{0,6}(客服|医生|银行)/, matchEn: /\bcall (the )?(doctor|bank|support|mom|dad)?\b/i,
    steps: [T('写下要问的 2-3 个问题', 3), T('拨通电话,照着问', 10), T('挂断后记下结论', 2)],
    stepsEn: [T('Jot 2-3 questions to ask', 3), T('Make the call, ask them', 10), T('Note the outcome', 2)],
  },
  {
    match: /收拾行李|打包行李|装箱/, matchEn: /\bpack (a |the )?(bag|suitcase|luggage)\b/i,
    steps: [T('列出必带清单(证件/充电器/药)', 5), T('衣物按天数配好', 10), T('洗漱包和零碎装袋', 8), T('对清单过一遍,合箱', 5)],
    stepsEn: [T('List must-packs (docs/chargers/meds)', 5), T('Pick outfits by day count', 10), T('Toiletries & small items in pouches', 8), T('Check the list, zip up', 5)],
  },
  {
    match: /预约|挂号/, matchEn: /\bbook|schedule (an? )?(appointment|doctor)\b/i,
    steps: [T('确认要约的时间范围', 2), T('打开预约入口(电话/App)', 2), T('选时段,提交信息', 5), T('把确认时间记进日历', 2)],
    stepsEn: [T('Decide your available windows', 2), T('Open the booking line/app', 2), T('Pick a slot, submit details', 5), T('Add confirmation to calendar', 2)],
  },
  {
    match: /交房租|缴费|交水电/, matchEn: /\bpay (the )?(rent|bill|utilities)\b/i,
    steps: [T('打开缴费入口,核对金额', 3), T('付款', 2), T('截图存凭证', 1)],
    stepsEn: [T('Open the payment page, check amount', 3), T('Pay', 2), T('Screenshot the receipt', 1)],
  },
  {
    match: /遛狗/, matchEn: /\bwalk (the )?dog\b/i,
    steps: [T('牵绳、捡便袋带上', 2), T('出门走一圈', 20), T('回家擦爪、添水', 3)],
    stepsEn: [T('Leash up, grab bags', 2), T('Do the loop', 20), T('Wipe paws, refill water', 3)],
  },
  {
    match: /健身|锻炼|运动|跑步/, matchEn: /\bwork ?out|exercise|go for a run\b/i,
    steps: [T('换运动服,备水', 4), T('热身', 5), T('主训练', 30), T('拉伸放松', 5)],
    stepsEn: [T('Change, grab water', 4), T('Warm up', 5), T('Main session', 30), T('Stretch & cool down', 5)],
  },
];

/** 命中返回诚实步骤(秒出,零网络);不命中返回 null 由调用方走通用骨架。 */
export function matchTaskTemplate(taskName: string, locale: string = 'zh'): TemplateStep[] | null {
  const t = (taskName || '').trim();
  if (!t) return null;
  const en = locale.toLowerCase().startsWith('en');
  for (const tpl of TEMPLATES) {
    if (tpl.match.test(t) || (tpl.matchEn && tpl.matchEn.test(t))) {
      return en ? tpl.stepsEn : tpl.steps;
    }
  }
  return null;
}
