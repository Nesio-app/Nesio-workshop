'use client';

/**
 * ProactiveGuidanceCard — Today 主动卡(guidance 管线输出的渲染层)。
 * 含 TODAY-002 证据展开与 TODAY-004 反馈行。从 TodayFeed 拆出。
 */

import { useRef, useState } from 'react';
import { recordCardFeedback } from '@/lib/portal/reasoning-engine';
import { recordSignalFeedback } from '@/lib/life-domain/signal-feedback';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { getRegisteredDecCard, snoozeOverdue, bumpQuoteCat, QUOTE_CAT_LABELS, type ProactiveAction, type ProactiveCardData } from './proactive-types';
import { recordCardVerdict } from '@/lib/portal/card-verdict';
import { recordArchiveVerdict } from '@/lib/portal/card-archive';
import { emitFeedback } from '@/lib/platform/personalization';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

/** 金句卡:作者(— 苏格拉底 / — Author)默认另起一行,轻一档色。 */
function QuoteBody({ body }: { body: string }) {
  const idx = Math.max(body.lastIndexOf('——'), body.lastIndexOf('—'), body.lastIndexOf('–'));
  if (idx > 0) {
    return (
      <p className="nesio-proactive-card-body">
        {body.slice(0, idx).trim()}
        <span style={{ display: 'block', marginTop: 'var(--space-1)', color: 'var(--portal-muted)' }}>{body.slice(idx).trim()}</span>
      </p>
    );
  }
  return <p className="nesio-proactive-card-body">{body}</p>;
}

export function ProactiveGuidanceCard({
  card, onDismiss, onMarkDone, onOpen,
}: {
  card: ProactiveCardData;
  onDismiss: () => void;
  onMarkDone?: (nodeId: string) => void;
  /** 批次 83:点卡片正文进对应记忆详情(有 nodeId 才有意义) */
  onOpen?: () => void;
}) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const hasActions = card.actions && card.actions.length > 0;
  // 批次 13:金句卡特殊化 — 无图标、动作是「存到记忆」而不是有用/不准
  const isQuote = card.id === 'fallback-quote';
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [savedQuote, setSavedQuote] = useState(false);
  // 批次 33 用户定案:按钮全撤,手势接管 —— 左滑=没用 / 右滑=稍后提醒 / 双击=有用
  const [dx, setDx] = useState(0);
  const [gestureAck, setGestureAck] = useState<'useful' | 'later' | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);

  // 批次 166:抽成坐标级逻辑,Pointer + Touch 双绑 —— iOS PWA 的 Pointer Events 对水平
  // 手势不稳(用户实锤「向右滑动还是失败」),补 Touch 事件兜底。
  function beginSwipe(x: number, y: number) {
    startRef.current = { x, y };
  }
  function moveSwipe(x: number, y: number) {
    if (!startRef.current) return;
    const ddx = x - startRef.current.x;
    const ddy = y - startRef.current.y;
    if (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 8) setDx(Math.max(-120, Math.min(120, ddx)));
  }
  function endSwipe(x: number) {
    const start = startRef.current;
    startRef.current = null;
    const ddx = start ? x - start.x : 0;
    setDx(0);
    if (ddx < -64) { handleFeedback('wrong'); return; }               // 左滑 = 没用
    if (ddx > 64) {                                                    // 右滑 = 稍后提醒
      handleSnooze();
      return;
    }
    // 双击 = 有用(带确认提示)
    if (Math.abs(ddx) < 8) {
      const now = Date.now();
      if (now - lastTapRef.current < 320) {
        lastTapRef.current = 0;
        setGestureAck('useful');
        handleFeedback('useful');
        return;
      }
      lastTapRef.current = now;
    }
  }

  function handleSaveQuote() {
    ingestLifeNode({
      name: card.body.slice(0, 60),
      type: 'Mind',
      source: 'manual',
      confidence: 1,
      rawInput: card.body,
      tags: ['金句', ...(card.quoteCategory ? [QUOTE_CAT_LABELS[card.quoteCategory][0]] : [])],
      attributes: { origin: '金句' },
      relations: [],
    });
    // 批次 29:收藏 → 多推同类
    bumpQuoteCat(card.quoteCategory, 0.6);
    setSavedQuote(true);
    setTimeout(onDismiss, 900);
  }

  // 批次 29:金句「不再提醒」→ 降这一类权重、换类别
  function handleQuoteMute() {
    bumpQuoteCat(card.quoteCategory, -0.6);
    handleFeedback('too_much');
  }

  /** 这张卡的持久身份:id + 类型 + 事实指纹(管线出卡时定死,不受 AI 改写影响)。 */
  const verdictRef = { cardId: card.id, cardType: card.cardType, factKey: card.factKey };

  /**
   * 稍后 —— 以前只有 `snoozeOverdue(card.nodeId, 1)`,而财务/域洞察卡根本没有 nodeId,
   * 于是「稍后」对它们等于什么都没做(真机:点几次都第二天照旧)。现在无论有没有
   * nodeId 都写卡片裁决(3 天),nodeId 那条保留给待办节点的既有语义。
   */
  function handleSnooze() {
    recordCardVerdict(verdictRef, 'snooze');
    if (card.nodeId) snoozeOverdue(card.nodeId, 1);
    emitFeedback({ surface: 'today', dimension: 'card', key: card.id, reaction: 'snooze', at: new Date().toISOString() });
    if (card.cardType) emitFeedback({ surface: 'today', dimension: 'card_type', key: card.cardType, reaction: 'snooze', at: new Date().toISOString() });
    setGestureAck('later');
    setTimeout(onDismiss, 700);
  }

  function handleAction(action: ProactiveAction) {
    if (action.actionType === 'snooze') { handleSnooze(); return; }
    if (action.actionType === 'done' && card.nodeId) onMarkDone?.(card.nodeId);
    // 无论 dismiss / 缺 nodeId / 未知 actionType,都至少收起这张卡 —— 不留"点了没反应"的死按钮。
    onDismiss();
  }

  // TODAY-004 反馈闭环:写回 feedback store(DEC 下轮据此过滤)+ signal
  // 反馈环(recordSignalFeedback:本地记录 + 反馈 Signal + 云回写,
  // evidenceSignalIds 随完整卡保全),温和确认后收起
  function handleFeedback(feedback: 'useful' | 'wrong' | 'too_much') {
    const decCard = getRegisteredDecCard(card.id);
    if (decCard) recordSignalFeedback(decCard, feedback);
    recordCardFeedback(card.id.replace(/^guidance-dec-/, ''), feedback);
    // 手势表态回写档案 —— 档案是唯一监测面,今天页上的点按和面板里的改判必须是同一本账。
    if (card.factKey) recordArchiveVerdict(card.factKey, feedback === 'wrong' ? 'wrong' : feedback === 'too_much' ? 'too_much' : 'useful');
    // ① 持久裁决:没用 → 事实没变就永远闭嘴;太多了 → 连这一类一起静音 30 天。
    //    (以前这两个动作只落一条没人读的 Signal,卡照旧回来。)
    if (feedback === 'wrong') recordCardVerdict(verdictRef, 'mute');
    else if (feedback === 'too_much') recordCardVerdict(verdictRef, 'mute_type');
    // ② 权重:per-card 的 dimension:'card' 不在 Preference 的可复用维度里(会被丢弃),
    //    补发一条 card_type —— 这是「喜欢/没用」真正能改到下次排序的唯一通路。
    if (card.cardType) {
      emitFeedback({ surface: 'today', dimension: 'card_type', key: card.cardType, reaction: feedback, at: new Date().toISOString() });
    }
    // 云端产品事件(best-effort):反馈进 telemetry 面,供 DEC 质量回看
    void createAppApiClient().recordCloudProductEvent({
      eventType: 'today.card.feedback',
      source: 'today',
      targetType: card.cardType || 'guidance_card',
      targetId: card.id,
      feedback,
    }).catch(() => {});
    setFeedbackGiven(true);
    setTimeout(onDismiss, 600);
  }

  return (
    <div
      className="nesio-proactive-card"
      onPointerDown={(e) => {
        // iOS 在惯性滚动容器里对未捕获指针发 pointercancel(清掉共享 startRef,Touch 兜底
        // 读到空起点 → 手势全落空)。setPointerCapture 后 iOS 不再抢指针,Pointer 单流即可,
        // 删 Touch 双绑(它只会再次污染 startRef)。同产品仓修法。
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* Safari 偶发,忽略 */ }
        beginSwipe(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => moveSwipe(e.clientX, e.clientY)}
      onPointerUp={(e) => endSwipe(e.clientX)}
      onPointerCancel={() => { startRef.current = null; setDx(0); }}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform 0.2s ease', touchAction: 'pan-y' }}
    >
      {/* 批次 165:滑动提示 —— 拖动时露出这一滑会做什么(左滑=没用 / 右滑=稍后),过阈值高亮=松手即执行 */}
      {dx !== 0 && (
        <span
          className={`nesio-swipe-hint nesio-swipe-hint--${dx > 0 ? 'right' : 'left'}${Math.abs(dx) > 64 ? ' nesio-swipe-hint--ready' : ''}`}
          aria-hidden
          style={{ opacity: Math.min(1, Math.abs(dx) / 64) }}
        >
          {dx > 0 ? L(dict, '稍后提醒', 'Remind later') : L(dict, '先不看', 'Not useful')}
        </span>
      )}
      <div className="nesio-proactive-card-inner">
        <div className="nesio-proactive-card-text" onClick={() => { if (Math.abs(dx) < 6) onOpen?.(); }} style={onOpen ? { cursor: 'pointer' } : undefined}>
          <p className="nesio-proactive-card-title">{card.title}</p>
          {isQuote ? <QuoteBody body={card.body} /> : <p className="nesio-proactive-card-body">{card.body}</p>}
          {/* bug3 p46/47:「依据 ▸ N 条」展开块整块删掉(来源行在 bug2 已删)——
              卡片正文已经把「为什么给你看这条」说清楚了,再挂一层可展开的内部依据
              是把系统的推理过程摆到用户面前。card.evidence 数据保留:
              evidenceSignalIds 仍要喂反馈环(见 handleAction 的 recordSignalFeedback)。 */}
          {hasActions && (
            <div className="nesio-proactive-card-actions">
              {/* 批次 33:「好的」这类纯收起按钮撤除(手势接管);只留真动作(完成/改天) */}
              {card.actions!.filter((a) => a.actionType !== 'dismiss').map((a) => (
                <button
                  key={a.actionType}
                  type="button"
                  className={`nesio-proactive-action-btn nesio-proactive-action-btn--${a.actionType}`}
                  onClick={() => handleAction(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {(feedbackGiven || savedQuote || gestureAck) ? (
            <p style={{ fontSize: 'var(--text-overline)', color: 'var(--status-go)', margin: 'var(--space-1) 0 0' }}>
              {savedQuote ? L(dict, '已存入 Memory', 'Saved to Memory')
                : gestureAck === 'useful' ? L(dict, '✓ 有用,记住了 —— 会多来点这样的', '✓ Useful, noted — more like this')
                : gestureAck === 'later' ? L(dict, '好,稍后再提醒你', 'OK — will remind you later')
                : t(locale, 'guidanceFeedbackAck')}
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
              {/* 批次 33:有用/不准/不再提醒 文字行撤除 —— 左滑没用 · 右滑稍后 · 双击有用 */}
              {isQuote && (
                <>
                  <button
                    type="button"
                    onClick={handleSaveQuote}
                    style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {L(dict, '存到记忆', 'Save to Memory')}
                  </button>
                  <button
                    type="button"
                    onClick={handleQuoteMute}
                    style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {t(locale, 'guidanceFeedbackTooMuch')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {/*
         * ✕ 撤掉(2026-08-01,用户:「卡片的取消是左右滑,不需要右上角 x」)。
         *
         * 它是 2026-07-31 加回来的 —— 那时他实测「向左拉还是拉不动」,而我定不出
         * 左滑为什么不跟手,所以补了一个不依赖手势的出口。现在他说滑动是通的、
         * 不要这个角标了,那就撤。
         *
         * ⚠️ 撤掉的代价写在这儿,免得下一个人(或下一个我)以为这里从来没有过出口:
         * 现在关掉这张卡的路**只剩手势**。手势在这个仓里被实测打回过三次;
         * 哪天再失灵,卡片就是关不掉的 —— 到那时该做的是去修手势,
         * 或者按用户当时的意思重新给一个出口,而不是当作「本来就这样」。
         */}
      </div>
    </div>
  );
}
