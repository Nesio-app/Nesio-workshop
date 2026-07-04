'use client';

/**
 * ProactiveGuidanceCard — Today 主动卡(guidance 管线输出的渲染层)。
 * 含 TODAY-002 证据展开与 TODAY-004 反馈行。从 TodayFeed 拆出。
 */

import { useState } from 'react';
import { recordCardFeedback } from '@/lib/portal/reasoning-engine';
import { snoozeOverdue, type ProactiveAction, type ProactiveCardData } from './proactive-types';

export function ProactiveGuidanceCard({
  card, onDismiss, onMarkDone,
}: {
  card: ProactiveCardData;
  onDismiss: () => void;
  onMarkDone?: (nodeId: string) => void;
}) {
  const hasActions = card.actions && card.actions.length > 0;
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(false);

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

  // TODAY-004 反馈闭环:写回 feedback store(DEC 下轮据此过滤),温和确认后收起
  function handleFeedback(feedback: 'useful' | 'wrong' | 'too_much') {
    recordCardFeedback(card.id.replace(/^guidance-dec-/, ''), feedback);
    setFeedbackGiven(true);
    setTimeout(onDismiss, 600);
  }

  return (
    <div className="nesio-proactive-card">
      <div className="nesio-proactive-card-inner">
        <span className="nesio-proactive-card-icon">{card.icon}</span>
        <div className="nesio-proactive-card-text">
          <p className="nesio-proactive-card-title">{card.title}</p>
          <p className="nesio-proactive-card-body">{card.body}</p>
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
                依据 {evidenceOpen ? '▾' : '▸'} {card.evidence.length} 条
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
          {feedbackGiven ? (
            <p style={{ fontSize: '0.66rem', color: 'var(--status-go)', margin: '0.35rem 0 0' }}>✓ 记下了，会照着调整</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.35rem' }}>
              {([
                ['useful', '有用'],
                ['wrong', '不准'],
                ['too_much', '不再提醒'],
              ] as Array<['useful' | 'wrong' | 'too_much', string]>).map(([fb, label]) => (
                <button
                  key={fb}
                  type="button"
                  onClick={() => handleFeedback(fb)}
                  style={{ fontSize: '0.64rem', color: 'var(--portal-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!hasActions && (
          <button type="button" className="nesio-proactive-card-dismiss" onClick={onDismiss} aria-label="忽略">✕</button>
        )}
      </div>
    </div>
  );
}
