'use client';

/**
 * TodayFocusSection — 今日聚焦区编排:Attention Engine 评分、置顶卡、
 * 折叠列表、快速添加。卡型组件在同目录:CalendarCards(日历簇)、
 * DormantReviewCard(休眠复访)、NightTimeline(夜间空状态)。
 */

import { arbitrateTodayPresence } from '@/lib/platform/today-arbiter';
import { firstNodeDate, nodeExpiryDate } from '@/lib/platform/node-dates';
import { useEffect, useState, type RefObject } from 'react';
import { focusTimeHint, localDayKey, markFocusNodeDone, type FocusNode, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents, selectPinned } from '@/lib/platform/attention-engine';
import {
  selectReviewCandidate, applyReviewAction, touchNode,
  type DormantStore, type DormantCandidate,
} from '@/lib/platform/dormant-engine';
import { DormantReviewCard } from './DormantReviewCard';
import { PinnedAttentionCard, CollapsedCalItem } from './CalendarCards';
import { isMeetingNode } from './meeting-node';
import { recordCardVerdict, isCardSuppressed } from '@/lib/portal/card-verdict';
import { FocusCardDetail, FOCUS_TYPE_ICON } from './FocusCardDetail';
import { MeetingRecorderSheet } from './MeetingRecorderSheet';
import MemoryFlashBanner, { useMemoryFlash } from '../MemoryFlashBanner';
import MoodBeat from '../MoodBeat';
import { t, L } from '@/lib/portal/i18n';
import { recordCardFeedback } from '@/lib/portal/reasoning-engine';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconCalendar, IconGift, IconNote, IconMic } from '../icons';

function CollapsedTaskItem({
  node,
  doneIds,
  onDone,
  onDismiss,
  onDeleteNode,
  onNotUseful,
  onOpenRecorder,
  onFocusMode,
}: {
  node: FocusNode;
  doneIds: Set<string>;
  onDone: (node: FocusNode) => void;
  onDismiss: (id: string) => void;
  onDeleteNode?: (id: string) => void;
  onNotUseful?: (id: string) => void;
  onOpenRecorder?: () => void;
  onFocusMode?: () => void;
}) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [expanded, setExpanded] = useState(false);
  const isDone = doneIds.has(node.id);
  const isMeeting = isMeetingNode(node);
  const hint = focusTimeHint(node, dict);

  return (
    <li className={`nesio-collapsed-item${isDone ? ' nesio-collapsed-item--done' : ''}`}>
      <div className="nesio-collapsed-row">
        <button
          type="button"
          className={`nesio-collapsed-check${isDone ? ' nesio-collapsed-check--done' : ''}`}
          onClick={() => onDone(node)}
          aria-label={t(locale, 'todayDoneAria')}
        />
        <button type="button" className="nesio-collapsed-task-body" onClick={() => { setExpanded((v) => !v); touchNode(node.id); }}>
          {/* 批次 107→108:时间线节点 —— 时标作 kicker 在标题上方(现在/今晚/稍后) */}
          {hint && <span className="nesio-collapsed-kicker">{hint}</span>}
          <span className="nesio-collapsed-title">{node.name}</span>
        </button>
        {/* 2026-08-01 用户点名:行尾只有一个 ✕,看不出还能"完成"——拆成两个小符号,
            对勾=完成(同左侧圆圈勾,这里再放一个是因为用户视觉上没认出左侧那个是按钮)
            ✕=移走(不影响完成状态,只是今天不看了)。 */}
        {!isDone && (
          <button
            type="button"
            className="nesio-tl-check"
            onClick={(e) => { e.stopPropagation(); onDone(node); }}
            aria-label={t(locale, 'todayDoneAria')}
            title={t(locale, 'todayDoneAria')}
          >✓</button>
        )}
        {onNotUseful && !isDone && (
          <button
            type="button"
            className="nesio-tl-x"
            onClick={(e) => { e.stopPropagation(); onNotUseful(node.id); }}
            aria-label={L(dict, '从今天移走这条', 'Remove from today')}
            title={L(dict, '从今天移走', 'Remove from today')}
          >✕</button>
        )}
      </div>
      {expanded && (
        <div className="nesio-collapsed-detail">
          <FocusCardDetail
            node={node}
            onSubtasksChange={() => {}}
            onOpenRecorder={isMeeting && onOpenRecorder ? onOpenRecorder : undefined}
            onFocusMode={onFocusMode}
            focusModeLabel={t(locale, 'todayFocusModeBtn')}
            onDelete={onDeleteNode ? () => { setExpanded(false); onDeleteNode(node.id); } : undefined}
          />
        </div>
      )}
    </li>
  );
}

// 批次 29:消除的焦点项要留得住 —— 之前 dismissed 只在内存,重新挂载/刷新就全回来了。
// 按当天持久化;次日自然复活(焦点本就是每日的)。
const FOCUS_DISMISS_KEY = 'nesio-focus-dismissed-v1';
function todayStr() { return localDayKey(); }
function loadDismissedToday(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const d = JSON.parse(localStorage.getItem(FOCUS_DISMISS_KEY) || '{}') as { date?: string; ids?: string[] };
    return d.date === todayStr() && Array.isArray(d.ids) ? new Set(d.ids) : new Set();
  } catch { return new Set(); }
}
function persistDismissed(ids: Set<string>) {
  try { localStorage.setItem(FOCUS_DISMISS_KEY, JSON.stringify({ date: todayStr(), ids: [...ids] })); } catch { /* ignore */ }
}

// ── Today Focus Section — Attention Engine v1 ─────────────────────────────────

export function TodayFocusSection({
  focusNodes,
  calendarEvents,
  specialDays,
  allNodes: allNodesProp,
  dormantStore: dormantStoreProp,
  guidanceNodeIds,
  onPinnedResolved,
  onSetDormantStore,
  onOpenRecorder,
  onFocusMode,
  onDeleteNode,
  capture,
}: {
  focusNodes: readonly FocusNode[];
  calendarEvents: CalendarEvent[];
  specialDays: ProactiveContextItem[];
  allNodes: readonly FocusNode[];
  dormantStore: DormantStore;
  /** 引导卡认领的节点 id(统一仲裁用) */
  guidanceNodeIds?: readonly string[];
  /** 置顶裁决回传(TodayFeed 据此隐藏被抢占的引导卡) */
  onPinnedResolved?: (id: string | null) => void;
  onSetDormantStore: (s: DormantStore) => void;
  /** @deprecated 顶部「全部」入口已移除;prop 暂留以兼容调用方 */
  onOpenMemory?: () => void;
  onOpenRecorder?: (node: FocusNode) => void;
  onFocusMode?: (node: FocusNode) => void;
  /** 真·删除焦点节点(经命令层 deleteFocusNode);今日表面不直连 life-graph。 */
  onDeleteNode?: (id: string) => void;
  /** 批次 132:记一笔·话筒节点内联输入(逻辑在 TodayFeed,这里只渲染)。删了底部输入栏。 */
  capture?: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onMic: () => void;
    recording: boolean;
    inputRef: RefObject<HTMLTextAreaElement | null>;
  };
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedToday());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(true);
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const [calRecorderEvent, setCalRecorderEvent] = useState<CalendarEvent | null>(null);
  const locale = usePortalLocale();
  const { flashNodes, dismiss: dismissFlash } = useMemoryFlash();
  // 批次 163→169:记一笔输入框随字增高(去掉全屏/虚线态)。
  const growJot = () => {
    const el = capture?.inputRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }
  };
  useEffect(() => { growJot(); /* 草稿载入/内容变化时自动撑开 */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.value]);

  // ── Attention Engine: score calendar events ──
  const now = new Date();
  const scored = scoreCalendarEvents(calendarEvents, now);
  const pinned = selectPinned(scored);
  // 2026-08-01 用户实锤「日历行的 ✕ 点了不管用」:这里此前只排除置顶项,漏了排除
  // dismissed —— handleRemoveCalToday 确实把 id 写进了 dismissed(且持久化成功),
  // 但下面渲染用的 rest 压根没读这个集合,下一帧照样把它画回来。任务节点那边(214 行)
  // 早就正确接了 !dismissed.has(...),日历事件这条分支当年漏接了。
  const rest = scored.filter((o) => o.id !== pinned?.id && !dismissed.has(o.id));

  // ── Dormant: one review card per day(先选,交给统一仲裁器排重)──
  const [dormantDismissed, setDormantDismissed] = useState<Set<string>>(new Set());
  const dormantCandidate: DormantCandidate | null = selectReviewCandidate(allNodesProp, dormantStoreProp);

  // ── 统一仲裁(架构审查 #2):同一节点只在一个槽位出现,优先级 置顶>复访>引导卡>列表 ──
  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  // 批次 51:event 型此前整类排除(日历事件走 CalendarCards 渠道)—— 但邮件/照片/
  // 日历生成的记忆多是 event 型,长按「加入今日焦点」钉进来的必须放行,
  // 否则只有文字 note(commitment 型)钉得进来(用户实测抓出)。
  //
  // 2026-07-30 真机实锤(截图:时间线里出现「摇椅盖毯」「灰色高领毛衣」,还都标着「明天」):
  // 这个判据一直是**反向**的 —— 只排除「被划掉的 / 已完成的 / 没钉今天的 event」,
  // 剩下**一切**节点都能占今天。于是拍一张毯子、一件毛衣,它们就成了「今天要紧的事」。
  // 这和「GitHub 邮件里的『健身』被认成健康打卡」是同一族的错:没有正向判据,
  // 就等于「凡是没被拦住的都算数」。
  //
  // 改成正向:一个节点要占今天的时间线,必须至少满足一条 ——
  //   ① 用户**自己钉**到今天了(focusPinnedOn);
  //   ② 它本来就是承诺/待办类型(commitment);
  //   ③ 它带**真日期**(firstNodeDate:只认 start/date/dueDate… 这些明确的日期键,
  //      不用 nearestNodeDate —— 那个会扫描全部属性值,任何 ad-hoc 键上的字符串
  //      只要能被 Date 解析就冒充成日期,正是这两件衣物长出「明天」的原因);
  //   ④ 它快到期(食材/药品这类,到期本身就是今天的事)。
  // 物品、人、地点、偏好这些没有时间语义的,一律不进 —— 它们在记忆页和收纳里好好待着。
  const todayKey = localDayKey();
  const qualifiesForTimeline = (n: FocusNode): boolean => {
    if (n.attributes.focusPinnedOn === todayKey) return true;   // ①
    if (n.type === 'event') return false;                        // 日历事件走 CalendarCards
    if (n.type === 'task') return true;                          // ②
    if (firstNodeDate(n.attributes)) return true;                // ③
    if (nodeExpiryDate(n.attributes)) return true;               // ④
    return false;
  };
  const rawTaskNodes = allNodes.filter((n) =>
    !dismissed.has(n.id) && !doneIds.has(n.id) && qualifiesForTimeline(n));
  const verdict = arbitrateTodayPresence({
    pinnedId: pinned?.id ?? null,
    dormantCandidateId: dormantCandidate?.node.id ?? null,
    taskIds: rawTaskNodes.map((n) => n.id),
    guidanceClaims: guidanceNodeIds ?? [],
  });
  const taskNodes = rawTaskNodes
    .filter((n) => verdict.taskIds.includes(n.id))
    // 裁决层消费端:「没用」过的节点不再占今天(跨天生效,不只当天)
    .filter((n) => !isCardSuppressed({ cardId: n.id, factKey: n.id }));

  // 置顶结果回传组合根(TodayFeed 隐藏被置顶抢占的引导卡)
  const pinnedIdForReport = pinned?.id ?? null;
  useEffect(() => { onPinnedResolved?.(pinnedIdForReport); }, [pinnedIdForReport, onPinnedResolved]);

  // 纪念日与休眠复访已移出时间线(用户拍板 2026-07-29):
  // 生日走判决层 relationship 域(person 数据,正则路径全退);休眠复访不属「今天的日程」,
  // 回忆面由回顾卡承担。specialDays prop 留着(移除属渲染层决定,数据层不动)。
  void specialDays; void dormantDismissed;
  const collapsedCount = rest.length + taskNodes.length;
  const isEmpty = !pinned && collapsedCount === 0;

  const doneToday = doneIds.size;

  function handleDone(node: FocusNode) {
    setDoneIds((prev) => { const next = new Set(prev); next.add(node.id); return next; });
    setTimeout(() => markFocusNodeDone(node.id), 600);
  }

  // 「没用」反馈:记一条负反馈(reasoning-engine 反馈库 + 事件,供排序/DEC 学习少推这类),
  // 并当天从今天移除(持久化,次日不复活缠人)。不删节点 —— 记忆页仍在,只是不占今天。
  /**
   * 日历行的 ✕(2026-07-30 用户要求「每一条后面都有个 ✕」)。
   *
   * 刻意**不**走 handleNotUseful 的永久静音:日历是外部权威数据,今天这场会和
   * 明天那场是两件事(重复日程每次是不同的 occurrence)。永久静音一个 id,
   * 轻则明天照样出现(id 不同)、重则整个系列从此消失 —— 两种都不是「移走这条」。
   * 所以这里只做当天移除(dismissed 是日键的,过零点自动复原)。
   */
  function handleRemoveCalToday(id: string) {
    setDismissed((prev) => { const next = new Set(prev); next.add(id); persistDismissed(next); return next; });
  }

  function handleNotUseful(id: string) {
    recordCardFeedback(id, 'wrong');
    // 接裁决层(Today 审计 2026-07-29):此前只当天移除 = 和主动卡修之前一样的死路。
    // 「没用」= 该节点事实没变就别再占今天(mute 按 id 永久,节点在记忆页仍在)。
    recordCardVerdict({ cardId: id, factKey: id }, 'mute');
    setDismissed((prev) => { const next = new Set(prev); next.add(id); persistDismissed(next); return next; });
  }

  // 批次 32:今日聚焦「至多显示一个」—— 有置顶卡时它就是那一个,折叠区全收进「还有 N 项」;
  // 没置顶卡时露出最靠前的一条(至少一个、至多一个),其余折叠。
  const collapsedNodes: React.ReactNode[] = [
    ...rest.map((obj) => (
      <CollapsedCalItem
        key={obj.id}
        obj={obj}
        onOpenRecorder={() => setCalRecorderEvent(obj.event)}
        onRemove={handleRemoveCalToday}
      />
    )),
    ...taskNodes.map((node) => (
      <CollapsedTaskItem
        key={node.id}
        node={node}
        doneIds={doneIds}
        onDone={handleDone}
        onDismiss={(id) => setDismissed((prev) => { const next = new Set(prev); next.add(id); persistDismissed(next); return next; })}
        onDeleteNode={onDeleteNode}
        onNotUseful={handleNotUseful}
        onOpenRecorder={onOpenRecorder ? () => onOpenRecorder(node) : undefined}
        onFocusMode={onFocusMode ? () => onFocusMode(node) : undefined}
      />
    )),
  ];
  // 批次 117(用户定「除心情最多显示 2 个」):时间线心情 + 至多 2 个要紧事,
  // 置顶卡算 1 个(有置顶卡则折叠区只露 1)。多出来的收成「稍后 · 还有 N 件」+ 号节点。
  const CAP = pinned ? 1 : 2;
  const shownNodes = collapsedNodes.slice(0, CAP);
  const restCount = collapsedNodes.length - shownNodes.length;
  const dict = portalLocaleToDictionaryLocale(locale);

  return (
    <div className="nesio-focus-section">
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      {/* 2026-07-29 用户实锤删掉「接下来 · 今天要紧的几件」这行小标题:
          下面那条时间线本身就在讲这件事,标题只是把同一句话再说一遍(批次 188 已经因为
          同样的重叠删过问候语里的「接下来:X」)。今天完成数那枚徽章留着 —— 它是数据不是标题。 */}
      {doneToday > 0 && (
        <div className="nesio-focus-header" data-tour="breakdown">
          <div className="nesio-focus-header-right">
            <span className="nesio-focus-done-badge">✓ {doneToday}</span>
          </div>
        </div>
      )}

      {/* 批次 107:时间线 —— 心情作「现在」第一拍 + 竖轨串起下面的要紧事(设计规范今天页) */}
      <div className="nesio-focus-timeline">
        <div data-tour="mood"><MoodBeat /></div>
        {/* bug2:「✓ 没有到点的事」空态卡整块删除 —— 没事就该什么都不说,不占一张卡。 */}
        {isEmpty ? null : (
          <div className="nesio-attention-layout">

          {/* ── Slot 1: Must Not Miss ── */}
          {pinned && (
            <PinnedAttentionCard
              obj={pinned}
              onOpenRecorder={() => setCalRecorderEvent(pinned.event)}
            />
          )}

          {/* ── Slot 2: 时间线要紧事 —— 批次 139:「还有 N 件小事」就地展开/收起(复活折叠事件,
                此前 onClick 跳记忆页、collapsed state 成孤儿,点了没有折叠反应)。去记忆页仍走顶部「全部」。 */}
          {collapsedNodes.length > 0 && (
            <div className="nesio-collapsed-section">
              {/* bug2「稍后位置漂移」:展开/收起入口原来挂在 <ul> 外面 —— 时间线竖轨只画到 <ul>
                  结尾,这一行就浮在轨道下方,且随折叠状态左右缩进不同,读起来像跑位了。
                  改成列表里的一个 <li>,和上面各拍同一条轨、同一缩进,位置不再变。 */}
              <ul className="nesio-collapsed-list">
                {collapsed ? shownNodes : collapsedNodes}
                {restCount > 0 && (
                  <li>
                    {collapsed ? (
                      <button
                        type="button"
                        className="nesio-collapsed-row nesio-tl-more"
                        aria-expanded={false}
                        onClick={() => setCollapsed(false)}
                      >
                        {/* bug3 p43:圆点加回来 —— 标注写明「稍后左边对应时间线上应该是圆形
                            中间三个点的符号」。2026-07-29 那次是按「入口不是事件」删掉的,
                            但删了之后这一行的文字比上面每一拍都往左突出一截,读起来像跑位;
                            补回 ⋯ 圈,缩进跟上面对齐,「稍后」也就和标题同一条左边线了。 */}
                        <span className="nesio-collapsed-dot nesio-tl-more-plus" aria-hidden>⋯</span>
                        <span className="nesio-collapsed-task-body">
                          <span className="nesio-collapsed-kicker">{L(dict, '稍后', 'Later')}</span>
                          <span className="nesio-collapsed-title">{L(dict, `还有 ${restCount} 件小事`, `${restCount} more small things`)}</span>
                          {/* bug2:「点开看看,我先替你收着」删除 —— 整行本身就是那个动作 */}
                        </span>
                      </button>
                    ) : (
                      /* 批次 182(用户实锤):摊开后只留一个向上箭头收起,字全删 */
                      <button
                        type="button"
                        className="nesio-collapsed-row nesio-tl-fold"
                        aria-expanded
                        aria-label={L(dict, '收起', 'Collapse')}
                        onClick={() => setCollapsed(true)}
                      >
                        <span className="nesio-collapsed-dot nesio-tl-more-plus" aria-hidden>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </span>
                      </button>
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}

        </div>
        )}

        {/* 2026-07-28 UI 精修(用户标注 图4/图5):记一笔输入条已上移到时间线上方,
            即原「+ 新建日程」的位置 —— 见 today/CaptureBar.tsx。此处不再渲染。 */}

      </div>

      {/* Calendar event meeting recorder */}
      <MeetingRecorderSheet
        open={calRecorderEvent !== null}
        meetingNode={calRecorderEvent ? {
          id: calRecorderEvent.id,
          name: calRecorderEvent.title,
          type: 'event',
          attributes: {},
          subtasks: [],
          createdAt: calRecorderEvent.start,
        } : null}
        onClose={() => setCalRecorderEvent(null)}
      />
    </div>
  );
}


