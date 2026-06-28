'use client';

/**
 * MirrorProfileCard — shows what Nesio has learned about this user.
 * Displayed in the settings 语气与边界 section or as a standalone card.
 */

import { useEffect, useState } from 'react';
import { getMirrorProfile, type MirrorProfile } from '@/lib/portal/mirror-profile';

const DOMAIN_LABELS: Record<string, string> = {
  weather: '天气 · 外出', work: '工作 · 会议', family: '家庭 · 礼物',
  home: '家 · 物品', health: '健康', vehicle: '出行 · 车辆',
  learning: '学习', finance: '财务',
};

const HOUR_GROUPS = [
  { label: '清晨 6-9', hours: [6, 7, 8] },
  { label: '上午 9-12', hours: [9, 10, 11] },
  { label: '下午 12-18', hours: [12, 13, 14, 15, 16, 17] },
  { label: '晚上 18-23', hours: [18, 19, 20, 21, 22] },
];

function avg(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function describeWeight(weight: number): string {
  if (weight >= 0.65) return '经常出现';
  if (weight >= 0.35) return '偶尔出现';
  return '刚开始出现';
}

function describeTime(score: number): string {
  if (score >= 0.65) return '比较常见';
  if (score >= 0.35) return '偶尔合适';
  return '仍在观察';
}

export default function MirrorProfileCard({ embedded = false }: { embedded?: boolean }) {
  const [profile, setProfile] = useState<MirrorProfile | null>(null);

  useEffect(() => {
    const load = () => setProfile(getMirrorProfile());
    load();
    window.addEventListener('nesio-feedback-recorded', load);
    return () => window.removeEventListener('nesio-feedback-recorded', load);
  }, []);

  if (!profile) return null;
  if (profile.feedbackCount === 0 && !embedded) return null; // Don't show before any feedback

  const domainEntries = Object.entries(profile.domainWeights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const bestTimes = HOUR_GROUPS
    .map((g) => ({ ...g, score: avg(g.hours.map((h) => profile.hourEngagement[h])) }))
    .sort((a, b) => b.score - a.score);

  const interruptLabels: Record<string, string> = {
    proactive: '主动推送', minimal: '轻量模式', silent: '安静模式',
  };

  return (
    <div className="nesio-mirror-card">
      <div className="nesio-mirror-header">
        <span className="nesio-mirror-icon">🔮</span>
        <div>
          <p className="nesio-mirror-title">Nesio 目前怎么理解你</p>
          <p className="nesio-mirror-sub">基于 {profile.feedbackCount} 次反馈</p>
        </div>
        <span className="nesio-mirror-mode">{interruptLabels[profile.interruptionStyle] || '主动推送'}</span>
      </div>

      {domainEntries.length > 0 && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>经常出现</p>
          {domainEntries.map(([domain, weight]) => (
            <div key={domain} className="nesio-mirror-domain-row">
              <span className="nesio-mirror-domain-label">{DOMAIN_LABELS[domain] || domain}</span>
              <div className="nesio-mirror-bar-track">
                <div className="nesio-mirror-bar-fill" style={{ width: `${Math.max(16, Math.round(weight * 72))}%` }} />
              </div>
              <span className="nesio-mirror-domain-pct">{describeWeight(weight)}</span>
            </div>
          ))}
        </>
      )}

      {profile.feedbackCount > 5 && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: '0.85rem' }}>最佳提醒时段</p>
          <div className="nesio-mirror-times">
            {bestTimes.slice(0, 2).map((g) => (
              <span key={g.label} className="nesio-mirror-time-chip">
                {g.label} · {describeTime(g.score)}
              </span>
            ))}
          </div>
        </>
      )}

      {profile.feedbackCount > 0 && (
        <button type="button" className="nesio-settings-toggle-btn" style={{ marginTop: '0.85rem' }}>
          不再这样理解我
        </button>
      )}

      {profile.feedbackCount < 5 && embedded && (
        <p style={{ fontSize: '0.75rem', color: 'var(--portal-muted)', marginTop: '0.5rem' }}>
          对 Today 卡片给出反馈后，Nesio 会在这里展示你的偏好。
        </p>
      )}
    </div>
  );
}
