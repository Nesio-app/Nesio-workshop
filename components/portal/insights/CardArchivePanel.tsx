'use client';

/**
 * 卡片档案面板 —— AI 判决层的唯一监测面(设计定稿 2026-07-29,Step 1)。
 * 位置:洞察 · 回望 页底,「我的实验」槽位旁,与 LearningStatusPanel(静音清单)并排 ——
 * 「Nesio 记得什么」和「Nesio 说过什么」在一处。
 *
 * 两个清单:
 *   说了的 —— 每张出过的卡(规则/影子双轨)+ whyNow + 证据 + 门记录 + 改判按钮。误报看改判率。
 *   没说的 —— AI 判过但没出的信号 + 理由 +「这条该提醒我」。漏报的唯一监测面。
 * 改判率 >15% 时顶部亮琥珀警示(不是红 —— 不是真实风险,是校准信号)。
 */

import { useMemo, useState } from 'react';
import {
  readArchive, archiveStats, recordArchiveVerdict, markDeclinedWanted,
  type ArchiveShownEntry, type ArchiveVerdict,
} from '@/lib/portal/card-archive';
import { recordCardVerdict } from '@/lib/portal/card-verdict';
import { readJudgeStats, requeueFingerprint } from '@/lib/portal/guidance-judge-auto';
import { resolveCardTarget, openCardTarget } from '@/lib/portal/card-target';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const VERDICT_LABEL: Record<ArchiveVerdict, [string, string]> = {
  useful: ['有用', 'Useful'], too_much: ['太多了', 'Too much'], wrong: ['不该出', 'Off base'],
  repeat: ['重复了', 'Repeat'], should_have_told: ['该提醒我', 'Wanted this'],
};

const GATE_LABEL: Record<string, [string, string]> = {
  window: ['未到窗口', 'Out of window'], silence: ['已静音', 'Muted'],
  dismissed: ['今天已收起', 'Dismissed today'], quota: ['配额已满', 'Over quota'],
};

export default function CardArchivePanel({ onOpenNode }: { onOpenNode?: (nodeId: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<'shown' | 'declined'>('shown');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);

  const archive = useMemo(() => readArchive(), [tick]);
  const stats = useMemo(() => archiveStats(), [tick]);
  const judge = useMemo(() => readJudgeStats(), [tick]);
  const refresh = () => setTick((t) => t + 1);

  function verdict(entry: ArchiveShownEntry, v: ArchiveVerdict) {
    recordArchiveVerdict(entry.id, v);
    // AI 卡的改判直接接进静音层(实弹:下一轮出卡即生效)。
    if (entry.lane === 'ai') {
      if (v === 'wrong' || v === 'repeat') {
        recordCardVerdict({ cardId: entry.id, cardType: entry.group, factKey: entry.id }, 'mute');
      } else if (v === 'too_much') {
        recordCardVerdict({ cardId: entry.id, cardType: entry.group, factKey: entry.id }, 'mute_type');
      }
    }
    refresh();
  }

  function openTarget(entry: ArchiveShownEntry) {
    const target = resolveCardTarget(entry.fingerprints || []);
    if (!target) return;
    if (target.kind === 'node' && onOpenNode) onOpenNode(target.nodeId);
    else openCardTarget(target);
  }

  const hasAnything = archive.shown.length > 0 || archive.declined.length > 0 || judge.batches > 0;
  if (!hasAnything) return null; // 空档案不占版面:第一张卡出现后自然长出来

  return (
    <div className="nesio-fit-panel" style={{ marginBottom: 'var(--space-3)' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
        {L(dict, 'Nesio 说过什么(卡片档案)', 'What Nesio said (card archive)')}
      </p>

      <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-2)' }}>
        {L(dict,
          `出过 ${stats.shownCount} 张 · 你表态 ${stats.verdictCount} 次${judge.batches > 0 ? ` · AI 判决 ${judge.batches} 批(${judge.judgedSignals} 条信号)` : ''}`,
          `${stats.shownCount} shown · ${stats.verdictCount} rated${judge.batches > 0 ? ` · ${judge.batches} AI batches (${judge.judgedSignals} signals)` : ''}`)}
      </p>

      {stats.alarm && (
        <p className="nesio-health-story-line" style={{ color: 'var(--status-gentle)' }}>
          {L(dict,
            `你表态过的卡里 ${Math.round(stats.badRatio * 100)}% 被判「不该出」—— 判得有点激进,正在按你的反馈收敛。`,
            `${Math.round(stats.badRatio * 100)}% of rated cards marked off — calibrating down per your feedback.`)}
        </p>
      )}
      {judge.lastError && (
        <p className="nesio-health-story-line" style={{ color: 'var(--status-gentle)' }}>
          {L(dict, `最近一次 AI 判决没成功(${judge.lastError}),下次打开会重试。`,
            `Last AI batch failed (${judge.lastError}); will retry on next open.`)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-2) 0' }}>
        {(['shown', 'declined'] as const).map((t) => (
          <button
            key={t} type="button" className="nesio-unmute-btn"
            style={tab === t ? { background: 'var(--portal-accent-soft-md)', borderColor: 'var(--portal-accent-border)' } : undefined}
            onClick={() => { setTab(t); setLimit(20); }}
          >
            {t === 'shown'
              ? L(dict, `说了的 ${archive.shown.length}`, `Said ${archive.shown.length}`)
              : L(dict, `没说的 ${archive.declined.length}`, `Held ${archive.declined.length}`)}
          </button>
        ))}
      </div>

      {tab === 'shown' && archive.shown.slice(0, limit).map((e) => {
        const open = expanded === e.id;
        const canJump = resolveCardTarget(e.fingerprints || []) !== null;
        return (
          <div key={e.id} style={{ borderTop: '1px solid var(--portal-line)', padding: 'var(--space-2) 0' }}>
            <button
              type="button"
              onClick={() => setExpanded(open ? null : e.id)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', alignItems: 'baseline', gap: 'var(--space-2)' }}
            >
              <span className="nesio-health-story-line" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                {e.title}
              </span>
              <span className="nesio-settings-option-hint" style={{ margin: 0, flexShrink: 0 }}>
                {e.lane === 'ai' ? 'AI' : L(dict, '规则', 'rules')} · {e.group} · {e.lastAt.slice(5, 10)}
                {e.verdict ? ` · ${L(dict, VERDICT_LABEL[e.verdict.v][0], VERDICT_LABEL[e.verdict.v][1])}` : ''}
              </span>
            </button>
            {open && (
              <div style={{ marginTop: 'var(--space-1)' }}>
                {e.body && <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-1)' }}>{e.body}</p>}
                {e.whyNow && (
                  <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-1)' }}>
                    {L(dict, '为什么:', 'Why: ')}{e.whyNow}
                  </p>
                )}
                {(e.evidence || []).length > 0 && (
                  <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-1)' }}>
                    {L(dict, '依据:', 'Evidence: ')}{e.evidence.join(' · ')}
                  </p>
                )}
                {e.gates.length > 0 && (
                  <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-1)' }}>
                    {L(dict, '当时会被拦:', 'Would be held by: ')}
                    {e.gates.map((g) => L(dict, GATE_LABEL[g]?.[0] ?? g, GATE_LABEL[g]?.[1] ?? g)).join(' · ')}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {(['useful', 'too_much', 'wrong', 'repeat'] as const).map((v) => (
                    <button
                      key={v} type="button" className="nesio-unmute-btn"
                      style={e.verdict?.v === v ? { background: 'var(--portal-accent-soft-md)' } : undefined}
                      onClick={() => verdict(e, v)}
                    >
                      {L(dict, VERDICT_LABEL[v][0], VERDICT_LABEL[v][1])}
                    </button>
                  ))}
                  {canJump && (
                    <button type="button" className="nesio-unmute-btn" onClick={() => openTarget(e)}>
                      {L(dict, '去看', 'Open')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {tab === 'declined' && archive.declined.slice(0, limit).map((e) => (
        <div key={e.id} style={{ borderTop: '1px solid var(--portal-line)', padding: 'var(--space-2) 0', display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <span className="nesio-health-story-line" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
            {e.title}
          </span>
          <span className="nesio-settings-option-hint" style={{ margin: 0, flexShrink: 0 }}>{e.reason}</span>
          <button
            type="button" className="nesio-unmute-btn" style={{ flexShrink: 0 }}
            disabled={e.wanted}
            onClick={() => {
              // 反馈闭环两半:记事实(prompt 口味段带上) + 摘出已判集合(下次打开重判这条)
              markDeclinedWanted(e.id);
              requeueFingerprint(e.id);
              refresh();
            }}
          >
            {e.wanted ? L(dict, '已记下', 'Noted') : L(dict, '该提醒我', 'Wanted this')}
          </button>
        </div>
      ))}

      {((tab === 'shown' ? archive.shown.length : archive.declined.length) > limit) && (
        <button type="button" className="nesio-unmute-btn" style={{ marginTop: 'var(--space-2)' }} onClick={() => setLimit((n) => n + 30)}>
          {L(dict, '显示更多', 'Show more')}
        </button>
      )}
    </div>
  );
}
