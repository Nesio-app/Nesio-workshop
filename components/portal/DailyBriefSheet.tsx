'use client';

/**
 * DailyBriefSheet — 今日简报(彩色图文版)。
 *
 * 内容仍与「问一问」同一套算法(buildMemoryContext + /api/portal/chat),
 * 展示升级为彩色卡片:问候 hero、分段正文、相关记忆色块 —— 不再是一整段灰字。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { buildMemoryContext, extractCitations } from '@/lib/portal/memory-retrieval';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { formatEnvironmentContext } from '@/lib/portal/environment';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { canUsePaidCloudAi } from '@/lib/portal/entitlement';
import { usePortalLocale } from './use-portal-locale';
import { NodeTypeIcon } from './icons';
import NesioSheet from './ui/NesioSheet';

const MemoryNodeDetail = dynamic(() => import('./MemoryNodeDetail'), { ssr: false });

const BRIEF_QUERY = { zh: '今天有哪些安排、提醒和要注意的事', en: "what's on for me today" };
const BRIEF_MSG = {
  zh: '给我今天的简报:把我今天的安排、提醒和值得注意的事,用温暖、简洁的一段话说给我听。没有安排就如实说今天很空,别编。可用 1–3 个短段落,段落之间空一行。',
  en: 'Give me my brief for today: sum up my schedule, reminders and anything worth noting in a few warm short paragraphs (blank line between). If nothing is scheduled, say the day is clear — do not invent.',
};

const CARD_TONES = [
  'var(--status-calm-soft)',
  'var(--status-go-soft)',
  'var(--status-gentle-soft)',
  'var(--portal-accent-soft)',
] as const;
const CARD_INKS = [
  'var(--status-calm)',
  'var(--status-go)',
  'var(--status-gentle)',
  'var(--portal-accent)',
] as const;

function greetingFor(hour: number, dict: 'zh' | 'en', name: string): string {
  const g = hour < 5 ? L(dict, '凌晨好', 'Good morning')
    : hour < 12 ? L(dict, '早上好', 'Good morning')
    : hour < 18 ? L(dict, '下午好', 'Good afternoon')
    : L(dict, '晚上好', 'Good evening');
  return name ? (dict === 'en' ? `${g}, ${name}` : `${g},${name}`) : g;
}

function splitParagraphs(script: string): string[] {
  return script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function DailyBriefSheet({ open, onClose, canUsePrivateData = false }: { open: boolean; onClose: () => void; canUsePrivateData?: boolean }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [script, setScript] = useState('');
  const [refs, setRefs] = useState<LifeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'auth' | 'network' | null>(null);
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  const briefSeqRef = useRef(0);

  const fetchBrief = useCallback(async () => {
    const myGen = ++briefSeqRef.current;
    setLoading(true);
    setError(null);
    if (!canUsePaidCloudAi()) { setLoading(false); return; }
    try {
      const profile = loadProfileSettings();
      const { context: memoryContext, refCandidates } = await buildMemoryContext(dict === 'en' ? BRIEF_QUERY.en : BRIEF_QUERY.zh, '', canUsePrivateData);
      let briefContext = memoryContext;
      try {
        const { mineCrossDomain } = await import('@/lib/portal/cross-domain-correlations');
        const { readFactJournal, ensureFactJournal } = await import('@/lib/platform/fact-journal');
        ensureFactJournal();
        const corr = mineCrossDomain(readFactJournal(120)).slice(0, 2);
        if (corr.length) {
          const lines = corr.map((c) => `- ${(dict === 'en' ? c.insight[1] : c.insight[0])}(样本 ${c.n} 天)`).join('\n');
          briefContext += `\n\n${dict === 'en'
            ? 'Cross-domain stats (from the user\'s own records; correlation not causation; quote the r value verbatim, do not invent numbers):'
            : '跨域统计(基于用户真实记录;统计相关非因果;可原样引用 r 值,严禁编造数字):'}\n${lines}`;
        }
      } catch { /* 无 journal 数据不影响简报 */ }
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: dict === 'en' ? BRIEF_MSG.en : BRIEF_MSG.zh,
          history: [],
          coachStyle: profile.coachStyle || 'warm',
          uiLocale: dict,
          memoryContext: briefContext,
          environmentContext: formatEnvironmentContext(),
        }),
      });
      if (briefSeqRef.current !== myGen) return;
      if (res.status === 401) { setError('auth'); return; }
      const data = await res.json() as { ok?: boolean; response?: string };
      if (briefSeqRef.current !== myGen) return;
      if (data.ok && data.response) {
        const { text, ids } = extractCitations(data.response.trim());
        setScript(text.replace(/\*\*/g, ''));
        const cited: LifeNode[] = ids === null
          ? refCandidates.filter((r) => r.layer !== 'search').slice(0, 4).map((r) => r.node)
          : ids.map((id) => refCandidates.find((r) => r.shortId === id)?.node).filter((n): n is LifeNode => Boolean(n));
        setRefs(cited);
      } else {
        setError('network');
      }
    } catch {
      if (briefSeqRef.current === myGen) setError('network');
    } finally {
      if (briefSeqRef.current === myGen) setLoading(false);
    }
  }, [dict, canUsePrivateData]);

  useEffect(() => {
    if (open && !script && !loading) void fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时取一次,重取走「换个说法」
  }, [open]);

  if (!open) return null;
  const now = new Date();
  const profile = loadProfileSettings();
  const dateLabel = now.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const liveRefs = refs.map((r) => getLifeGraph().find((n) => n.id === r.id) || r);
  const paras = splitParagraphs(script);

  return (
    <>
      <NesioSheet
        variant="bottom"
        open
        onOpenChange={(next) => { if (!next) onClose(); }}
        card={false}
        className="nesio-settings-sheet-card nesio-brief-card nesio-brief-card--rich"
        ariaLabel={L(dict, '今日简报', "Today's brief")}
      >
        <div className="nesio-brief-hero">
          <div>
            <p className="nesio-brief-greeting">{greetingFor(now.getHours(), dict, profile.displayName || '')}</p>
            <p className="nesio-brief-date">{dateLabel}</p>
            <p className="nesio-brief-hero-tag">{L(dict, '今日简报 · 图文版', "Today's brief · illustrated")}</p>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body nesio-brief-rich-body">
          {loading && <p className="nesio-mirror-writing">{L(dict, '念念正在整理今天…', 'Nessa is putting today together…')}</p>}
          {!loading && script && (
            <>
              <div className="nesio-brief-cards">
                {paras.map((p, i) => (
                  <div
                    key={i}
                    className="nesio-brief-color-card"
                    style={{
                      background: CARD_TONES[i % CARD_TONES.length],
                      borderColor: CARD_INKS[i % CARD_INKS.length],
                    }}
                  >
                    <span className="nesio-brief-color-dot" style={{ background: CARD_INKS[i % CARD_INKS.length] }} aria-hidden />
                    <p className="nesio-brief-color-text">{p}</p>
                  </div>
                ))}
              </div>
              {liveRefs.length > 0 && (
                <div className="nesio-brief-refs">
                  <span className="nesio-brief-refs-label">{L(dict, '相关记忆', 'Related memories')}</span>
                  {liveRefs.map((n, i) => (
                    <button
                      key={n.id}
                      type="button"
                      className="nesio-brief-ref-chip nesio-brief-ref-chip--rich"
                      style={{ background: CARD_TONES[i % CARD_TONES.length] }}
                      onClick={() => setDetailNode(n)}
                    >
                      <NodeTypeIcon type={n.type} size={12} />
                      <span className="nesio-brief-ref-name">{n.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="nesio-lm-perspective-btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => void fetchBrief()}>
                {L(dict, '换个说法', 'Say it differently')}
              </button>
            </>
          )}
          {!loading && !script && error && (
            <>
              <p className="nesio-mirror-error">
                {error === 'auth'
                  ? L(dict, '登录后就能看每日简报。', 'Sign in to get your daily brief.')
                  : L(dict, '这次没生成出来,点重试。', 'Did not generate this time — tap retry.')}
              </p>
              {error !== 'auth' && (
                <button type="button" className="nesio-lm-perspective-btn" onClick={() => void fetchBrief()}>
                  {L(dict, '重试', 'Retry')}
                </button>
              )}
            </>
          )}
          {!loading && !script && !error && !canUsePaidCloudAi() && (
            <p className="nesio-mirror-error">{L(dict, '每日简报是 Pro 的能力。', 'Daily brief is a Pro feature.')}</p>
          )}
        </div>
      </NesioSheet>
      {detailNode && (
        <MemoryNodeDetail node={detailNode} onClose={() => setDetailNode(null)} onOpenNode={(n) => setDetailNode(n)} />
      )}
    </>
  );
}
