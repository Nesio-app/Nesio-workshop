'use client';

/**
 * 多面镜月度信(v1 规格 §2.3)— 认知 tab 的主体。
 *
 * 选一面镜子,它读你的本地档案(批量导入已剔除),每月写给你一封
 * 第二人称的信:宋体、暖色信纸;每段带证据 chips + ✓/✗ 可反驳;
 * 只回看不预测。老友免费试读,其余四面镜 Pro(dispatch nesio-pro-gate)。
 */

import { useCallback, useEffect, useState } from 'react';
import { getLifeGraph, isBulkImported } from '@/lib/portal/life-graph';
import { getMirrorProfile } from '@/lib/portal/mirror-profile';
import { summarizeForLivingModel } from '@/lib/platform/living-model';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { isPro } from '@/lib/portal/entitlement';
import {
  MIRRORS,
  currentMonthKey,
  loadMirrorLetter,
  saveMirrorLetter,
  loadMirrorFeedback,
  saveMirrorFeedback,
  recentFeedbackSamples,
  type MirrorId,
  type MirrorLetter,
} from '@/lib/portal/mirror-letters';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';

type LetterError = 'auth' | 'no-key' | 'quota' | 'ai-error' | 'network' | 'thin' | null;

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MirrorLetterTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const month = currentMonthKey();
  const monthNum = Number(month.slice(5));
  const monthLabel = L(dict, `${monthNum} 月`, MONTHS_EN[monthNum - 1]);

  const [mirrorId, setMirrorId] = useState<MirrorId>('friend');
  const [letter, setLetter] = useState<MirrorLetter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LetterError>(null);
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({});
  const [nodeCount, setNodeCount] = useState(0);

  useEffect(() => {
    setFeedback(loadMirrorFeedback());
    try { setNodeCount(getLifeGraph().filter((n) => !isBulkImported(n)).length); } catch { /* ignore */ }
  }, []);

  // 切镜子:先取本月缓存,没有就等用户点「写这封信」(不自动打云)
  useEffect(() => {
    setLetter(loadMirrorLetter(month, mirrorId));
    setError(null);
  }, [month, mirrorId]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 批量导入剔出证据:镜子读到的必须是用户,不是通讯录
      const nodes = getLifeGraph().filter((n) => !isBulkImported(n));
      const summary = summarizeForLivingModel({ nodes, mirrorProfile: getMirrorProfile(), previousInsights: [] });
      const res = await fetch('/api/portal/mirror-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mirrorId,
          locale: dict,
          monthLabel,
          nodeCount: summary.nodeCount,
          typeBreakdown: summary.typeBreakdown,
          topDomains: summary.topDomains,
          recentSample: summary.recentSample,
          completionRate: summary.completionRate,
          topHour: summary.topHour,
          dominantDomains: summary.dominantDomains,
          userName: loadProfileSettings().displayName,
          feedbackSamples: recentFeedbackSamples(),
        }),
      });
      if (res.status === 401) { setError('auth'); return; }
      const data = await res.json() as { ok?: boolean; paragraphs?: Array<{ text: string; evidence: string[]; confidence: number }>; reason?: string };
      if (data.reason === 'no_api_key') { setError('no-key'); return; }
      if (data.reason === 'quota') { setError('quota'); return; }
      if (data.reason === 'insufficient_data') { setError('thin'); return; }
      if (data.reason === 'api_error' || !data.ok || !data.paragraphs?.length) { setError('ai-error'); return; }
      const next: MirrorLetter = {
        mirrorId,
        month,
        generatedAt: new Date().toISOString(),
        paragraphs: data.paragraphs.map((p, i) => ({ id: `p${i}`, text: p.text, evidence: p.evidence, confidence: p.confidence })),
      };
      saveMirrorLetter(next);
      setLetter(next);
      track('mirror_letter_generated', { mirror: mirrorId });
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  }, [mirrorId, dict, month, monthLabel]);

  function pickMirror(id: MirrorId) {
    const def = MIRRORS.find((m) => m.id === id);
    if (def && !def.freePreview && !isPro()) {
      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'mirror_letter' } }));
      return;
    }
    setMirrorId(id);
  }

  function verdict(paragraphId: string, v: 'yes' | 'no') {
    const key = `${month}:${mirrorId}:${paragraphId}`;
    saveMirrorFeedback(key, v);
    setFeedback((prev) => ({ ...prev, [key]: v }));
  }

  const active = MIRRORS.find((m) => m.id === mirrorId) ?? MIRRORS[0];
  const errorText = error === 'auth'
    ? L(dict, '登录后,Nesio 每月给你写一封信。', 'Sign in and Nesio writes you a letter each month.')
    : error === 'no-key'
      ? L(dict, '还没接上 AI(部署里配一个 AI key 即可),信写不出来。', 'AI is not connected yet (set an AI key in your deployment).')
      : error === 'quota'
        ? L(dict, 'AI 免费额度暂时用完了(服务端需配 ANTHROPIC_API_KEY 或给 Gemini 开付费)——不是你的问题。', 'The free AI quota is used up for now (server needs ANTHROPIC_API_KEY or paid Gemini) — not your fault.')
      : error === 'thin'
        ? L(dict, '这个月能读到的还不多 —— 记满 10 条,信才有的可写。', 'Not much to read yet — the letter starts at 10 notes.')
        : error === 'network'
          ? L(dict, '网络异常,这封信没送到,点重试。', 'Network issue — the letter did not arrive. Tap retry.')
          : error === 'ai-error'
            ? L(dict, '这次没写出来(AI 忙或稍有波动),点重试。', 'Could not write it this time (AI busy) — tap retry.')
            : '';

  return (
    <div className="nesio-mirror-tab">
      {/* 镜子选择:一排 5 面,非老友 + 免费 → Pro 门 */}
      <div className="nesio-mirror-picker" role="radiogroup" aria-label={L(dict, '选择一面镜子', 'Choose a mirror')}>
        {MIRRORS.map((m) => {
          const locked = !m.freePreview && !isPro();
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mirrorId === m.id}
              className={`nesio-mirror-chip${mirrorId === m.id ? ' nesio-mirror-chip--active' : ''}`}
              onClick={() => pickMirror(m.id)}
            >
              {L(dict, m.name, m.nameEn)}
              {locked && <span className="nesio-mirror-chip-lock" aria-label="Pro">·Pro</span>}
            </button>
          );
        })}
      </div>
      <p className="nesio-mirror-desc">{L(dict, active.desc, active.descEn)}</p>

      {/* 信纸 */}
      {letter ? (
        <div className="nesio-mirror-letter">
          <p className="nesio-mirror-letter-date">
            {monthLabel} · {L(dict, active.name, active.nameEn)}
          </p>
          {letter.paragraphs.map((p) => {
            const key = `${month}:${mirrorId}:${p.id}`;
            const v = feedback[key];
            return (
              <div key={p.id} className="nesio-mirror-para">
                <p className="nesio-mirror-para-text">{p.text}</p>
                {p.evidence.length > 0 && (
                  <div className="nesio-mirror-evidence">
                    {p.evidence.map((e, i) => (
                      <span key={i} className="nesio-mirror-evidence-chip">{e}</span>
                    ))}
                  </div>
                )}
                <div className="nesio-mirror-verdict">
                  <button
                    type="button"
                    className={`nesio-lm-fb-btn${v === 'yes' ? ' nesio-lm-fb-btn--yes' : ''}`}
                    onClick={() => verdict(p.id, 'yes')}
                    title={L(dict, '说得对', 'Spot on')}
                  >✓</button>
                  <button
                    type="button"
                    className={`nesio-lm-fb-btn${v === 'no' ? ' nesio-lm-fb-btn--no' : ''}`}
                    onClick={() => verdict(p.id, 'no')}
                    title={L(dict, '不像我', 'Not me')}
                  >✗</button>
                </div>
              </div>
            );
          })}
          <div className="nesio-mirror-footer">
            <span>{L(dict, '只回看,不预测 · 每段可反驳,你的 ✓/✗ 会进下一封', 'Looks back, never predicts · dispute any line — your ✓/✗ shapes the next letter')}</span>
            <button type="button" className="nesio-lm-refresh-btn" onClick={() => void generate()} disabled={loading} title={L(dict, '重写这封信', 'Rewrite')}>↺</button>
          </div>
        </div>
      ) : (
        <div className="nesio-mirror-empty">
          {loading ? (
            <p className="nesio-mirror-writing">{L(dict, `${L(dict, active.name, active.nameEn)}正在读你这个月的记录…`, `${L(dict, active.name, active.nameEn)} is reading your month…`)}</p>
          ) : (
            <>
              <p className="nesio-mirror-empty-line">
                {L(dict, `每月一封信:${active.name}读完你的记录,写给你。`, `One letter a month: ${active.nameEn} reads your notes and writes to you.`)}
              </p>
              {errorText && <p className="nesio-mirror-error">{errorText}</p>}
              <button type="button" className="nesio-lm-perspective-btn" onClick={() => void generate()} disabled={nodeCount < 10 && !error}>
                {nodeCount < 10 && !error
                  ? L(dict, `已亲手记 ${nodeCount} / 10 条,记满后开写(通讯录等批量导入不算)`, `${nodeCount} / 10 hand-written notes — starts at 10 (bulk imports like contacts don't count)`)
                  : L(dict, '写这封信', 'Write the letter')}
              </button>
            </>
          )}
        </div>
      )}
      {letter && errorText && <p className="nesio-mirror-error">{errorText}</p>}
      {loading && letter && <p className="nesio-mirror-writing">{L(dict, '正在重写…', 'Rewriting…')}</p>}
    </div>
  );
}
