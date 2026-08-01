/**
 * 提醒在记忆里的**身影**(2026-07-31,用户:「设好的提醒进入时间线」)。
 *
 * 提醒的真源是 schedule-reminders(时刻、重复、完成都在那儿)。这里只在 life-graph
 * 里放一条对应的记录,让它排得进时间线 —— 否则提醒只活在日程页那一屏,
 * 你在今天页翻一整天也看不到自己设过什么。
 *
 * 收在一个文件里,是因为它有**两个**调用点(首页输入条、日程页「加一条」):
 * 各写一份的下场是其中一处忘了建、或者删提醒时忘了收身影,
 * 于是时间线上留着一条指向不存在提醒的记录。
 *
 * 身影不是第二份真源:它不带完成状态、不带下一次是什么时候。
 * 那些只看 schedule-reminders —— 两处都存会立刻开始漂移。
 */

import { getLifeGraph, deleteLifeNode } from './life-graph';
import { addCommitmentNode } from '../platform/view-models/today-commands';
import { repeatLabel, type Reminder } from './schedule-reminders';

/** 身影节点上标记它属于哪条提醒。删提醒时靠它找回来。 */
export const SHADOW_ATTR = 'reminderId';

/** 建一条身影。返回节点 id;建不出来返回空串(调用方不必因此失败 —— 提醒本身已经存好了)。 */
export function createReminderShadow(r: Reminder): string {
  try {
    const node = addCommitmentNode(r.title, {
      /*
       * dueDate 存的是**完整墙上时钟**(2026-08-01T15:00),不是纯日期。
       *
       * node-dates 的 NODE_DATE_KEYS 里 dueDate 排在 remindAt **前面**,
       * firstNodeDate 会先命中它 —— 只存 `2026-08-01` 的话钟点当场丢掉,
       * 这条提醒在时间线/今日焦点上变成「明天(某个时候)」,而用户明明说了三点。
       * dueTime 单独再存一份给那些只读时分的地方;remindAt 是语义最准的那个键,
       * 一并写上,免得下游按它找的时候扑空。
       */
      dueDate: r.at,
      dueTime: r.at.slice(11),
      remindAt: r.at,
      [SHADOW_ATTR]: r.id,
      ...(repeatLabel(r) ? { recurring: repeatLabel(r) } : {}),
    });
    return node.id;
  } catch {
    // 记忆写不进去不该把「提醒设好了」这件事一起打翻 —— 提醒是主,身影是影。
    return '';
  }
}

/**
 * 收走某条提醒的身影。删提醒、撤销新建都要调。
 * 找不到就当没有 —— 老提醒(这个功能之前建的)本来就没有身影。
 */
export function removeReminderShadow(reminderId: string): void {
  if (!reminderId) return;
  try {
    for (const n of getLifeGraph()) {
      if ((n.attributes || {})[SHADOW_ATTR] === reminderId) deleteLifeNode(n.id);
    }
  } catch { /* 删不掉下次再说,不阻断主流程 */ }
}
