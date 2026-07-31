'use client';

/**
 * SchedulePanel — 洞察「日程」tab(原「会议」扩展)。两个子 tab:
 *   ① 日历项:所有日历日程(source=calendar)+ 未挂到日历的独立会议记录(meeting-notes),
 *      按时间排;挂了会议记录的日程标「有记录」,点进对应记忆。保留原会议记录闭环。
 *   ② 邮件:source=email 的节点(广告在 gmail 抽取阶段已排除 —— CATEGORY_PROMOTIONS 不进 AI);
 *      这里再加一层关键词兜底,过滤明显促销。
 * 只读 life-graph。2026-07-28 按标注 图29 收紧:日历项由近到远、只留有具体时间的真事、
 * 点条目直接开这条记忆的详情(不再跳到记忆页让你自己找)。随同步/记录事件自动刷新。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLifeGraph, deleteLifeNode, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';

const MemoryNodeDetail = dynamic(() => import('../MemoryNodeDetail'), { ssr: false });
const EmailComposeSheet = dynamic(() => import('../EmailComposeSheet'), { ssr: false });
import { L } from '@/lib/portal/i18n';
import SegTabs from '../ui/SegTabs';
import NesioSheet from '../ui/NesioSheet';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconStar, IconFlag, IconCheck } from '../icons';
import { loadPins, togglePin, PINS_UPDATED_EVENT } from '@/lib/portal/pins';
import {
  buildChips, matchesChip, matchesCustom, listCustomFilters, addCustomFilter,
  removeCustomFilter, updateCustomFilter,
  scheduleFiltersReady, SCHEDULE_FILTERS_EVENT, type CustomFilter,
} from '@/lib/portal/schedule-filters';
import { mailStatusLine, mailBadges, toneVars } from '@/lib/portal/mail-badges';
import { extractEmailLocal } from '@/lib/portal/email-extract-local';
import {
  loadMailTagFix, resolveMailKind, mailTagFixReady, fixMailTag, senderKeyOf,
  clearMailTagFix, removeSenderRule,
  MAIL_TAG_FIX_EVENT, MAIL_TAG_KINDS, type MailTagFixStore, type MailTagFix,
} from '@/lib/portal/mail-tag-fix';
import { searchTokens, matchesSearch } from '@/lib/portal/schedule-search';
import { suggestScheduleFromEmail, alreadyScheduled, type ScheduledSlot } from '@/lib/portal/email-schedule-suggest';
import {
  loadSuggestState, markSuggest, mailSuggestReady, MAIL_SUGGEST_EVENT, type SuggestVerdict,
} from '@/lib/portal/mail-suggest-state';
import {
  listReminders, addReminder, removeReminder, completeReminder,
  listCompleted, repeatLabel, type CompletedEntry,
} from '@/lib/portal/schedule-reminders';
// 提醒在时间线上的身影:两个建提醒的入口共用同一份 —— 只在一处建的话,
// 「设好的提醒进入时间线」就只对首页那条输入生效,从这一页加的看不见。
import { createReminderShadow, removeReminderShadow } from '@/lib/portal/reminder-shadow';
import {
  parseWallClock, scheduleRemindersReady, SCHEDULE_REMINDERS_EVENT,
  type Reminder, type ReminderKind,
} from '@/lib/portal/schedule-reminders';
import { ensureEmailFulltextIndex, emailFulltextReady, emailFulltextScore } from '@/lib/portal/email-fulltext-index';

// 2026-07-30 用户:「目前邮件是只有收件,没有发件箱」。
// 拆成收件 / 发件两格 —— 不是加个筛选标签,因为两者该走**不同的规则**:
// 收件那格有一整套「什么值得留」的取舍(广告/银行流水/会议回执毙掉、机器发的只留几类);
// 发件不需要任何取舍 —— 你自己发出去的,按定义就都值得看见。
type SubTab = 'calendar' | 'email' | 'sent';

/** 左滑删除后留多久的反悔窗口。到点才真删。 */
const UNDO_MS = 6000;

interface Row {
  id: string;
  title: string;
  dateIso: string;
  meta: string;       // 副行(地点/来源/收件人等)
  badge?: string;     // 「有记录」/「会议记录」
  query: string;      // 兜底:详情打不开时按原话去记忆页搜
  /**
   * 图29:点一下直接开这条记忆的详情。
   *
   * 2026-07-31 改成**可选** —— 提醒也进这张列表了(用户:「提醒项目混入日程列表,
   * 和日历同级别」),而提醒不是 life-graph 节点。凡是用到它的地方都得先判空:
   * 提醒行没有节点可开,也没有邮件属性可读。
   */
  node?: LifeNode;
  /** 这一行是一条提醒时,它本身。与 node 二选一 —— 两个都空的行不该存在。 */
  reminder?: Reminder;
  /**
   * Google 自己给的标签(2026-07-30 用户要求「用谷歌的 filter 先筛选」):
   * 日历项 = 事件来自哪个日历;邮件 = Gmail 系统分类 + 重要性预测。
   * 这些不是我们猜的,所以最适合当默认筛选面。
   */
  googleLabels: string[];
  /**
   * 搜索用的正文面(2026-07-30 用户:「模糊搜索,包括全文和 title」)。
   * 这里放的是**节点上带的**预览(summary / article / 原文片段);邮件的完整全文只存
   * 本机 IndexedDB(隐私红线不上云),那部分靠 email-fulltext-index 另外查。
   */
  body: string;
  /**
   * 这一行屏幕上**还看得见的其它字**:状态行(「扣款 · $662.59」)+ 右下角徽章(「账单」)。
   *
   * 2026-07-31 用户实测:自定义筛选「扣款」命中 0,而列表里明明白白有一条写着
   * 「扣款 · $662.59」。根因是那两个字是 mail-badges 从 moneyFlow **派生出来展示的**,
   * 既不在标题里也不在发件人里 —— 屏幕上有的字,搜不到。
   *
   * 这里算一份给筛选用;MailRow 渲染时会再算一次。两处都算**不是两份真源** ——
   * mailStatusLine / mailBadges 是纯函数,同样的 attrs 必然给同样的字。
   */
  extra: string;
}

/** 节点上能当正文用的那几个字段,拼一起(截断,免得几百条 × 1500 字每次输入都全量小写)。 */
function bodyOf(n: LifeNode): string {
  const a = n.attributes || {};
  const pick = (v: unknown) => (typeof v === 'string' ? v : '');
  return `${pick(a.summary)} ${pick(a.article)} ${pick(a.description)} ${n.rawInput || ''}`.slice(0, 2000);
}

const AD_RE = /退订|unsubscribe|优惠|促销|限时|折扣|秒杀|大促|% ?off|sale\b|coupon|deal[s]?\b/i;

/**
 * 邮件子 tab 的取舍(2026-07-28,用户标注 图1)。原话:
 *「只显示重要邮件,个人邮箱发送的有具体内容的、不是商业广告的,学校的通知,
 *  订购旅行信息机票酒店景点订单;不显示于银行交易信息,不显示开会通知信息。」
 *
 * 做法是**两级白名单**,不是一条黑名单:
 *   ① 先毙掉明确不要的:银行流水提醒 / 会议邀请回执 / 广告;
 *   ② 剩下的里,活人发来的(发件地址不像机器人)默认留;
 *      机器发的只留「有具体内容」的那几类:订单物流、机票行程、酒店预订、票务、学校通知。
 * 纯本地正则,零 AI。误杀了往 KEEP_RE 里加词即可。
 */
const BANK_TX_RE = new RegExp([
  '交易提醒|入账|出账|扣款|消费提醒|余额变动|尾号\\s*\\d{4}|信用卡账单',
  'you made a .{0,12}(transaction|transfer)|debit card|credit card (was|has been)',
  'transaction alert|payment (posted|received|sent)|deposit (of|posted)|withdraw(al)?',
  'alerts?@|no\\.?reply\\.alerts',
].join('|'), 'i');

const MEETING_INVITE_RE = new RegExp([
  '会议邀请|邀请你参加|已接受邀请|已拒绝邀请|日程邀请|更新的邀请',
  'invitation:|invited you to|has (accepted|declined)|updated invitation',
  'calendar-notification|zoom\\.us/j/|teams\\.microsoft\\.com/l/meetup',
].join('|'), 'i');

/** 机器发的也值得留的「有具体内容」类目:订单物流 / 旅行 / 票务 / 学校。 */
const KEEP_RE = new RegExp([
  '订单|已发货|发货|快递|物流|运单|签收|退款|订购',
  'order(ed)?|shipped|shipment|tracking|delivered|package|refund',
  '机票|航班|值机|登机|行程单|行程|改签',
  'flight|itinerary|boarding|check-?in|e-?ticket|reservation|booking|confirmation',
  '酒店|入住|退房|民宿|景点|门票|演出|展览',
  'hotel|check-?out|attraction|admission|ticket',
  '学校|老师|班级|家长|家长会|作业|课表|开学|放假|校车',
  'school|teacher|classroom|principal|district|parent|homework|semester|pta\\b',
].join('|'), 'i');

/** 发件地址像不像机器人(no-reply / 通知 / 自动确认)。 */
const ROBOT_FROM_RE = /no-?reply|donot-?reply|auto-?(confirm|reply|notif)|notification|mailer|bounce|postmaster|alerts?@|newsletter/i;

/** 星标 = 节点上的一个标签(复用全 app 的标签体系,不另起存储)。 */

/**
 * 日程里不该出现的「不是具体事情」的条目(2026-07-28,用户标注 图29:
 *「应该只出现有具体事情的,周期提醒、还款、缴费、课程、家务项目不显示」)。
 *
 * 这些多半是从待办 App(滴答清单等)当日历同步进来的循环任务 —— 它们是 checklist,
 * 不是「几点要去哪儿见谁」。日历项里混着它们,真正要赴的约会就被淹掉了。
 * 启发式关键词,宁可漏放几条也别误杀真日程;发现漏网的往这里加。
 */
const CHORE_RE = new RegExp([
  // 还款 / 缴费 / 账单
  '还款|缴费|账单|信用卡|房租|水电|燃气|物业|保险|续费|自动扣款|订阅',
  'bill|payment|due|autopay|rent|invoice|insurance|renew(al)?|subscription',
  // 家务
  '家务|打扫|清洁|洗碗|洗衣|倒垃圾|换床单|拖地|吸尘|除螨|浇花|遛狗|喂猫',
  'clean|laundry|wash|vacuum|trash|garbage|dishes|chore|tidy|declutter',
  // 课程 / 周期提醒
  '课程|上课|打卡|每日|每周|每月|定期|周期|提醒',
  'class\\b|lesson|course|daily|weekly|monthly|recurring|reminder|routine|habit',
].join('|'), 'i');

function stripPrefix(name: string): string {
  return name.replace(/^(会议记录|Meeting notes)\s*·\s*/, '').trim() || name;
}

/**
 * SwipeRow — 一条日程/邮件。2026-07-28 按标注 图1 加左右滑:
 *   右滑(往右拖)= 星标,左滑 = 删除。跟手位移,松手过阈值才执行,没过就弹回去。
 * 只认横向手势:纵向位移更大时立刻放手,免得把页面滚动吃掉。
 */
function SwipeRow({ row, kind, dict, starred, dateLabel, fixes, onOpen, onStar, onDelete, onFixTag }: {
  row: Row; kind: SubTab; dict: 'zh' | 'en'; starred: boolean; dateLabel: string;
  /** 用户改过的标签(这一封 / 发件人规则)。见 lib/portal/mail-tag-fix.ts。 */
  fixes: MailTagFixStore;
  /** 可缺省:提醒行没有记忆节点可开 —— 缺省时整行不再是「可点开」的。 */
  onOpen?: () => void; onStar: () => void; onDelete: () => void;
  /** 点了类型标签 → 打开修正选择器。日历项没有这回事,所以可缺省。 */
  onFixTag?: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; lock: 'none' | 'x' | 'y' } | null>(null);
  /**
   * 这一次手势是不是「不再是一次点击」了 —— 越过 slop、变成纵向滚动、或被系统接管。
   *
   * 2026-07-30 用户实锤:「日程里的上下滑动,很容易打开某个具体的条目」。两个洞叠在一起:
   *   ① 纵向锁定时只做了 `start.current = null; setDx(0)`,没留下「这次是滚动」的记号。
   *      松手时 onUp 看到 dx === 0,`Math.abs(0) < 6` 成立 → **当成点击,打开条目**。
   *      也就是说:任何在条目上起手的上下滑,只要手指最后抬在这一条上,就会打开它。
   *   ② onPointerCancel 直接复用了 onUp。cancel 的语义是「这个手势被接管/中止了」,
   *      浏览器接管滚动时就发它 —— 同样 dx === 0 → 又是一次误开。
   *
   * 修法:把「滑动」和「点击」彻底分家 —— 指针事件只负责位移与左右滑动作,
   * **打开交给真正的 click**(顺带把键盘 Enter/Space 也修好了:此前这是个
   * 没有 onClick 的 <button>,键盘根本打不开),滑动过的那一次把随后的 click 吃掉。
   */
  const swiped = useRef(false);
  const THRESHOLD = 72;
  const SLOP = 6;

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swiped.current = false;
    start.current = { x: e.clientX, y: e.clientY, lock: 'none' };
  };
  const onMove = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const mx = e.clientX - st.x;
    const my = e.clientY - st.y;
    if (st.lock === 'none') {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
      // 一旦越过 slop,这次手势就不再是「点」了 —— 无论它后来往哪个方向走。
      swiped.current = true;
      st.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (st.lock === 'y') { start.current = null; setDx(0); return; }  // 纵向:让页面滚
    }
    setDx(Math.max(-140, Math.min(140, mx)));
  };
  const onUp = () => {
    const moved = dx;
    start.current = null;
    setDx(0);
    // 只判左右滑的两个动作;「打开」不在这里 —— 见下面的 onClickRow。
    if (moved <= -THRESHOLD) onDelete();
    else if (moved >= THRESHOLD) onStar();
  };
  const onCancel = () => {
    // 被系统接管(滚动)或中止:什么都不执行,并且把随后可能来的 click 也吃掉。
    start.current = null;
    setDx(0);
    swiped.current = true;
  };
  const onClickRow = () => {
    if (swiped.current) { swiped.current = false; return; }  // 这一次是滑动,不是点击
    // 没有可开的东西就什么都不做 —— 不留一个点了没反应的行(提醒行就是这种)。
    onOpen?.();
  };

  // 日历条目用星、邮件条目用旗子 —— 背后是同一个收藏夹(pins),只是两种东西
  // 混在一个列表里时,图标得能一眼分开(和邮件客户端「标记」的习惯一致)。
  // 提醒行右滑是**做好了**,不是星标 —— 给一条提醒打星没有意义,而「做好了」是它
  // 唯一要紧的动作(重复的往后滚一期、一次性的进「已完成」)。没有这个入口,
  // 「已完成」那一面就永远是空的:整条链断在这里。
  const isReminder = !!row.reminder;
  const Mark = isReminder ? IconCheck : kind === 'email' ? IconFlag : IconStar;
  const markOn = isReminder
    ? L(dict, '做好了', 'Done')
    : kind === 'email' ? L(dict, '标记', 'Flag') : L(dict, '星标', 'Star');
  const markOff = isReminder
    ? L(dict, '做好了', 'Done')
    : kind === 'email' ? L(dict, '取消标记', 'Unflag') : L(dict, '取消星标', 'Unstar');
  const revealing = dx > 0
    ? { side: 'star' as const, label: starred && !isReminder ? markOff : markOn,
        bg: isReminder ? 'var(--status-go-soft)' : 'var(--status-gentle-soft)',
        fg: isReminder ? 'var(--status-go)' : 'var(--status-gentle)' }
    : { side: 'del' as const, label: L(dict, '删除', 'Delete'), bg: 'var(--status-risk-soft)', fg: 'var(--status-risk)' };

  /* ── 状态一行 + 右下角标签(2026-07-30 用户要求)────────────────────────
     字段本来只在 **Gmail 重新同步**时由路由写进节点。真机实锤(用户:「说在邮件预览
     条目里显示一些状态信息,没有见到」):收件箱里两百多封**全是老节点**,一个字段都没有,
     于是状态行和标签一条都不出现 —— 功能做了,但对已有数据完全不存在,
     而用户无从知道这一点,只会以为没做。

     所以这里补一层**客户端兜底**:节点上没有 orderStatus/kindHint 时,就地拿节点已有的
     标题 + 摘要/正文预览再抽一次(extractEmailLocal 是纯函数、零成本、零网络)。
     立即生效、不等同步、连同步窗口之外的老邮件也有。
     hasAttachment 抽不出来(要 Gmail 的 payload)—— 那个只能等同步,没有就不画,不猜。 */
  const attrs = useMemo(() => {
    const a = row.node?.attributes || {};
    if (kind === 'calendar') return a;                    // 日历项没有这些字段,不白跑正则
    if (a.orderStatus || a.moneyFlow || a.kindHint) return a;  // 同步时已经写好了
    const local = extractEmailLocal(
      row.title,
      typeof a.from === 'string' ? a.from : '',
      row.body,
    );
    return { ...a, ...local } as typeof a;
  }, [row.node?.attributes, row.title, row.body, kind]);
  const status = mailStatusLine(attrs, dict);
  /* 类型标签的最终值:**这一封的修正 > 发件人规则 > 自动判定**(硬优先级)。
     用户亲手改过的那一封,不管规则怎么写、自动判定多有把握,都以他改的为准 ——
     反过来就是「我知道你说了什么,但我觉得我更对」。 */
  const emailId = typeof attrs.emailId === 'string' ? attrs.emailId : '';
  const fromAddr = typeof attrs.from === 'string' ? attrs.from : '';
  const resolvedKind = kind === 'calendar'
    ? null
    : resolveMailKind(typeof attrs.kindHint === 'string' ? attrs.kindHint : undefined, emailId, fromAddr, fixes);
  const badges = mailBadges({ ...attrs, kindHint: resolvedKind ?? undefined }, dict);

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', touchAction: 'pan-y' }}>
      {dx !== 0 && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: revealing.side === 'star' ? 'flex-start' : 'flex-end',
          padding: '0 var(--space-4)', background: revealing.bg, color: revealing.fg,
          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
        }}>{revealing.label}</div>
      )}
      <button type="button"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
        onClick={onClickRow}
        style={{ position: 'relative', display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
          border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
          background: 'var(--glass-bg-solid, var(--portal-bg))', padding: 'var(--space-3) var(--space-4)',
          transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform .18s var(--ease-out, ease)' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {starred && (
              <span style={{ color: 'var(--status-gentle)', marginRight: 'var(--space-1)', display: 'inline-flex', verticalAlign: '-2px' }}>
                <Mark size={13} />
              </span>
            )}{row.title}
          </span>
          <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{dateLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {row.meta && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{row.meta}</span>}
          {/* 和下面那排标签用同一套 padding —— 同一张卡里两种大小的胶囊会显得没对齐 */}
          {row.badge && (
            <span style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', borderRadius: 'var(--radius-pill)', background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{row.badge}</span>
          )}
        </div>

        {/* 在途订单 / 银行流水走到哪一步了(+ 到货时间、金额)。 */}
        {status && (
          <div style={{
            marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-medium)', color: toneVars(status.tone).fg,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{status.text}</div>
        )}

        {/* 右下角:订单 / 账单 / 预约 / 私人 / 有附件。认不出来就一个都不画。 */}
        {badges.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
            {badges.map((b) => {
              const v = toneVars(b.tone);
              // 「有附件」是事实,不是判断,改不了;类型标签(订单/账单/预约/私人)才可改。
              const editable = Boolean(onFixTag) && b.id !== 'attachment';
              return (
                <span
                  key={b.id}
                  /* 为什么是 span[role=button] 而不是 <button>:整行本来就是一个 <button>,
                     HTML 不许 button 里再套 button。把标签挪出去做兄弟节点又会脱离文档流、
                     滑动时不跟手。这是权衡后的取舍 —— 键盘可达性用 tabIndex + onKeyDown 补齐,
                     tap 目标由 CSS 保到 --tap-min。 */
                  {...(editable ? {
                    role: 'button' as const,
                    tabIndex: 0,
                    title: L(dict, '分错了?点一下改', 'Wrong tag? Tap to fix'),
                    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onFixTag!(); },
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault(); e.stopPropagation(); onFixTag!();
                    },
                  } : {})}
                  className={editable ? 'nesio-mailtag nesio-mailtag--editable' : 'nesio-mailtag'}
                  style={{ background: v.bg, color: v.fg }}
                >{b.label}</span>
              );
            })}
          </div>
        )}
      </button>
    </div>
  );
}

/** 提醒类型的人话。模块级 —— 主列表和「已完成」两处都要用,各写一份必然漂移。 */
function kindLabelOf(k: ReminderKind, dict: 'zh' | 'en'): string {
  return L(dict,
    k === 'chore' ? '家务' : k === 'bill' ? '账单' : k === 'event' ? '日程' : '其它',
    k === 'chore' ? 'Chore' : k === 'bill' ? 'Bill' : k === 'event' ? 'Event' : 'Other');
}

/**
 * CompletedReminders —— 做完的提醒,只读的一段流水(2026-07-31)。
 *
 * 用户原话:「应该有已完成提醒查询地方」。在这之前**重复提醒做完不留任何痕迹**
 * (直接滚到下一次),所以「这个月到底交没交房租」根本没有数据能回答。
 * 一次性的看 doneAt、重复的看 doneLog,两种都收在 listCompleted() 里。
 *
 * 这里**不给撤销**:重复提醒的那一次已经滚过去了,撤销它意味着把时间倒回去,
 * 讲不清也做不对。要改就在待办那边改下一次。
 *
 * 待办的提醒**不在这个组件里** —— 它们和日历项同级排在主列表中
 * (用户:「提醒项目混入日程列表,和日历同级别」)。新建也不在这里:
 * 那件事整个交给首页那条输入框(「首页输入框应该可以完成」)。
 */
function CompletedReminders({ dict, tokens }: { dict: 'zh' | 'en'; tokens: readonly string[] }) {
  const [items, setItems] = useState<CompletedEntry[]>([]);
  useEffect(() => {
    const read = () => setItems(listCompleted());
    void scheduleRemindersReady().then(read);
    read();
    window.addEventListener(SCHEDULE_REMINDERS_EVENT, read);
    return () => window.removeEventListener(SCHEDULE_REMINDERS_EVENT, read);
  }, []);

  const shown = items.filter((c) => matchesSearch(
    { title: c.title, meta: kindLabelOf(c.kind, dict), body: '' }, tokens));

  if (shown.length === 0) {
    return (
      <p className="nesio-remind-empty">
        {tokens.length > 0
          ? L(dict, '做完的里面没有匹配的。', 'Nothing finished matches that.')
          : L(dict, '还没有做完的 —— 点一条提醒上的「做好了」,它就会记在这里。',
                    'Nothing finished yet — tap “Done” on a reminder and it lands here.')}
      </p>
    );
  }

  return (
    <ul className="nesio-remind-list">
      {shown.map((c) => {
        const when = parseWallClock(c.at);
        const whenText = when
          ? (dict === 'en'
              ? when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : `${when.getMonth() + 1}月${when.getDate()}日 ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`)
          : c.at;
        return (
          <li key={c.id} className="nesio-remind-item done">
            <div className="nesio-remind-main">
              <span className="nesio-remind-name">{c.title}</span>
              <span className="nesio-remind-when">
                {whenText}
                {` · ${kindLabelOf(c.kind, dict)}`}
                {c.recurring && ` · ${L(dict, '这一次', 'this one')}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}


/**
 * MailSuggestions —— 邮件里像是有约,问一句要不要进日程(2026-07-30 用户要求:
 *「邮件里可以识别明确带有时间的安排,直接放入日程,或者弹出一个提示框,让我确认」)。
 *
 * 用户给了两条路,这里走**确认**那条。不是保守,是因为两条路的代价不对称:
 * 自动写进去错了他不会知道,只会发现日程里多了不认识的东西,而且不知道该去哪儿改;
 * 弹一次确认错了,代价是他按一下「不用了」。
 *
 * 判据在 lib/portal/email-schedule-suggest.ts 里,苛刻到近乎吝啬(必须同时有
 * 明确日历日期 + 明确钟点 + 两者挨得很近)。宁可漏掉一封真有约的信 —— 用户还能
 * 自己在上面那段加 —— 也不要弹一个莫名其妙的框:那种框弹三次,他就再也不看了。
 *
 * 处理过的记在 mail-suggest-state,同一封不问第二遍。
 */
function MailSuggestions({ dict, rows, taken }: {
  dict: 'zh' | 'en';
  rows: Row[];
  /** 日程里**已经有**的那些时刻(日历项 + 我设的提醒)。用来查重。 */
  taken: ScheduledSlot[];
}) {
  const [state, setState] = useState<Record<string, SuggestVerdict>>({});
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const read = () => setState(loadSuggestState());
    void mailSuggestReady().then(read);
    read();
    window.addEventListener(MAIL_SUGGEST_EVENT, read);
    return () => window.removeEventListener(MAIL_SUGGEST_EVENT, read);
  }, []);

  const cands = useMemo(() => {
    const out: Array<{ row: Row; eid: string; at: string; snippet: string }> = [];
    for (const r of rows) {
      const eid = typeof r.node?.attributes?.emailId === 'string' ? r.node.attributes.emailId : '';
      if (!eid || state[eid]) continue;
      const hit = suggestScheduleFromEmail(r.title, r.body, r.dateIso);
      if (!hit) continue;
      /* 日程里已经有了就别再问一遍(2026-07-30 用户实锤:一封 "THIS SATURDAY —
         Virtual Orientation" 被加成了提醒,而同一场活动本来就在 Google 日历里,
         同一件事在同一页出现两遍、名字还不一样,看着像两个约)。
         不提示就是不提示 —— 不必解释「因为日历里有了所以没提」,少一条建议没人会注意到。 */
      const ms = parseWallClock(hit.at)?.getTime();
      if (typeof ms === 'number' && alreadyScheduled(ms, r.title, taken)) continue;
      out.push({ row: r, eid, at: hit.at, snippet: hit.snippet });
      if (out.length >= 12) break;   // 一次最多问 12 封;再多就不是「问一句」了
    }
    return out;
  }, [rows, state, taken]);

  if (!cands.length) return null;

  const decide = (c: { row: Row; eid: string; at: string }, verdict: SuggestVerdict) => {
    setErr('');
    if (verdict === 'added') {
      // 从邮件确认过来的是一个**约**,不是家务/账单 —— 用户原话:
      // 「邮件里添加过来的称谓正常日程,不是我的提醒」。
      const created = addReminder({ title: c.row.title, at: c.at, kind: 'event', sourceEmailId: c.eid });
      // 从存储回读 —— 写没进去就说出来,不能「按了没反应」也不能假装成功
      if (!created || !listReminders().some((r) => r.id === created.id)) {
        setErr(L(dict, '这条没能加进日程,稍后再试一次。', 'Could not add it — try again in a moment.'));
        return;
      }
      createReminderShadow(created);
    }
    markSuggest(c.eid, verdict);
    setState(loadSuggestState());
  };

  const fmt = (at: string) => {
    const d = parseWallClock(at);
    if (!d) return at;
    return dict === 'en'
      ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <section className="nesio-remind">
      <div className="nesio-remind-head">
        <h4 className="nesio-remind-title">
          {L(dict, `这 ${cands.length} 封信里像是写了时间`, `${cands.length} email(s) look like they have a time`)}
        </h4>
        <button type="button" className="nesio-remind-add" onClick={() => setOpen((v) => !v)}>
          {open ? L(dict, '收起', 'Hide') : L(dict, '看看', 'Review')}
        </button>
      </div>

      {open && (
        <ul className="nesio-remind-list">
          {cands.map((c) => (
            <li key={c.eid} className="nesio-remind-item">
              <div className="nesio-remind-main">
                <span className="nesio-remind-name">{c.row.title}</span>
                {/* 把原文里认出来的那一小段摆出来 —— 让用户自己判断我认得对不对,
                    而不是让他相信一个看不见依据的结论。 */}
                <span className="nesio-remind-when">{fmt(c.at)} · 「{c.snippet}」</span>
              </div>
              <div className="nesio-remind-acts">
                <button type="button" className="nesio-remind-act" onClick={() => decide(c, 'added')}>
                  {L(dict, '加进来', 'Add')}
                </button>
                <button type="button" className="nesio-remind-act" onClick={() => decide(c, 'dismissed')}>
                  {L(dict, '不用了', 'No')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="nesio-remind-err">{err}</p>}
    </section>
  );
}

/**
 * MailTagFixSheet —— 标签分错了,自己改(2026-07-30 用户:
 * 「邮件里,某个 tag 分错了,我怎么改,系统会学习到么?」)。
 *
 * 「学习」在这里被**拆成两半**,而且第二半必须用户自己勾:
 *   ① 选一个新标签(或「去掉」)→ **这一封**永久记住,永远盖过自动判定;
 *   ② 下面那个勾选框才是「以后这个发件人都这样」—— 默认不勾。
 *
 * 不做隐式泛化(「你改了一封 Chase 的,所有 Chase 自动跟着变」):
 * 那样改一次会有几十封信悄悄变样,而用户不知道发生了什么、也不知道去哪儿撤销。
 * 和「把邮件标题里的『健身』猜成健康打卡」是同一类错 —— 系统替他做了个他没同意的推广。
 */
function MailTagFixSheet({ row, dict, onClose }: { row: Row; dict: 'zh' | 'en'; onClose: () => void }) {
  const [alsoSender, setAlsoSender] = useState(false);
  const a = row.node?.attributes || {};
  const emailId = typeof a.emailId === 'string' ? a.emailId : '';
  const from = typeof a.from === 'string' ? a.from : '';
  const sender = senderKeyOf(from);

  const label = (k: MailTagFix) => L(dict,
    k === 'order' ? '订单' : k === 'bill' ? '账单' : k === 'booking' ? '预约' : k === 'personal' ? '私人' : '去掉标签',
    k === 'order' ? 'Order' : k === 'bill' ? 'Bill' : k === 'booking' ? 'Booking' : k === 'personal' ? 'Personal' : 'No tag');

  const apply = (k: MailTagFix) => {
    fixMailTag(emailId, k, { from, alsoSender });
    onClose();
  };

  /* 「恢复自动」的两条路,分开给 —— 合成一个按钮会说谎:
     清掉这一封的修正之后,如果发件人规则还在,标签照样被规则改着,
     而按钮上写着「恢复自动判定」。 */
  const fixes = loadMailTagFix();
  const hasMine = Boolean(emailId && fixes.byEmail[emailId]);
  const hasRule = Boolean(sender && fixes.bySender[sender]);

  return (
    <NesioSheet
      variant="bottom"
      open
      elevated
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={L(dict, '改这条的标签', 'Fix this tag')}
    >
      <div className="nesio-brief-head">
        <div>
          <p className="nesio-brief-greeting">{L(dict, '这条应该是', 'This one is')}</p>
          <p className="nesio-brief-date">{row.title}</p>
        </div>
        <button type="button" className="nesio-voice-sheet-close" onClick={onClose}
          aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>
      <div className="nesio-settings-sheet-body">
        {/* 没有 emailId 就**改不了**,而且要在选项**上面**说清楚。
            自查发现的洞:此前这行提示挂在选项下面、选项照常能点,而 fixMailTag 对空 id
            直接 return —— 用户点一下、面板关掉、标签没变,那行小字他根本没看到。
            「按了没反应」的教科书案例,而且是我自己写的。 */}
        {!emailId && (
          <p role="alert" className="nesio-remind-err" style={{ marginBottom: 'var(--space-3)' }}>
            {L(dict, '这条改不了 —— 它没有邮件 id,多半是同步早期留下的旧记录。下次同步后就能改了。',
                  'Cannot change this one — it has no email id (an old record from an earlier sync).')}
          </p>
        )}
        <div className="nesio-remind-row">
          {([...MAIL_TAG_KINDS, 'none'] as MailTagFix[]).map((k) => (
            <button key={k} type="button" className="nesio-schedfilter-chip"
              disabled={!emailId} onClick={() => apply(k)}>
              {label(k)}
            </button>
          ))}
        </div>

        {/* 第二半:**默认不勾**。勾了才写发件人规则。 */}
        {sender && (
          /* 用自己的类,不借 .nesio-settings-option —— ui-consistency 契约禁止 SchedulePanel
             引用那套「设置行」样式(它防的是拿设置行当 tab)。借过来虽然这一处语义没错,
             但会给下一个人开口子,而且契约不区分用途。自己写一个,两边都干净。 */
          <button
            type="button"
            className={`nesio-mailtag-rule${alsoSender ? ' on' : ''}`}
            aria-pressed={alsoSender}
            onClick={() => setAlsoSender((v) => !v)}
          >
            <span>
              <span className="nesio-mailtag-rule-label">
                {L(dict, `以后 ${sender} 都这样`, `Apply to all from ${sender}`)}
              </span>
              <span className="nesio-mailtag-rule-hint">
                {L(dict, '不勾就只改这一封。勾了会立刻影响这个发件人的其它邮件。',
                      'Unchecked changes just this email. Checked affects every email from this sender.')}
              </span>
            </span>
            <span className="nesio-mailtag-rule-check" aria-hidden>{alsoSender ? '✓' : '○'}</span>
          </button>
        )}

        {/* 改过之后才给「恢复自动」—— 没改过时点它什么都不会变,那就是个假按钮。 */}
        {(hasMine || hasRule) && (
          <div className="nesio-remind-row" style={{ marginTop: 'var(--space-3)' }}>
            {hasMine && (
              <button type="button" className="nesio-schedfilter-chip"
                onClick={() => { clearMailTagFix(emailId); onClose(); }}>
                {L(dict, '恢复自动判定', 'Back to automatic')}
              </button>
            )}
            {hasRule && (
              <button type="button" className="nesio-schedfilter-chip"
                onClick={() => { removeSenderRule(sender); onClose(); }}>
                {L(dict, `删掉「${sender} 都这样」这条规则`, `Remove the rule for ${sender}`)}
              </button>
            )}
          </div>
        )}

      </div>
    </NesioSheet>
  );
}

// 图29 之后不再需要 onOpenMemory —— 点条目就地开详情,不跳记忆页。
export default function SchedulePanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [sub, setSub] = useState<SubTab>('calendar');
  // 「已完成」是日程这一面的另一半,不是另一个页面 —— 切过去看一眼就能切回来。
  const [showDone, setShowDone] = useState(false);
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  // 图29「点击应该直接进入对应记忆,而不是记忆页」:就地开这条记忆的详情。
  const [openNode, setOpenNode] = useState<LifeNode | null>(null);
  // 图1「增加左滑右滑动作,删除和星标」:右滑加星、左滑删掉这条。
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  // 待删(可撤销)。离开本页时立刻结算,见下面的 effect。
  const [pending, setPending] = useState<{ row: Row; timer: number } | null>(null);
  const [delErr, setDelErr] = useState('');
  // 一排筛选标签(2026-07-30):自定义定义落盘,选中项不落盘。
  const [customs, setCustoms] = useState<CustomFilter[]>([]);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [addingFilter, setAddingFilter] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);   // 发件箱里直接写一封
  const [fName, setFName] = useState('');
  const [fKeyword, setFKeyword] = useState('');
  /**
   * 正在改哪一个自定义筛选(2026-07-31 用户:「如果确实不管用,我希望可以修改,现在不行」)。
   * null = 新建。以前只有「长按/右键删」——手机上长按常被系统的文本选择抢走,
   * 于是一个建错了的筛选事实上既改不了也删不掉。
   */
  const [editId, setEditId] = useState<string | null>(null);
  // 搜索框(2026-07-30)。不落盘 —— 和筛选同理,记住上次的搜索词会让人以为数据少了。
  const [q, setQ] = useState('');
  // 用户改过的标签(这一封 / 发件人规则)。见 lib/portal/mail-tag-fix.ts —— 只记他改的,不隐式泛化。
  const [tagFixes, setTagFixes] = useState<MailTagFixStore>({ byEmail: {}, bySender: {} });
  const [fixing, setFixing] = useState<Row | null>(null);
  useEffect(() => {
    const read = () => setTagFixes(loadMailTagFix());
    void mailTagFixReady().then(read);
    read();
    window.addEventListener(MAIL_TAG_FIX_EVENT, read);
    return () => window.removeEventListener(MAIL_TAG_FIX_EVENT, read);
  }, []);
  // 本机全文索引好了没。没好之前只能搜到标题/发件人/正文预览,得说出来。
  const [ftReady, setFtReady] = useState(false);
  useEffect(() => {
    if (emailFulltextReady()) { setFtReady(true); return; }
    let alive = true;
    void ensureEmailFulltextIndex().then(() => { if (alive) setFtReady(emailFulltextReady()); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const read = () => setCustoms(listCustomFilters());
    void scheduleFiltersReady().then(read);
    read();
    window.addEventListener(SCHEDULE_FILTERS_EVENT, read);
    return () => window.removeEventListener(SCHEDULE_FILTERS_EVENT, read);
  }, []);

  // 星标 = 全 app 那一个收藏夹(lib/portal/pins),不是这一页私有的标记。
  // 第一版把它写成节点上的「星标」标签,结果是:这里加的星在记忆页收藏夹里看不到、
  // 收藏夹里收的日程这里也不亮 —— 两套并行的「标记重要」,而且那个标签还会当成
  // 普通标签显示在记忆卡上。
  useEffect(() => {
    const read = () => setStarred(new Set(loadPins()));
    read();
    window.addEventListener(PINS_UPDATED_EVENT, read);
    return () => window.removeEventListener(PINS_UPDATED_EVENT, read);
  }, []);

  const toggleStar = (r: Row) => {
    // 提醒行的这个动作是**做好了**,不是星标。重复的往后滚一期并留一条完成记录,
    // 一次性的打勾进「已完成」—— 这是提醒在这份列表里唯一要紧的动作。
    if (r.reminder) {
      completeReminder(r.reminder.id);
      setReminders(listReminders());
      return;
    }
    togglePin(r.id);
    // 从**存储的真相**回读,而不是拿 togglePin 的返回值。它算的是「本该变成什么」,
    // 配额满写不进去时照样返回 true —— 星会亮,刷新就没了(全局横幅虽然会亮,
    // 但这一格本身在说谎)。回读一次,写没成功星就不亮,眼见即所存。
    setStarred(new Set(loadPins()));
  };

  /**
   * 左滑删除 —— **先隐藏,给一段撤销时间,到点才真删**。
   *
   * 第一版是滑一下就 deleteLifeNode:一个手势永久删掉一条记忆,既没确认也没撤销。
   * 而全 app 别处删东西(记忆详情 / 物品 / 关系 / 搭配记录)都要确认 —— 偏偏最容易
   * 误触的滑动手势没有出口。滑动上弹确认框又会把「快」这个唯一优点抵消掉,
   * 所以走撤销条:符合 warm-coach「每个动作都留后路」,也不打断手势的节奏。
   *
   * 到点真删、或离开这一页时立刻结算(所见即所得,不会走开一趟回来它又冒出来)。
   * 删除写失败(返回 false)就把行放回来并显式报错,不假装成功。
   */
  const commitDelete = (id: string) => {
    // 提醒行删的是**提醒**(连同它在时间线上的身影),不是某个记忆节点 ——
    // 按 life-graph 的 id 去删只会一无所获,而那一行已经从界面上消失了。
    if (id.startsWith('rem:')) {
      const rid = id.slice(4);
      removeReminder(rid);
      removeReminderShadow(rid);
      return;
    }
    if (!deleteLifeNode(id)) {
      setGone((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setDelErr(L(dict, '这条没能删掉,已经放回来了。', 'Could not delete — it is back in the list.'));
    }
  };

  const removeRow = (r: Row) => {
    if (pending) { window.clearTimeout(pending.timer); commitDelete(pending.row.id); }
    setDelErr('');
    setGone((prev) => new Set(prev).add(r.id));
    const timer = window.setTimeout(() => { commitDelete(r.id); setPending(null); }, UNDO_MS);
    setPending({ row: r, timer });
  };

  // 结算待删。① 组件卸载(切走 tab / 关掉洞察)—— 实测有效,离开就真删。
  // ② pagehide(刷新/关页)—— **尽力而为,不保证**:图谱最终落在 IndexedDB,
  //    异步写在页面拆卸时来不及完成(实测过:反悔窗口内硬刷新,那条会回来)。
  //    这个失败方向是安全的(数据活着而不是消失),所以接受;但别在文案里
  //    承诺「一定删掉了」。真要做到,得给删除加持久化的墓碑,那是另一件事。
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const flush = () => {
      const p = pendingRef.current;
      if (!p) return;
      window.clearTimeout(p.timer);
      pendingRef.current = null;
      deleteLifeNode(p.row.id);
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const undoDelete = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    setGone((prev) => { const next = new Set(prev); next.delete(pending.row.id); return next; });
    setPending(null);
  };

  // 提醒和日历项**同级**排在一张列表里(用户:「提醒项目混入日程列表,和日历同级别」)。
  // 它们不是 life-graph 节点,所以单独订阅一份 —— 但排序、搜索、筛选走的是同一条路。
  const [reminders, setReminders] = useState<Reminder[]>([]);
  useEffect(() => {
    const read = () => setReminders(listReminders());
    void scheduleRemindersReady().then(read);
    read();
    window.addEventListener(SCHEDULE_REMINDERS_EVENT, read);
    return () => window.removeEventListener(SCHEDULE_REMINDERS_EVENT, read);
  }, []);

  useEffect(() => {
    const load = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    window.addEventListener('nesio-calendar-updated', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
      window.removeEventListener('nesio-calendar-updated', load);
    };
  }, []);

  const calendarRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    // 图29「排序应该由近到远」:今天 0 点以后的先按时间正序排;更早的(已经过去的)排在后面、倒序。
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    for (const n of nodes) {
      const a = n.attributes || {};
      if (n.source === 'calendar') {
        const start = typeof a.start === 'string' ? a.start : n.createdAt;
        // 图29「全天日历不显示」:allDay 标记,或 start 只有日期没有时刻(YYYY-MM-DD)。
        const allDay = a.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(start.trim());
        if (allDay) continue;
        // 图29「只出现有具体事情的」:循环提醒 / 还款缴费 / 课程 / 家务不进日程。
        if (CHORE_RE.test(n.name)) continue;
        out.push({
          id: n.id,
          title: n.name,
          dateIso: start,
          meta: typeof a.location === 'string' && a.location ? a.location : (typeof a.calendarName === 'string' ? a.calendarName : ''),
          badge: a.meetingRecordId ? L(dict, '有记录', 'notes') : undefined,
          // 屏幕上这一行还看得见的字。日历项没有状态行,只有那枚徽章。
          extra: a.meetingRecordId ? L(dict, '有记录', 'notes') : '',
          query: n.name,
          node: n,
          googleLabels: [
            // 来自哪个日历 —— Google 日历里用户自己分的那些栏,天然就是他要的筛选面
            ...(typeof a.calendarName === 'string' && a.calendarName ? [a.calendarName] : []),
            ...(a.meetingRecordId ? [L(dict, '有记录', 'Has notes')] : []),
          ],
          body: bodyOf(n),
        });
      } else if ((n.tags || []).includes('meeting-notes') && !a.calendarNodeId) {
        // 未挂到日历的独立会议记录(Granola/录音)也留在日程里
        out.push({
          id: n.id,
          title: stripPrefix(n.name),
          dateIso: typeof a.recordedAt === 'string' ? a.recordedAt : n.createdAt,
          meta: (n.tags || []).includes('Granola') ? 'Granola' : L(dict, '录音', 'Recording'),
          badge: L(dict, '会议记录', 'meeting'),
          extra: L(dict, '会议记录', 'meeting'),
          query: stripPrefix(n.name),
          node: n,
          googleLabels: [L(dict, '会议记录', 'Meeting notes')],
          body: bodyOf(n),
        });
      }
    }
    // 提醒进同一张列表。**做完的不进** —— 它们在「已完成」那一面,混进待办里
    // 会让人以为还没做。CHORE_RE 那道过滤只管日历项(挡的是待办 App 同步进来的
    // 循环任务),提醒是用户亲手设的,一个字都不许被关键词吃掉。
    for (const r of reminders) {
      if (r.doneAt) continue;
      const rep = repeatLabel(r, dict);
      out.push({
        id: `rem:${r.id}`,
        title: r.title,
        dateIso: r.at,
        meta: [kindLabelOf(r.kind, dict), rep].filter(Boolean).join(' · '),
        badge: L(dict, '提醒', 'reminder'),
        extra: L(dict, '提醒', 'reminder'),
        query: r.title,
        reminder: r,
        googleLabels: [L(dict, '我设的提醒', 'My reminders')],
        body: r.note || '',
      });
    }

    const t0 = todayStart.getTime();
    const ms = (r: Row) => { const v = new Date(r.dateIso).getTime(); return Number.isNaN(v) ? 0 : v; };
    // 展示层去重(真机 2026-07-29:同一场会两条)。同步侧按 calendarId / `标题|start 原文` 去重,
    // 但**订阅了同一场会的多个日历**给出的 start 字符串时区写法可能不同(Z / +08:00),
    // 原文比对认不出是同一件事。这里按「标题|绝对时刻」再收一次,时区写法差异自然抹平。
    const seen = new Set<string>();
    const deduped = out.filter((r) => {
      const k = `${r.title}|${ms(r)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const upcoming = deduped.filter((r) => ms(r) >= t0).sort((x, y) => ms(x) - ms(y));   // 近 → 远
    const past = deduped.filter((r) => ms(r) < t0).sort((x, y) => ms(y) - ms(x));        // 刚过去的先
    return [...upcoming, ...past];
  }, [nodes, reminders, dict]);

  /** 这条是不是我发出去的。老节点没有这个字段 → 当收件(和改之前的行为一致,不让旧数据凭空消失)。 */
  const isSent = (n: LifeNode) => (n.attributes || {}).mailDirection === 'sent';

  const emailRows = useMemo<Row[]>(() => {
    return nodes
      .filter((n) => n.source === 'email')
      // 已发送的挪去「发件」那格 —— 此前它们混在收件里认不出来:
      // 自己发的邮件发件人就是自己,ROBOT_FROM_RE 认不出是机器,于是当「活人发的」留下了。
      .filter((n) => !isSent(n))
      .filter((n) => {
        const a = n.attributes || {};
        const from = `${typeof a.from === 'string' ? a.from : ''} ${typeof a.sender === 'string' ? a.sender : ''}`;
        const body = typeof n.rawInput === 'string' ? n.rawInput : '';
        const hay = `${n.name} ${from} ${body}`;
        // ⓪ Gmail 自己的分类标签优先(gmail 路由已把 labelIds 归一成 mailCategory 存在节点上):
        //    promotions/social 是 Google 的判定,比这里猜关键词准得多;没有该字段的老节点
        //    (或非 Gmail 来源)才退回下面的本地正则。
        const cat = typeof a.mailCategory === 'string' ? a.mailCategory : '';
        if (cat === 'promotions' || cat === 'social') return false;
        if (!cat && AD_RE.test(hay)) return false;       // ① 广告(仅无官方分类时靠正则猜)
        // ① 银行流水提醒 —— 2026-07-30 用户把这条**反过来**要了:
        //    「如果是银行的显示 payment、收款、扣款状态」。
        //    但 2026-07-28 的「不显示银行交易信息」也不是随口说的:那时的抱怨是它刷屏、没内容。
        //    两条都成立,所以判据改成正向的:**认得出资金方向的留下**(那正是他现在要看的
        //    那种:收款/扣款/退款/待付),认不出的照旧毙掉(那才是纯噪音)。
        //    老节点没有 moneyFlow 字段 → 维持原样隐藏,下次同步后才浮上来。
        if (BANK_TX_RE.test(hay) && !a.moneyFlow) return false;
        if (MEETING_INVITE_RE.test(hay)) return false;   // ① 开会通知/邀请回执
        // Gmail 标了 IMPORTANT 的(节点带「重要」tag)直接留 —— Google 的重要性预测看的是
        // 你自己的收信行为,比白名单更贴个人。
        if ((n.tags || []).includes('重要')) return true;
        if (!ROBOT_FROM_RE.test(from)) return true;      // ② 活人发的,留
        // ② 机器发的:只留订单/旅行/票务/学校,外加**抽到了明确状态**的那些 ——
        //    银行的收款/扣款、商家的已发货/已送达。KEEP_RE 是关键词白名单,
        //    覆盖不到「Payment posted」这类写法;有 moneyFlow/orderStatus 说明
        //    发件人自己已经把状态写明了,那就是有内容,不是噪音。
        return KEEP_RE.test(hay) || Boolean(a.moneyFlow) || Boolean(a.orderStatus);
      })
      .map((n) => {
        const a = n.attributes || {};
        const cat = typeof a.mailCategory === 'string' ? a.mailCategory : '';
        const from = typeof a.from === 'string' ? a.from : (typeof a.sender === 'string' ? a.sender : '');
        const body = bodyOf(n);
        // 和 MailRow 里同一套推导(同步没写好这几个字段时才现算),
        // 这样标签上的计数和屏幕上真看得见的字是一回事。
        const facets = (a.orderStatus || a.moneyFlow || a.kindHint)
          ? a
          : { ...a, ...extractEmailLocal(n.name, from, body) } as typeof a;
        const st = mailStatusLine(facets, dict);
        const bg = mailBadges(facets, dict);
        return {
          id: n.id,
          title: n.name,
          dateIso: typeof a.date === 'string' ? a.date : n.createdAt,
          meta: from,
          query: n.name,
          node: n,
          extra: [st?.text || '', ...bg.map((b) => b.label)].filter(Boolean).join(' '),
          // Gmail 自己的判定:重要性预测 + 系统分类。promotions/social 在上面已被毙掉,
          // 所以这里长不出那两个标签 —— 正合「只给筛得出东西的标签」。
          googleLabels: [
            ...((n.tags || []).includes('重要') ? [L(dict, '重要', 'Important')] : []),
            ...(cat === 'updates' ? [L(dict, '通知', 'Updates')] : []),
            ...(cat === 'forums' ? [L(dict, '论坛', 'Forums')] : []),
            ...(cat === 'personal' ? [L(dict, '个人', 'Personal')] : []),
          ],
          body,
        } as Row;
      })
      // 展示层去重:同一封邮件(emailId)只留一条。同步侧已按 emailId upsert,
      // 这里兜住历史遗留的重复节点(富化认不出源邮件时曾建过无 emailId 的副本)。
      .filter((r, i, arr) => {
        const eid = typeof r.node?.attributes?.emailId === 'string' ? r.node.attributes.emailId : '';
        if (!eid) return true;
        return arr.findIndex((o) => o.node?.attributes?.emailId === eid) === i;
      })
      // 邮件时间以邮件头为准;字符串比大小对 RFC2822 头(「Tue, 29 Jul…」)是错的,按时刻排。
      .sort((x, y) => {
        const mx = new Date(x.dateIso).getTime() || 0;
        const my = new Date(y.dateIso).getTime() || 0;
        return my - mx;
      });
  }, [nodes, dict]);

  /**
   * 发件箱。规则刻意只有一条:是我发的就显示。
   * 收件那格的一整套取舍(广告/银行/会议回执/机器发件人白名单)在这里**一条都不用** ——
   * 你自己按了发送的东西,没有「值不值得看见」的问题。
   */
  const sentRows = useMemo<Row[]>(() => nodes
    .filter((n) => n.source === 'email' && isSent(n))
    .map((n) => {
      const a = n.attributes || {};
      const to = typeof a.to === 'string' ? a.to : '';
      return {
        id: n.id,
        title: n.name,
        dateIso: typeof a.date === 'string' ? a.date : n.createdAt,
        // 收件看「谁发来的」,发件看「发给谁」—— 副行换一个方向。
        meta: to ? L(dict, `发给 ${to}`, `To ${to}`) : L(dict, '我发出的', 'Sent by me'),
        query: n.name,
        node: n,
        googleLabels: (n.tags || []).includes('重要') ? [L(dict, '重要', 'Important')] : [],
        body: bodyOf(n),
      } as Row;
    })
    // 同一封只留一条(与收件同样的兜底:历史上曾建过无 emailId 的副本)
    .filter((r, i, arr) => {
      const eid = typeof r.node?.attributes?.emailId === 'string' ? r.node.attributes.emailId : '';
      if (!eid) return true;
      return arr.findIndex((o) => o.node?.attributes?.emailId === eid) === i;
    })
    .sort((x, y) => (new Date(y.dateIso).getTime() || 0) - (new Date(x.dateIso).getTime() || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [nodes, dict]);

  const allRows = (sub === 'calendar' ? calendarRows : sub === 'sent' ? sentRows : emailRows)
    .filter((r) => !gone.has(r.id));

  /* ── 搜索(2026-07-30 用户:「日历和邮件增加搜索,模糊搜索,包括全文和 title」)──
     命中面三层:标题 / 副行 / 节点上的正文预览 —— 这三层是同步的,输入即筛。
     第四层是**本机全文**:邮件正文只存本机 IndexedDB(隐私红线不上云),
     由 email-fulltext-index 提供一个同步查询 + 后台水合。索引没好之前全文那层查不到,
     这件事必须**显式告诉用户**(见下面的 ftHint)—— 不然他会以为「这封信不在里面」。 */
  const tokens = useMemo(() => searchTokens(q), [q]);
  const searched = useMemo(() => {
    if (!tokens.length) return allRows;
    return allRows.filter((r) => {
      const eid = typeof r.node?.attributes?.emailId === 'string' ? r.node.attributes.emailId : '';
      const ftHas = eid ? (tk: string) => emailFulltextScore(eid, [tk], '') > 0 : undefined;
      return matchesSearch(r, tokens, ftHas);
    });
    // allRows 每次渲染都是新数组;按内容摘要当依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows.map((r) => r.id).join(','), tokens.join(' '), ftReady]);

  const baseRows = searched;

  /* ── 一排筛选标签(2026-07-30 用户要求)────────────────────────────────
     标签面 = Google 自己的分类(日历名 / Gmail 系统分类与重要性)+ 用户自建的关键词。
     两个 tab 各算各的:日历名不该出现在邮件那一排。
     标签是**在搜索结果之上**长出来的:数字必须等于点下去真能看到的条数,
     否则「工作 12」点进去只有 3 条,比没有这个数字更糟。
     选中项**不落盘** —— 记住上次的筛选会让人下次进来以为数据少了。 */
  const chips = useMemo(
    () => buildChips(baseRows, customs),
    // baseRows 每次渲染都是新数组,用它当依赖会每帧重算;按内容摘要算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseRows.map((r) => `${r.id}:${r.googleLabels.join('|')}`).join(','), customs],
  );
  // 切 tab 时清掉选中 —— 邮件那排的标签在日历里根本不存在,留着就是筛出 0 条。
  useEffect(() => { setActiveChip(null); }, [sub]);
  // 搜索把某个 Google 标签筛没了时也要松开它,否则没有任何标签高亮、
  // 列表却是全量 —— 界面在说一件和事实不符的事。
  useEffect(() => {
    if (activeChip && !chips.some((c) => c.id === activeChip)) setActiveChip(null);
  }, [chips, activeChip]);
  /* 日程里**已经占着**的时刻:日历项 + 我自己设的提醒。
     邮件建议拿它查重 —— 已经有的事不再问第二遍。 */
  const takenSlots = useMemo<ScheduledSlot[]>(() => {
    const out: ScheduledSlot[] = [];
    for (const r of calendarRows) {
      const ms = new Date(r.dateIso).getTime();
      if (Number.isFinite(ms)) out.push({ ms, title: r.title });
    }
    try {
      for (const r of listReminders()) {
        if (r.doneAt) continue;
        const d = parseWallClock(r.at);
        if (d) out.push({ ms: d.getTime(), title: r.title });
      }
    } catch { /* 读不到提醒不影响查重的另一半 */ }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarRows, nodes]);

  const chosen = activeChip ? chips.find((c) => c.id === activeChip) ?? null : null;
  const rows = chosen ? baseRows.filter((r) => matchesChip(r, chosen)) : baseRows;

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };



  return (
    <div className="nesio-analytics-tab">
      {/* 2026-07-29:这两个 tab 原本借的是 .nesio-settings-option ——「设置行」的样式,
          既不是 tab、也和另外四套 tab 都不一样。统一到 SegTabs;
          条数从 label 里拆出来走 badge,两个 tab 的文字才对得齐。 */}
      <SegTabs
        items={[
          { key: 'calendar' as SubTab, label: L(dict, '日历项', 'Calendar'), badge: calendarRows.length },
          { key: 'email' as SubTab, label: L(dict, '收件', 'Inbox'), badge: emailRows.length },
          { key: 'sent' as SubTab, label: L(dict, '发件', 'Sent'), badge: sentRows.length },
        ]}
        active={sub}
        onSelect={setSub}
        ariaLabel={L(dict, '日程视图', 'Schedule view')}
      />

      {/* ── 搜索(2026-07-30 用户要求「日历和邮件增加搜索,模糊搜索,包括全文和 title」)──
          放在筛选标签**上面**:先搜后筛,标签的数字也跟着搜索结果走。 */}
      <div className="nesio-schedsearch">
        <input
          className="nesio-schedsearch-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={sub === 'calendar'
            ? L(dict, '搜日程:标题、地点、日历名…', 'Search: title, place, calendar…')
            : L(dict, '搜邮件:标题、发件人、正文…', 'Search: subject, sender, body…')}
          aria-label={L(dict, '搜索', 'Search')}
        />
        {q && (
          <button type="button" className="nesio-schedsearch-clear" onClick={() => setQ('')}
            aria-label={L(dict, '清空搜索', 'Clear search')}>✕</button>
        )}
      </div>
      {/* 全文那一层还没准备好时说清楚 —— 否则「搜不到」会被当成「这封信不在里面」。
          这不是错误,所以用中性色,也不给重试按钮:它自己会好。 */}
      {tokens.length > 0 && sub !== 'calendar' && !ftReady && (
        <p className="nesio-schedsearch-hint">
          {L(dict, '正文全文还在本机准备中,这会儿搜的是标题、发件人和摘要。',
                'Full text is still loading on this device — searching title, sender and preview for now.')}
        </p>
      )}

      {/* ── 一排筛选标签(2026-07-30 用户要求「用谷歌的 filter 先筛选,我也可以自定义」)──
          左边是 Google 自己给的(日历名 / Gmail 系统分类与重要性),右边是用户自建的关键词。
          Google 标签只在**当前数据里真有**的时候才出现;自定义标签哪怕这会儿命中 0 条
          也留着 —— 那是用户亲手建的东西,悄悄藏起来他会以为丢了(数字会写 0)。 */}
      {(chips.length > 0 || customs.length > 0 || baseRows.length > 0) && (
        <div className="nesio-schedfilter">
          <div className="nesio-schedfilter-row" role="group" aria-label={L(dict, '筛选', 'Filters')}>
            <button
              type="button"
              className={`nesio-schedfilter-chip${activeChip === null ? ' on' : ''}`}
              onClick={() => setActiveChip(null)}
            >
              {L(dict, '全部', 'All')} <span className="n">{baseRows.length}</span>
            </button>
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`nesio-schedfilter-chip${activeChip === c.id ? ' on' : ''}${c.kind === 'custom' ? ' mine' : ''}`}
                onClick={() => setActiveChip(activeChip === c.id ? null : c.id)}
                onContextMenu={c.kind === 'custom' ? (e) => { e.preventDefault(); removeCustomFilter(c.id); if (activeChip === c.id) setActiveChip(null); } : undefined}
                title={c.kind === 'custom' ? L(dict, `自定义 · 含「${c.keyword}」(长按/右键删)`, `Custom · contains “${c.keyword}”`) : undefined}
              >
                {c.label} <span className="n">{c.count}</span>
              </button>
            ))}
            <button type="button" className="nesio-schedfilter-add"
              onClick={() => { setEditId(null); setFName(''); setFKeyword(''); setAddingFilter((v) => !v); }}
              aria-label={L(dict, '自定义一个筛选', 'Add a filter')}>+</button>
          </div>

          {/* 选中自己建的标签时,给一条「改一改」。
              放在 chip **外面**而不是 chip 里挂个小铅笔:chip 是 button,
              按钮不能嵌按钮 —— 硬塞的下场刚在时间线那个 ✕ 上见过(掉到下一行还点不动)。 */}
          {chosen?.kind === 'custom' && !addingFilter && (
            <button
              type="button"
              className="nesio-schedfilter-btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setEditId(chosen.id);
                setFName(chosen.label);
                setFKeyword(chosen.keyword);
                setAddingFilter(true);
              }}
            >
              {L(dict, `改一改「${chosen.label}」`, `Edit “${chosen.label}”`)}
            </button>
          )}

          {addingFilter && (
            <div className="nesio-schedfilter-form">
              <input className="nesio-schedfilter-input" value={fName} onChange={(e) => setFName(e.target.value)}
                placeholder={L(dict, '叫什么(如:孩子学校)', 'Name it')} />
              <input className="nesio-schedfilter-input" value={fKeyword} onChange={(e) => setFKeyword(e.target.value)}
                placeholder={L(dict, '含哪个词', 'Contains which word')} />
              {/* 改的时候先说清楚它现在能筛出几条 —— 用户是因为「命中 0」才来改的,
                  改完立刻看得见有没有用,比让他关掉表单再数一遍强。 */}
              {fKeyword.trim() && (
                <p className="nesio-schedsearch-hint" style={{ margin: 0 }}>
                  {L(dict,
                    `含「${fKeyword.trim()}」的有 ${baseRows.filter((r) => matchesCustom(r, fKeyword)).length} 条`,
                    `${baseRows.filter((r) => matchesCustom(r, fKeyword)).length} match “${fKeyword.trim()}”`)}
                </p>
              )}
              <div className="nesio-schedfilter-actions">
                {editId && (
                  <button type="button" className="nesio-schedfilter-btn"
                    onClick={() => {
                      removeCustomFilter(editId);
                      if (activeChip === editId) setActiveChip(null);
                      setAddingFilter(false); setEditId(null); setFName(''); setFKeyword('');
                    }}>
                    {L(dict, '删掉', 'Delete')}
                  </button>
                )}
                <button type="button" className="nesio-schedfilter-btn" onClick={() => { setAddingFilter(false); setEditId(null); setFName(''); setFKeyword(''); }}>
                  {L(dict, '稍后', 'Later')}
                </button>
                <button type="button" className="nesio-schedfilter-btn pri" disabled={!fName.trim() || !fKeyword.trim()}
                  onClick={() => {
                    if (editId) updateCustomFilter(editId, { name: fName, keyword: fKeyword });
                    else addCustomFilter(fName, fKeyword);
                    setAddingFilter(false); setEditId(null); setFName(''); setFKeyword('');
                  }}>
                  {editId ? L(dict, '改好了', 'Save') : L(dict, '加进来', 'Add')}
                </button>
              </div>
              {/* 说清它到底怎么匹配 —— 用户能预测结果,才敢用。不做隐式语义匹配。 */}
              <p className="nesio-schedfilter-hint">
                {L(dict, '按词筛:标题或发件人/地点里含这个词就算。不区分大小写。',
                      'Keyword filter: matches the title or the sender/location line. Case-insensitive.')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 发件箱的入口不只是「看已发送」—— 在这一格里写一封新的才是完整闭环。
          写信面板(EmailComposeSheet)本来只挂在记忆详情和聊天里,从日程页够不着。 */}
      {sub === 'sent' && (
        <button type="button" className="nesio-schedfilter-btn pri" style={{ width: '100%', marginBottom: 'var(--space-2)' }}
          onClick={() => setComposeOpen(true)}>
          {L(dict, '写一封', 'Write one')}
        </button>
      )}

      {/* 提醒的**待办**已经和日历项同级混在下面那份列表里了;这里只留一个
          「已完成」的入口 —— 它是另一面,不是另一个页面。新建整个交给首页输入框。 */}
      {sub === 'calendar' && (
        <div className="nesio-remind-head">
          <button type="button" className="nesio-remind-add" onClick={() => setShowDone((v) => !v)}>
            {showDone ? L(dict, '← 回到日程', '← Back to schedule') : L(dict, '看已完成的提醒', 'Finished reminders')}
          </button>
        </div>
      )}
      {sub === 'calendar' && showDone && <CompletedReminders dict={dict} tokens={tokens} />}

      {/* 收件里像是有约的那几封,问一句要不要进日程。用**未经搜索/筛选**的全量
          (emailRows)—— 这件事和「我这会儿在找什么」无关,不该被搜索框藏起来。 */}
      {sub === 'email' && <MailSuggestions dict={dict} rows={emailRows} taken={takenSlots} />}

      {sub === 'calendar' && showDone ? null : rows.length === 0 ? (
        <p className="nesio-insights-empty">
          {/* 筛出 0 条 ≠ 没有数据。不说清是筛没的,用户会以为东西丢了。
              搜索和标签是两件事,分开说 —— 「搜不到」和「这个标签下没有」要给不同的出口。 */}
          {tokens.length > 0
            ? L(dict, `搜「${q.trim()}」没有找到 —— 换个词,或清空搜索看全部。`, `Nothing matches “${q.trim()}” — try another word, or clear the search.`)
            : chosen
            ? L(dict, `「${chosen.label}」下没有 —— 点上面的「全部」看回来。`, `Nothing under “${chosen.label}” — tap All to see everything.`)
            : sub === 'calendar'
              ? L(dict, '还没有日程 —— 到「设置 → 数据接入」连 Google 日历,或连 Granola 同步会议。', 'No schedule yet — connect Google Calendar or Granola in Data sources.')
              : sub === 'sent'
                // 发件箱是这次新加的 —— 老同步下来的邮件节点没有方向字段,得等下一次同步补上。
                // 空着的时候把这件事说清楚,而不是让人以为「我明明发过邮件」。
                ? L(dict, '这里还没有 —— 已发送是随 Gmail 同步一起进来的,下次同步后就有了(这之前同步的邮件没记方向,会在下次同步时补上)。', 'Nothing here yet — sent mail arrives with the next Gmail sync (mail synced before this update gets its direction filled in then).')
                : L(dict, '还没有邮件 —— 到「设置 → 数据接入」连 Gmail 同步(广告已自动过滤)。', 'No mail yet — connect Gmail in Data sources (ads auto-filtered).')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rows.slice(0, 60).map((r) => (
            <SwipeRow key={r.id} row={r} kind={sub} dict={dict} starred={starred.has(r.id)} dateLabel={fmtDay(r.dateIso)}
              fixes={tagFixes}
              /* 提醒行没有记忆节点可开 —— 传 undefined,SwipeRow 那边就不画「打开」这条路,
                 而不是画一个点了什么也不会发生的按钮。 */
              onOpen={r.node ? () => setOpenNode(r.node!) : undefined}
              onStar={() => toggleStar(r)} onDelete={() => removeRow(r)}
              onFixTag={sub === 'calendar' ? undefined : () => setFixing(r)} />
          ))}
        </div>
      )}

      {/* 删除的后路:到点(UNDO_MS)才真删,这段时间里随时能拿回来。 */}
      {pending && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)',
          background: 'var(--status-calm-soft)', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)',
        }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {L(dict, `「${pending.row.title}」已移走`, `Removed “${pending.row.title}”`)}
          </span>
          <button type="button" onClick={undoDelete} style={{
            flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)', color: 'var(--portal-accent)',
          }}>{L(dict, '拿回来', 'Undo')}</button>
        </div>
      )}

      {delErr && (
        <p role="alert" style={{
          marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-sm)', background: 'var(--status-gentle-soft)',
          color: 'var(--status-gentle)', fontSize: 'var(--text-xs)',
        }}>{delErr}</p>
      )}

      {/* elevated:日程在洞察(fullscreen,z-930)里,详情是 bottom 卡 —— 不抬层会被整个盖住。 */}
      {openNode && <MemoryNodeDetail node={openNode} elevated onClose={() => setOpenNode(null)} />}
      {/* 写一封:发出去后会随下一次 Gmail 同步回到上面的列表(Gmail 的 SENT 是唯一真源,
          这里不另存一份本地副本 —— 两份账最后一定对不上)。 */}
      {composeOpen && <EmailComposeSheet open onClose={() => setComposeOpen(false)} context={{}} />}
      {/* 标签分错了,自己改(2026-07-30 用户:「某个 tag 分错了,我怎么改」)。 */}
      {fixing && <MailTagFixSheet row={fixing} dict={dict} onClose={() => setFixing(null)} />}
    </div>
  );
}
