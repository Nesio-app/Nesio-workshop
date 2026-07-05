'use client';

/**
 * ProactiveGuidanceCard — Today 主动卡(guidance 管线输出的渲染层)。
 * 含 TODAY-002 证据展开与 TODAY-004 反馈行。从 TodayFeed 拆出。
 */

import { useState } from 'react';
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
  card, onDismiss, onMarkDone,
}: {
  card: ProactiveCardData;
  onDismiss: () => void;
  onMarkDone?: (nodeId: string) => void;
}) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const hasActions = card.actions && card.actions.length > 0;
  // 批次 13:金句卡特殊化 — 无图标、动作是「存到记忆」而不是有用/不准
  const isQuote = card.id === 'fallback-quote';
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [savedQuote, setSavedQuote] = useState(false);

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
    if (action.actionType === 'dismiss') { onDismiss(); return; }
    if (action.actionType === 'snooze' && card.nodeId) {
      snoozeOverdue(card.nodeId, 7);
      onDismiss();
      return;
    }
    if (action.actionType === 'done' && card.nodeId) {
      onMarkDone?.(card.nodeId);
      onDismiss();
    }
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
    <div className="nesio-proactive-card">
      <div className="nesio-proactive-card-inner">
        {!isQuote && <span className="nesio-proactive-card-icon"><GuidanceIcon icon={card.icon} /></span>}
        <div className="nesio-proactive-card-text">
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
              {card.actions!.map((a) => (
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
          {feedbackGiven || savedQuote ? (
            <p style={{ fontSize: '0.66rem', color: 'var(--status-go)', margin: '0.35rem 0 0' }}>
              {savedQuote ? L(dict, '已存入 Memory', 'Saved to Memory') : t(locale, 'guidanceFeedbackAck')}
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.35rem' }}>
              {(isQuote
                ? [] // 金句不是预测,有用/不准的反馈没有意义
                : ([
                    ['useful', t(locale, 'guidanceFeedbackUseful')],
                    ['wrong', t(locale, 'guidanceFeedbackWrong')],
                    ['too_much', t(locale, 'guidanceFeedbackTooMuch')],
                  ] as Array<['useful' | 'wrong' | 'too_much', string]>)
              ).map(([fb, label]) => (
                <button
                  key={fb}
                  type="button"
                  onClick={() => handleFeedback(fb)}
                  style={{ fontSize: '0.64rem', color: 'var(--portal-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  {label}
                </button>
              ))}
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
        {!hasActions && (
          <button type="button" className="nesio-proactive-card-dismiss" onClick={onDismiss} aria-label={t(locale, 'todayDismissAria')}>✕</button>
        )}
      </div>
    </div>
  );
}
