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
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { GuidanceIcon } from '../icons';

/** 金句卡:作者(— 苏格拉底 / — Author)默认另起一行,轻一档色。 */
function QuoteBody({ body }: { body: string }) {
  const idx = Math.max(body.lastIndexOf('——'), body.lastIndexOf('—'), body.lastIndexOf('–'));
  if (idx > 0) {
    return (
      <p className="nesio-proactive-card-body">
        {body.slice(0, idx).trim()}
        <span style={{ display: 'block', marginTop: '0.2rem', color: 'var(--portal-muted)' }}>{body.slice(idx).trim()}</span>
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
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [savedQuote, setSavedQuote] = useState(false);
  // 批次 33 用户定案:按钮全撤,手势接管 —— 左滑=没用 / 右滑=稍后提醒 / 双击=有用
  const [dx, setDx] = useState(0);
  const [gestureAck, setGestureAck] = useState<'useful' | 'later' | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);

  function onPointerDown(e: React.PointerEvent) {
    startRef.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current) return;
    const ddx = e.clientX - startRef.current.x;
    const ddy = e.clientY - startRef.current.y;
    if (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 8) setDx(Math.max(-120, Math.min(120, ddx)));
  }
  function onPointerUp(e: React.PointerEvent) {
    const start = startRef.current;
    startRef.current = null;
    const ddx = start ? e.clientX - start.x : 0;
    setDx(0);
    if (ddx < -64) { handleFeedback('wrong'); return; }               // 左滑 = 没用
    if (ddx > 64) {                                                    // 右滑 = 稍后提醒
      if (card.nodeId) snoozeOverdue(card.nodeId, 1);
      setGestureAck('later');
      setTimeout(onDismiss, 700);
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
      type: 'preference',
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

  function handleAction(action: ProactiveAction) {
    if (action.actionType === 'snooze' && card.nodeId) snoozeOverdue(card.nodeId, 7);
    else if (action.actionType === 'done' && card.nodeId) onMarkDone?.(card.nodeId);
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { startRef.current = null; setDx(0); }}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform 0.2s ease', touchAction: 'pan-y' }}
    >
      <div className="nesio-proactive-card-inner">
        {!isQuote && <span className="nesio-proactive-card-icon"><GuidanceIcon icon={card.icon} /></span>}
        <div className="nesio-proactive-card-text" onClick={() => { if (Math.abs(dx) < 6) onOpen?.(); }} style={onOpen ? { cursor: 'pointer' } : undefined}>
          <p className="nesio-proactive-card-title">{card.title}</p>
          {isQuote ? <QuoteBody body={card.body} /> : <p className="nesio-proactive-card-body">{card.body}</p>}
          {card.reason && (
            <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', margin: '0.2rem 0 0' }}>{card.reason}</p>
          )}
          {card.sourceTags.length > 0 && (
            <div className="nesio-proactive-card-tags">
              {card.sourceTags.map((tag) => (
                <span key={tag} className="nesio-proactive-card-tag">{tag}</span>
              ))}
            </div>
          )}
          {card.evidence && card.evidence.length > 0 && (
            <div style={{ marginTop: '0.3rem' }}>
              <button
                type="button"
                onClick={() => setEvidenceOpen((v) => !v)}
                style={{ fontSize: '0.66rem', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {t(locale, 'guidanceEvidenceTemplate', { chevron: evidenceOpen ? '▾' : '▸', count: card.evidence.length })}
              </button>
              {evidenceOpen && (
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem', fontSize: '0.66rem', color: 'var(--portal-muted)', lineHeight: 1.5 }}>
                  {card.evidence.map((e, i) => (
                    <li key={i}>{e.label}：{e.value}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
            <p style={{ fontSize: '0.66rem', color: 'var(--status-go)', margin: '0.35rem 0 0' }}>
              {savedQuote ? L(dict, '已存入 Memory', 'Saved to Memory')
                : gestureAck === 'useful' ? L(dict, '✓ 有用,记住了 —— 会多来点这样的', '✓ Useful, noted — more like this')
                : gestureAck === 'later' ? L(dict, '好,稍后再提醒你', 'OK — will remind you later')
                : t(locale, 'guidanceFeedbackAck')}
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.35rem' }}>
              {/* 批次 33:有用/不准/不再提醒 文字行撤除 —— 左滑没用 · 右滑稍后 · 双击有用 */}
              {isQuote && (
                <>
                  <button
                    type="button"
                    onClick={handleSaveQuote}
                    style={{ fontSize: '0.64rem', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {L(dict, '存到记忆', 'Save to Memory')}
                  </button>
                  <button
                    type="button"
                    onClick={handleQuoteMute}
                    style={{ fontSize: '0.64rem', color: 'var(--portal-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {t(locale, 'guidanceFeedbackTooMuch')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {/* 批次 33:✕ 撤除,左滑即收起 */}
      </div>
    </div>
  );
}
