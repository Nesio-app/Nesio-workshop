'use client';

/**
 * RoadmapSheet — 「投票给未来功能」:展示 backlog 候选,用户打 1-5 星。
 * 清单来自 lib/portal/roadmap.ts(单一事实源);投票按设备去重,
 * 改分覆盖;汇总在 /admin 功能许愿榜。匿名可投(与遥测同 deviceId)。
 */

import { useCallback, useEffect, useState } from 'react';
import { ROADMAP_ITEMS } from '@/lib/portal/roadmap';
import { track } from '@/lib/portal/telemetry';

const DEVICE_KEY = 'nesio-telemetry-device-v1';

interface VoteState { avg: number; count: number; mine: number | null }

const STATUS_LABEL: Record<string, string> = { building: '在做了', planned: '已排期', exploring: '探索中' };

function deviceId(): string {
  try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; }
}

export default function RoadmapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [votes, setVotes] = useState<Map<string, VoteState>>(new Map());
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/feature-vote?deviceId=${encodeURIComponent(deviceId())}`);
      const json = await res.json() as { ok: boolean; items?: Array<{ featureId: string; avg: number; count: number; mine: number | null }> };
      if (json.ok) setVotes(new Map((json.items || []).map((i) => [i.featureId, { avg: i.avg, count: i.count, mine: i.mine }])));
    } catch { /* 汇总加载失败不拦投票 */ }
  }, []);

  useEffect(() => { if (open) { setError(''); void load(); } }, [open, load]);

  async function vote(featureId: string, score: number) {
    setSavingId(featureId);
    setError('');
    try {
      const res = await fetch('/api/portal/feature-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureId, score, deviceId: deviceId() }),
      });
      const json = await res.json() as { ok: boolean };
      if (json.ok) {
        track('feature_vote', { feature: featureId, score });
        await load();
      } else {
        setError('这一票没送到,稍后再试。');
      }
    } catch {
      setError('这一票没送到,稍后再试。');
    }
    setSavingId('');
  }

  if (!open) return null;
  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="投票给未来功能">
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">投票给未来功能</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="nesio-settings-sheet-body">
          <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', margin: '0 0 0.8rem' }}>
            你的星星决定先做什么。点星即投,可以随时改。
          </p>
          {ROADMAP_ITEMS.map((item) => {
            const v = votes.get(item.id);
            return (
              <div key={item.id} style={{ padding: '0.7rem 0', borderTop: '1px solid var(--portal-line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--portal-ink)' }}>
                    {item.title}
                    <span style={{ marginLeft: 6, fontSize: '0.62rem', color: 'var(--portal-muted)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '0.05rem 0.4rem' }}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </p>
                  {v && v.count > 0 && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>★ {v.avg} · {v.count} 票</span>
                  )}
                </div>
                <p style={{ margin: '0.2rem 0 0.45rem', fontSize: '0.76rem', color: 'var(--portal-muted)', lineHeight: 1.5 }}>{item.description}</p>
                <div style={{ display: 'flex', gap: '0.3rem' }} role="radiogroup" aria-label={`给 ${item.title} 打分`}>
                  {[1, 2, 3, 4, 5].map((s) => {
                    const active = (v?.mine ?? 0) >= s;
                    return (
                      <button key={s} type="button" role="radio" aria-checked={v?.mine === s}
                        onClick={() => void vote(item.id, s)} disabled={savingId === item.id}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.15rem', padding: '0.1rem', color: active ? 'var(--status-gentle)' : 'var(--portal-line)', transition: 'color 0.15s' }}>
                        ★
                      </button>
                    );
                  })}
                  {savingId === item.id && <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', alignSelf: 'center' }}>记下了…</span>}
                </div>
              </div>
            );
          })}
          {error && <p style={{ fontSize: '0.74rem', color: 'var(--status-risk)', margin: '0.6rem 0 0' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
