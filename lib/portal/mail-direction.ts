/**
 * 一封邮件是「我写给别人的」还是「我要读的」(2026-08-01,用户第三次指同两封)。
 *
 * 这个判据在两处用,而且必须是同一份:
 *   · 同步侧(app/api/portal/gmail/route.ts)—— 拿得到 Gmail 的 labelIds,写进节点;
 *   · 读取侧(SchedulePanel 的收件/发件分格)—— 只有节点上那几个属性,
 *     负责纠正**同步时按老判据写死、之后不会重算**的历史数据。
 *
 * 两处各写一份的下场,这一条已经演过一遍:同步侧改对了,读取侧照旧,
 * 用户看到的还是原样。所以判据收在这里,两边都调它。
 *
 * ── 判据本身走过的三版 ────────────────────────────────────────────────
 *   ① 只看 SENT 标签 → 「自己发给自己」的每日简报全被归进发件箱;
 *   ② SENT ∧ ¬INBOX → 挡得住还躺在收件箱里的自寄信,但**归档之后 INBOX 就没了**,
 *      而简报这种东西几乎必然会被归档,于是漏得很稳定;
 *   ③ (现在)看**收件人里除了我自己还有没有别人**。
 *      「我」不用另外去问 profile:一封带 SENT 的信,From 按定义就是我。
 *      收件人全是自己 → 写给自己看的东西(简报/转存/备忘),归收件;
 *      有第三方地址 → 才是「我写给别人的」。
 *
 * 拿不到收件人时**不猜**,退回上一版判据 —— 不知道收件人是谁的时候,
 * 断言它是自寄信没有依据。
 */

export type MailDirection = 'sent' | 'received';

/** 从「名字 <a@b.com>」或裸地址里抠出邮箱(小写)。抠不出来返回空串。 */
export function emailAddrOf(s: string): string {
  const m = /<([^>]+)>/.exec(String(s || '')) || /([^\s<>@]+@[^\s<>@]+)/.exec(String(s || ''));
  return (m ? m[1] : '').trim().toLowerCase();
}

export interface MailDirectionInput {
  /** Gmail 标签。读取侧没有就留空 —— 那边靠 from/to 判。 */
  labels?: readonly string[];
  from?: string;
  to?: string;
  cc?: string;
  /**
   * 同步时写下的方向。**只在 from/to 判不出来时才信它** ——
   * 它可能是按老判据写的,而这个函数存在的一半理由就是纠正那批。
   */
  storedDirection?: string;
}

export function mailDirectionOf(input: MailDirectionInput): MailDirection {
  const labels = input.labels || [];
  const hasLabels = labels.length > 0;

  // 同步侧:没有 SENT 就一定是收到的,不用再看别的
  if (hasLabels && !labels.includes('SENT')) return 'received';

  // 读取侧:没标签可看,而同步时记的是 received —— 那就是 received。
  // (老数据里 received 这一侧没有被误判过:错的方向只有「本该收件却写成 sent」。)
  if (!hasLabels && input.storedDirection !== 'sent') return 'received';

  const me = emailAddrOf(input.from || '');
  const recipients = `${input.to || ''},${input.cc || ''}`
    .split(',').map(emailAddrOf).filter(Boolean);

  // 收件人不明 → 不猜,退回上一版判据(有 INBOX 就是收件)。
  if (!me || !recipients.length) {
    if (hasLabels) return labels.includes('INBOX') ? 'received' : 'sent';
    return 'sent';   // 读取侧走到这儿说明同步时判的是 sent,没有新证据就不推翻
  }

  return recipients.some((addr) => addr !== me) ? 'sent' : 'received';
}
