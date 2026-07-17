'use client';

/**
 * MontageTab — 洞察「小剧场」(用户定:把一段真实记忆变成一小段厚涂动漫短片)。
 * 呈现层:hero(最新一支)+ 画廊(往期)+ 空态(讲清概念 + 示例卡)。
 * 短片在 Lab 端生成后落本机,这里读出来看/播/删。
 */

import { useEffect, useState } from 'react';
import { loadMontages, deleteMontage, KIND_LABEL, DEMO_MONTAGES, type VideoMontage } from '@/lib/portal/video-montage';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export default function MontageTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [items, setItems] = useState<VideoMontage[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [playing, setPlaying] = useState<VideoMontage | null>(null);

  const refresh = () => {
    const real = loadMontages();
    if (real.length) { setItems(real); setIsDemo(false); }
    else { setItems(DEMO_MONTAGES); setIsDemo(true); }
  };
  useEffect(() => { refresh(); }, []);

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;
  const fmtDur = (s: number) => `0:${String(s).padStart(2, '0')}`;

  const hero = items[0];
  const rest = items.slice(1);

  const play = (m: VideoMontage) => { if (m.videoUrl) setPlaying(m); };

  const Poster = ({ m, big }: { m: VideoMontage; big?: boolean }) => (
    <button
      type="button"
      onClick={() => play(m)}
      style={{
        position: 'relative', display: 'block', width: '100%', padding: 0, border: 'none',
        borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor: m.videoUrl ? 'pointer' : 'default',
        aspectRatio: big ? '16 / 10' : '4 / 3', background: 'var(--portal-accent-soft)',
      }}
      aria-label={en ? `Play ${m.title}` : `播放 ${m.title}`}
    >
      <img src={m.poster} alt={m.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* 播放键 / 生成中 */}
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(180deg, transparent 40%, rgba(30,20,22,0.5))',
      }}>
        {m.status === 'generating' ? (
          <span style={{ color: '#fff', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{L(dict, '生成中…', 'Rendering…')}</span>
        ) : (
          <span style={{
            width: big ? 56 : 40, height: big ? 56 : 40, borderRadius: '50%',
            background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--portal-ink)', fontSize: big ? '1.2rem' : '0.9rem', paddingLeft: 3,
          }}>▶</span>
        )}
      </span>
      {/* 时长 / 类型 pill */}
      <span style={{
        position: 'absolute', top: 8, left: 8, background: 'rgba(30,20,22,0.55)', color: '#fff',
        fontSize: '0.66rem', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      }}>{L(dict, KIND_LABEL[m.kind].zh, KIND_LABEL[m.kind].en)}</span>
      <span style={{
        position: 'absolute', bottom: 8, right: 8, background: 'rgba(30,20,22,0.55)', color: '#fff',
        fontSize: '0.66rem', padding: '2px 7px', borderRadius: 'var(--radius-pill)', fontVariantNumeric: 'tabular-nums',
      }}>{fmtDur(m.durationSec)}</span>
    </button>
  );

  return (
    <div>
      <p className="nesio-insights-section-label">{L(dict, '小剧场', 'Short films')}</p>
      <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-4)' }}>
        {L(dict,
          '把你真实经历过的一刻，变成一小段动画短片 —— 一件事、一段记忆、一次心情的起落。',
          'Turn a moment you actually lived into a short animated film — one event, one memory, one shift in mood.')}
      </p>

      {isDemo && (
        <p className="nesio-settings-option-hint" style={{
          marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
          background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-sm)',
        }}>
          {L(dict, '下面是示例 —— 你的短片会从真实记忆生成后出现在这里。',
            'Examples below — your own films will appear here once generated from your real memories.')}
        </p>
      )}

      {hero && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Poster m={hero} big />
          <p style={{ fontFamily: 'var(--font-serif)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', margin: 'var(--space-3) 0 var(--space-1)', fontSize: 'var(--text-h3)' }}>{hero.title}</p>
          <p style={{ color: 'var(--portal-muted)', lineHeight: 1.6, margin: 0 }}>{hero.storyLine}</p>
          <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-1)' }}>{fmtDay(hero.createdAt)}</p>
        </div>
      )}

      {rest.length > 0 && (
        <>
          <p className="nesio-insights-section-label">{L(dict, '往期', 'Earlier')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            {rest.map((m) => (
              <div key={m.id}>
                <Poster m={m} />
                <p style={{ color: 'var(--portal-ink)', fontWeight: 'var(--weight-medium)', margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)' }}>{m.title}</p>
                <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{fmtDay(m.createdAt)}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
        {L(dict, '短片在本机生成 · 用你自己的记忆和照片 · 只有你能看到',
          'Rendered on your device · from your own memories and photos · only you can see them')}
      </p>

      {playing && (
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={playing.title}
          onClick={() => setPlaying(null)}>
          <div style={{ maxWidth: 460, width: '92%', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <video src={playing.videoUrl} controls autoPlay playsInline style={{ width: '100%', borderRadius: 'var(--radius-md)', background: '#000' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
              <button type="button" className="nesio-connector-connect" onClick={() => setPlaying(null)}>{L(dict, '关闭', 'Close')}</button>
              <button type="button" className="nesio-connector-disconnect" onClick={() => { deleteMontage(playing.id); setPlaying(null); refresh(); }}>{L(dict, '删除', 'Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
