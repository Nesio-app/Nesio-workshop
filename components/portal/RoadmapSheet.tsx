'use client';

/**
 * RoadmapSheet — 「投票给未来功能」:展示 backlog 候选,用户打 1-5 星。
 * 清单来自 lib/portal/roadmap.ts(单一事实源);投票按设备去重,
 * 改分覆盖;汇总在 /admin 功能许愿榜。匿名可投(与遥测同 deviceId)。
 */

import { useCallback, useEffect, useState } from 'react';
import { ROADMAP_ITEMS } from '@/lib/portal/roadmap';
import { track } from '@/lib/portal/telemetry';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';

const DEVICE_KEY = 'nesio-telemetry-device-v1';

interface VoteState { avg: number; count: number; mine: number | null }

function deviceId(): string {
  try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; }
}

export default function RoadmapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const statusLabel: Record<string, string> = {
    building: t(locale, 'statusBuilding'),
    planned: t(locale, 'statusPlanned'),
    exploring: t(locale, 'statusExploring'),
  };
  const [votes, setVotes] = useState<Map<string, VoteState>>(new Map());
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [wish, setWish] = useState('');
  const [wishSent, setWishSent] = useState(false);
  // 批次 32:常见问题 / 未来功能各自折叠,页面不再一屏全铺
  const [faqOpen, setFaqOpen] = useState(false);
  const [voteOpen, setVoteOpen] = useState(false);

  // 自由许愿(批次 4):**许愿全文只进云产品事件**(按本人身份、RLS 隔离,产品评审用)——
  // 隐私修复:不再把 free-text 塞进共享匿名 telemetry_events(仅带 device_id、绕 RLS),那会把
  // 用户原话泄进匿名共享表。遥测只留「有人许愿 + 长度」的无内容信号,不带任何原文。
  function submitWish() {
    const text = wish.trim();
    if (!text || wishSent) return;
    track('feature_wish', { length: text.length });
    void createAppApiClient().recordCloudProductEvent({
      eventType: 'feature.wish',
      source: 'roadmap',
      targetType: 'feature_wish',
      payload: { text },
    }).catch(() => {});
    setWishSent(true);
  }

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
        setError(t(locale, 'roadmapError'));
      }
    } catch {
      setError(t(locale, 'roadmapError'));
    }
    setSavingId('');
  }

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={t(locale, 'roadmapTitle')}
    >
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{t(locale, 'roadmapTitle')}</h2>
        </div>
        <div className="nesio-settings-sheet-body">
          {/* 批次 32:两个折叠区(常见问题 / 未来功能),点标题展开 */}
          <button type="button" onClick={() => setFaqOpen((v) => !v)} aria-expanded={faqOpen}
            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '0.55rem 0', cursor: 'pointer' }}>
            <span className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '常见问题', 'FAQ')}</span>
            <span style={{ color: 'var(--portal-muted)' }}>{faqOpen ? '▴' : '▾'}</span>
          </button>
          {faqOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', fontSize: '0.82rem', lineHeight: 1.6, marginBottom: '0.9rem' }}>
            {[
              [L(dict, '不登录能用吗?', 'Does it work without an account?'), L(dict, '能。核心记录/搜索/回顾全部本地可用;登录只用于云同步和邮箱/日历连接。', 'Yes — capture, search, and review all work locally. Sign in only enables cloud sync and email/calendar.')],
              [L(dict, '我的数据在哪?', 'Where is my data?'), L(dict, '默认只在你的设备上;登录并开同步后才备份到云端。设置→数据 可随时导出或删除。', 'On your device by default; backed up only after you sign in and enable sync. Export or delete anytime in Settings → Data.')],
              [L(dict, 'AI 识别为什么要点按钮?', 'Why is AI a button?'), L(dict, '默认零等待零成本地先记下;想要 AI 自动识别再点「AI 识别」。Pro 自动执行。', 'Saving is instant and free by default; tap "AI recognize" when you want it. Pro runs it automatically.')],
              [L(dict, '怎么联系你们?', 'How do I reach you?'), L(dict, '邮件 support@nesio.app,或直接在下面给功能投票留言。', 'Email support@nesio.app, or vote and comment on features below.')],
            ].map(([q, a]) => (
              <div key={q}>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--portal-ink)' }}>{q}</p>
                <p style={{ margin: '0.15rem 0 0', color: 'var(--portal-muted)' }}>{a}</p>
              </div>
            ))}
          </div>
          )}

          <button type="button" onClick={() => setVoteOpen((v) => !v)} aria-expanded={voteOpen}
            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '0.55rem 0', cursor: 'pointer' }}>
            <span className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '给未来功能投票', 'Vote on upcoming features')}</span>
            <span style={{ color: 'var(--portal-muted)' }}>{voteOpen ? '▴' : '▾'}</span>
          </button>
          {voteOpen && (<>
          <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', margin: '0 0 0.8rem' }}>
            {t(locale, 'roadmapHint')}
          </p>
          {ROADMAP_ITEMS.map((item) => {
            const v = votes.get(item.id);
            return (
              <div key={item.id} style={{ padding: '0.7rem 0', borderTop: '1px solid var(--portal-line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--portal-ink)' }}>
                    {item.title[dict]}
                    <span style={{ marginLeft: 6, fontSize: '0.62rem', color: 'var(--portal-muted)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-pill)', padding: '0.05rem 0.4rem' }}>
                      {statusLabel[item.status]}
                    </span>
                  </p>
                  {v && v.count > 0 && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>{t(locale, 'roadmapVotesTemplate', { avg: v.avg, count: v.count })}</span>
                  )}
                </div>
                <p style={{ margin: '0.2rem 0 0.45rem', fontSize: '0.76rem', color: 'var(--portal-muted)', lineHeight: 1.5 }}>{item.description[dict]}</p>
                <div style={{ display: 'flex', gap: 0, marginLeft: '-0.6rem' }} role="radiogroup" aria-label={`${item.title[dict]}`}>
                  {[1, 2, 3, 4, 5].map((s) => {
                    const active = (v?.mine ?? 0) >= s;
                    return (
                      <button key={s} type="button" role="radio" aria-checked={v?.mine === s}
                        onClick={() => void vote(item.id, s)} disabled={savingId === item.id}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.35rem', minWidth: 'var(--tap-min)', minHeight: 'var(--tap-min)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: active ? 'var(--status-gentle)' : 'var(--portal-line)', transition: 'color 0.15s' }}>
                        ★
                      </button>
                    );
                  })}
                  {savingId === item.id && <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', alignSelf: 'center' }}>{t(locale, 'roadmapSaving')}</span>}
                </div>
              </div>
            );
          })}
          </>)}
          {voteOpen && (<>
          {/* 自由许愿输入(批次 4) */}
          <div style={{ borderTop: '1px solid var(--portal-line)', marginTop: '0.9rem', paddingTop: '0.9rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--portal-ink)', margin: '0 0 0.45rem' }}>{t(locale, 'wishLabel')}</p>
            {wishSent ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--status-go)', margin: 0 }}>✓ {t(locale, 'wishDone')}</p>
            ) : (
              <>
                <textarea
                  value={wish}
                  onChange={(e) => setWish(e.target.value)}
                  placeholder={t(locale, 'wishPlaceholder')}
                  maxLength={80}
                  rows={2}
                  style={{ width: '100%', resize: 'none', borderRadius: '0.75rem', border: '1.5px solid var(--portal-line)', background: 'rgba(88,140,227,0.04)', color: 'var(--portal-ink)', fontSize: '0.82rem', padding: '0.55rem 0.7rem', outline: 'none', fontFamily: 'inherit' }}
                />
                <button
                  type="button"
                  className="nesio-ob-primary-btn"
                  style={{ marginTop: '0.5rem', opacity: wish.trim() ? 1 : 0.5 }}
                  disabled={!wish.trim()}
                  onClick={submitWish}
                >
                  {t(locale, 'wishSubmit')}
                </button>
              </>
            )}
          </div>

          </>)}
          {error && <p style={{ fontSize: '0.74rem', color: 'var(--status-risk)', margin: '0.6rem 0 0' }}>{error}</p>}
        </div>
    </NesioSheet>
  );
}
