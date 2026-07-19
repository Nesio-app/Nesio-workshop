'use client';

/**
 * DailyBriefSheet — 今日文字简报(批次 30 起;批次 176 重构)。
 *
 * 用户定案:简报的内容必须和「问一问」同一套算法 —— 不单独攒数据,只是排版漂亮。
 * 于是:buildMemoryContext(今天的安排/提醒)→ 同一个 /api/portal/chat 生成一段话
 *       → extractCitations 抽出「相关记忆」挂成可点链接(点开即回看那条记忆)。
 * 属 AI 例程(ai_routine),Pro 整功能(试用期内可用)。
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

// 简报走的就是问一问:同一句「今天有什么」检索,同一个对话端点生成。
const BRIEF_QUERY = { zh: '今天有哪些安排、提醒和要注意的事', en: "what's on for me today" };
const BRIEF_MSG = {
  zh: '给我今天的简报:把我今天的安排、提醒和值得注意的事,用温暖、简洁的一段话说给我听。没有安排就如实说今天很空,别编。',
  en: 'Give me my brief for today: sum up my schedule, reminders and anything worth noting in one warm, concise paragraph. If nothing is scheduled, say the day is clear — do not invent.',
};

function greetingFor(hour: number, dict: 'zh' | 'en', name: string): string {
  const g = hour < 5 ? L(dict, '凌晨好', 'Good morning')
    : hour < 12 ? L(dict, '早上好', 'Good morning')
    : hour < 18 ? L(dict, '下午好', 'Good afternoon')
    : L(dict, '晚上好', 'Good evening');
  return name ? (dict === 'en' ? `${g}, ${name}` : `${g},${name}`) : g;
}

export function DailyBriefSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [script, setScript] = useState('');
  const [refs, setRefs] = useState<LifeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'auth' | 'network' | null>(null);
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  // 生成代:连点「换个说法/重试」会并发多个 /api/portal/chat,慢的旧响应后到会盖掉新简报。
  // 每次生成 bump 此代,收尾按代校验,只认最后一次(last-response-wins)。
  const briefSeqRef = useRef(0);

  const fetchBrief = useCallback(async () => {
    const myGen = ++briefSeqRef.current;
    setLoading(true);
    setError(null);
    // 批次194 补齐九路(§5.3):简报=付费云例程。入口已被 canUse('ai_routine') 挡(设置/例程卡);
    // 这里再兜一层 —— 分层启用后免费直达也不打云(静默停,不重复弹升级窗)。
    if (!canUsePaidCloudAi()) { setLoading(false); return; }
    try {
      const profile = loadProfileSettings();
      // ① 同一套检索算法(与问一问共用 buildMemoryContext)
      const { context: memoryContext, refCandidates } = await buildMemoryContext(dict === 'en' ? BRIEF_QUERY.en : BRIEF_QUERY.zh);
      // 批次190:把**真·跨域相关**(真实皮尔逊 r)喂进简报上下文 —— 让简报引真数字,
      // 不再让模型在聚合块上瞎编「外卖多 40%」。统计相关非因果,原样引用不改动。
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
      // ② 同一个对话端点生成一段话(只是提示词让它写成简报)
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
      // 连点期间又发起了新一次生成 → 这次已过期,丢弃(不 setScript/setError 到新结果上)。
      if (briefSeqRef.current !== myGen) return;
      if (res.status === 401) { setError('auth'); return; }
      const data = await res.json() as { ok?: boolean; response?: string };
      if (briefSeqRef.current !== myGen) return;
      if (data.ok && data.response) {
        // ③ 同一套引用解析:把模型自报的【依据】剥掉,cited 节点挂成「相关记忆」链接
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
      // 只有仍是最新一次才收 loading,避免过期请求的 finally 提前停掉新一次的转圈。
      if (briefSeqRef.current === myGen) setLoading(false);
    }
  }, [dict]);

  useEffect(() => {
    if (open && !script && !loading) void fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时取一次,重取走「换个说法」
  }, [open]);

  if (!open) return null;
  const now = new Date();
  const profile = loadProfileSettings();
  const dateLabel = now.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  // 详情浮层打开时,让底层引用卡 live 化(点开的可能是被改过的节点)
  const liveRefs = refs.map((r) => getLifeGraph().find((n) => n.id === r.id) || r);

  return (
    <>
      <NesioSheet
        variant="bottom"
        open
        onOpenChange={(next) => { if (!next) onClose(); }}
        card={false}
        className="nesio-settings-sheet-card nesio-brief-card"
        ariaLabel={L(dict, '今日简报', "Today's brief")}
      >
        <div className="nesio-brief-head">
          <div>
            <p className="nesio-brief-greeting">{greetingFor(now.getHours(), dict, profile.displayName || '')}</p>
            <p className="nesio-brief-date">{dateLabel}</p>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">
          {loading && <p className="nesio-mirror-writing">{L(dict, '念念正在整理今天…', 'Nessa is putting today together…')}</p>}
          {!loading && script && (
            <>
              <p className="nesio-daily-brief-text nesio-serif-voice">{script}</p>
              {liveRefs.length > 0 && (
                <div className="nesio-brief-refs">
                  <span className="nesio-brief-refs-label">{L(dict, '相关记忆 · 点开看看', 'From your memory · tap to open')}</span>
                  {liveRefs.map((n) => (
                    <button key={n.id} type="button" className="nesio-brief-ref-chip" onClick={() => setDetailNode(n)}>
                      <NodeTypeIcon type={n.type} size={12} />
                      <span className="nesio-brief-ref-name">{n.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="nesio-lm-perspective-btn" style={{ marginTop: '0.9rem' }} onClick={() => void fetchBrief()}>
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
        </div>
      </NesioSheet>
      {detailNode && (
        <MemoryNodeDetail node={detailNode} onClose={() => setDetailNode(null)} onOpenNode={(n) => setDetailNode(n)} />
      )}
    </>
  );
}
