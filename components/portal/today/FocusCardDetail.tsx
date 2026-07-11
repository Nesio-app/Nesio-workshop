'use client';

/**
 * FocusCardDetail — 聚焦卡展开视图:会议直达 + Momentum 三步微行动引擎。
 * 从 TodayFeed 拆出(工程 PRD 组件阈值整改)。
 */

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { getLiveMemoryNode, getLinkedChecklist, saveSubtasks, type LiveMemoryNode, type FocusNode, type SubTask } from '@/lib/platform/view-models/today-view-model';

const MemoryNodeDetail = dynamic(() => import('../MemoryNodeDetail'), { ssr: false });
import { isMeetingNode, getMeetingTime, getMeetingUrl, safeExternalUrl } from './meeting-node';
import { IconBox, IconCalendar, IconFlag, IconHeartPulse, IconMapPin, IconStar, IconUser, IconLink, IconMic } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { rememberAI, recallAI, sig } from '@/lib/portal/ai-cache';
import { decomposeLocally } from '@/lib/portal/local-decompose';
import { matchTaskTemplate } from '@/lib/platform/local-task-templates';
import { canUsePaidCloudAi } from '@/lib/portal/entitlement';

type Step = { name: string; emoji?: string; durationMin?: number };

export const FOCUS_TYPE_LABEL: Record<string, string> = {
  commitment: '任务', event: '日程', object: '物品', person: '联系人',
  place: '地点', health_state: '健康', preference: '偏好',
};
export const FOCUS_TYPE_ICON: Record<string, React.ReactNode> = {
  commitment: <IconFlag size={15} />, event: <IconCalendar size={15} />, object: <IconBox size={15} />, person: <IconUser size={15} />,
  place: <IconMapPin size={15} />, health_state: <IconHeartPulse size={15} />, preference: <IconStar size={15} />,
};

// ── Momentum Engine ── 3-action wave, auto-unlock, recursive drill ──────────

interface MomentumAction {
  id: string;
  name: string;
  emoji: string;
  done: boolean;
  /** 诚实时长(分钟);0/undefined = 不显示 */
  durationMin?: number;
}

export function FocusCardDetail({
  node,
  onSubtasksChange,
  onOpenRecorder, onFocusMode, focusModeLabel, onDelete }: {
  node: FocusNode;
  onSubtasksChange: (nodeId: string, subtasks: SubTask[]) => void;
  onOpenRecorder?: () => void;
  onFocusMode?: () => void;
  focusModeLabel?: string;
  onDelete?: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // 信任修复:今日卡的 ✕ 只是「从今日移除」(软隐藏,记忆仍在),用户常误以为是删除。
  // 这里给一个真·删除入口(两步确认),点了「确认彻底删除」才 deleteLifeNode —— 想抹掉
  // 敏感/错误记录的人有明确、名副其实的出口,不必再猜 ✕ 到底删没删。
  const [confirmDel, setConfirmDel] = useState(false);
  const [wave, setWave] = useState<MomentumAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillMap, setDrillMap] = useState<Map<string, MomentumAction[]>>(new Map());
  const [drillingId, setDrillingId] = useState<string | null>(null);
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [waveIndex, setWaveIndex] = useState(0);
  const [unlocking, setUnlocking] = useState(false);
  // 可见失败纪律:AI 分解失败/为空时显式提示 + 重试,不静默退回起始态。
  const [error, setError] = useState<string | null>(null);
  const [memNode, setMemNode] = useState<LiveMemoryNode | null>(null); // 批次 72:定位回记忆详情
  // 批次 74:wave 若来自清单(本体或关联),勾选要写回那份 subtasksJson
  const checklistTargetRef = useRef<string | null>(null);
  // 批次 56:这波步骤来自哪里 —— AI / 复用上次AI(缓存) / 本地兜底。null=AI(不显)
  const [waveSource, setWaveSource] = useState<'cache' | 'local' | null>(null);

  const isMeeting = isMeetingNode(node);
  const meetingUrl = getMeetingUrl(node);
  const meetingTime = getMeetingTime(node);

  // 应用一波步骤到 UI(来源:ai=记住并复用 / cache=复用上次AI / local=本地兜底)
  function applyWave(steps: Step[], source: 'ai' | 'cache' | 'local', cacheKey: string) {
    checklistTargetRef.current = null; // 非清单 wave:勾选不写回 subtasksJson
    const actions: MomentumAction[] = steps.slice(0, 6).map((s, i) => ({
      id: `m-${Date.now()}-${i}`, name: s.name, emoji: s.emoji || '⚡', done: false, durationMin: s.durationMin,
    }));
    setWave(actions);
    setWaveIndex((w) => w + 1);
    setDrillMap(new Map());
    setError(null);
    setWaveSource(source === 'ai' ? null : source);
    if (source === 'ai') rememberAI('decompose', cacheKey, steps); // 从 AI 学:记住这次拆解
  }

  // AI 不在线时的兜底:先复用上次 AI 给过的(缓存),再退到纯本地拆解 —— 永远给得出步骤。
  function fallbackWave(cacheKey: string) {
    const cached = recallAI<Step[]>('decompose', cacheKey);
    if (cached?.length) { applyWave(cached, 'cache', cacheKey); return; }
    applyWave(decomposeLocally(node.name, dict), 'local', cacheKey);
  }

  // 批次 39 用户定案:粉碎任务**默认不打联网 AI**(慢、要网)—— 本地秒出:
  // 常见任务命中模板(诚实步骤+真分钟) → 上次 AI 的缓存 → 通用骨架。
  // 云 AI 只走下面的「AI 细化」按钮。
  function fetchWave(previousAction?: string, _history: string[] = []) {
    setError(null);
    const cacheKey = sig(node.name + (previousAction ? `|next:${previousAction}` : ''));
    // 批次 73(用户定案):节点自带清单(存入的打包清单等)→ 直接显示条目
    // 本身,可勾选且状态落库 —— 不再用拆解引擎重新发明一遍。
    if (node.subtasks?.length && !previousAction) {
      checklistTargetRef.current = node.id;
      setWave(node.subtasks.map((st, i) => ({ id: st.id || `st-${i}`, name: st.name, emoji: '☑', done: st.done, durationMin: st.durationMin })));
      setDrillMap(new Map()); setError(null); setWaveSource(null);
      return;
    }
    // 批次 74:自己没清单,但关联着一份(打包收拾行李 → 旅行打包清单)→ 直采
    if (!previousAction) {
      const lc = getLinkedChecklist(node.id);
      if (lc) {
        checklistTargetRef.current = lc.nodeId;
        setWave(lc.subtasks.map((st, i) => ({ id: st.id || `st-${i}`, name: st.name, emoji: '☑', done: st.done, durationMin: st.durationMin })));
        setDrillMap(new Map()); setError(null); setWaveSource(null);
        return;
      }
    }
    checklistTargetRef.current = null;
    const tpl = matchTaskTemplate(node.name, dict);
    if (tpl && !previousAction) { applyWave(tpl, 'local', cacheKey); setWaveSource(null); return; }
    const cached = recallAI<Step[]>('decompose', cacheKey);
    if (cached?.length) { applyWave(cached, 'cache', cacheKey); setWaveSource(null); return; }
    const localSteps = decomposeLocally(node.name, dict);
    // 批次 74(用户实锤「第 2 波」又是同一套起步三句):脚手架只此一轮,
    // 做完就收尾 —— 不许自我复读。
    if (previousAction && localSteps[0] && /摊在面前|Spend 2 minutes/i.test(localSteps[0].name)) {
      applyWave([{ name: L(dict, '收尾:检查一遍,把整件事勾成完成', 'Wrap up: final check, then mark the task done'), emoji: '🏁', durationMin: 2 }], 'local', cacheKey);
      setWaveSource(null);
      return;
    }
    applyWave(localSteps, 'local', cacheKey);
    setWaveSource(null); // 本地是默认引擎,不再当"降级"提示
  }

  // 「AI 细化」:显式打云重拆(canUsePaidCloudAi 门;失败给可见提示,本地步骤仍在)
  const [aiRefining, setAiRefining] = useState(false);
  async function aiRefineWave() {
    if (aiRefining) return;
    if (!canUsePaidCloudAi()) {
      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'decompose_ai' } }));
      return;
    }
    setAiRefining(true);
    const cacheKey = sig(node.name);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName: node.name,
          context: node.rawInput,
          completedActions: completedActions,
          locale: dict,
        }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Step[] };
      if (data.ok && data.steps?.length) applyWave(data.steps, 'ai', cacheKey);
      else setError(L(dict, 'AI 这次没拆出来 —— 本地步骤照用,稍后再试。', "AI couldn't refine this time — the local steps still work."));
    } catch {
      setError(L(dict, 'AI 这次没连上 —— 本地步骤照用。', "Couldn't reach AI — the local steps still work."));
    }
    setAiRefining(false);
  }

  async function handleDrill(action: MomentumAction) {
    setDrillingId(action.id);
    const cacheKey = sig(`drill:${action.name}`);
    const applyDrills = (steps: Step[], fromAI: boolean) => {
      const drills: MomentumAction[] = steps.slice(0, 4).map((s, i) => ({
        id: `d-${Date.now()}-${i}`, name: s.name, emoji: s.emoji || '▸', done: false, durationMin: s.durationMin,
      }));
      setDrillMap((prev) => new Map(prev).set(action.id, drills));
      if (fromAI) rememberAI('decompose', cacheKey, steps);
    };
    // 批次 39:钻取同样本地优先(秒出);上次 AI 给过就复用
    applyDrills(recallAI<Step[]>('decompose', cacheKey) ?? matchTaskTemplate(action.name, dict) ?? decomposeLocally(action.name, dict), false);
    setDrillingId(null);
  }

  function toggleAction(actionId: string) {
    const next = wave.map((a) => a.id === actionId ? { ...a, done: !a.done } : a);
    setWave(next);
    // 清单模式:勾选状态写回来源节点的 subtasksJson(本体或关联清单),两处同步
    if (checklistTargetRef.current) {
      const target = checklistTargetRef.current;
      const subtasks = next.map((a) => ({ id: a.id, name: a.name, done: a.done, durationMin: a.durationMin }));
      if (target === node.id) onSubtasksChange(node.id, subtasks);
      else saveSubtasks(target, subtasks);
    }
    if (next.every((a) => a.done)) {
      const lastDone = next[next.length - 1].name;
      const allHistory = [...completedActions, ...next.map((a) => a.name)];
      setCompletedActions(allHistory);
      setUnlocking(true);
      setTimeout(() => {
        setUnlocking(false);
        setWave([]);
        fetchWave(lastDone, allHistory);
      }, 700);
    }
  }

  function toggleDrill(actionId: string, drillId: string) {
    setDrillMap((prev) => {
      const drills = prev.get(actionId) ?? [];
      return new Map(prev).set(actionId, drills.map((d) => d.id === drillId ? { ...d, done: !d.done } : d));
    });
  }

  // Meeting view — unchanged
  if (isMeeting) {
    return (
      <div className="nesio-focus-detail nesio-focus-detail--meeting">
        <div className="nesio-focus-meeting-actions">
          {meetingUrl && (
            <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="nesio-focus-meeting-link-btn">
              <IconLink size={15} /> {L(dict, '进入会议', 'Join')}
            </a>
          )}
          {onOpenRecorder && (
            <button type="button" className="nesio-focus-meeting-record-btn" onClick={onOpenRecorder}>
              <IconMic size={15} /> {L(dict, '会议记录', 'Record')}
            </button>
          )}
        </div>
        {meetingTime && <p className="nesio-focus-meeting-prep-hint">{L(dict, '提前 5 分钟打开，检查静音和摄像头', 'Open 5 min early — check mute and camera')}</p>}
      </div>
    );
  }

  const nodeUrl = Object.values(node.attributes).find(
    (v) => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
  ) as string | undefined;

  // Not started yet
  if (wave.length === 0 && !loading && !unlocking) {
    return (
      <div className="nesio-momentum-start">
        {nodeUrl && (
          <a href={safeExternalUrl(nodeUrl)} target="_blank" rel="noopener noreferrer" className="nesio-focus-meeting-link-btn">
            {L(dict, '直达链接', 'Open link')}
          </a>
        )}
        {error && <p className="nesio-momentum-error" style={{ color: 'var(--status-risk)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{error}</p>}
        <button type="button" className="nesio-momentum-ignite-btn" onClick={() => fetchWave()}>
          {error ? L(dict, '重试', 'Retry') : L(dict, '粉碎任务', 'Smash it')}
        </button>
        {onFocusMode && (
          <button type="button" className="nesio-collapsed-focus-btn" onClick={onFocusMode}>
            {focusModeLabel ?? L(dict, '聚焦', 'Focus')}
          </button>
        )}
        <button
          type="button"
          className="nesio-collapsed-focus-btn"
          style={{ color: 'var(--status-risk)' }}
          onClick={() => {
            if (!confirmDel) { setConfirmDel(true); return; }
            onDelete?.();
          }}
        >
          {confirmDel ? L(dict, '确认彻底删除', 'Confirm delete') : L(dict, '删除', 'Delete')}
        </button>
      </div>
    );
  }

  // Loading / unlocking state
  if (loading || unlocking || wave.length === 0) {
    return (
      <div className="nesio-momentum-loading">
        <span className="nesio-momentum-loading-dot" />
        <span className="nesio-momentum-loading-dot" />
        <span className="nesio-momentum-loading-dot" />
      </div>
    );
  }

  // 参考竞品:整卡给一个诚实总时长(overall ~45 min);没有时长数据就不显示
  const totalMin = wave.reduce((sum, a) => sum + (a.durationMin || 0), 0);

  return (
    <div className="nesio-momentum">
      {waveIndex > 1 && (
        <div className="nesio-momentum-wave-badge">{L(dict, `第 ${waveIndex} 波`, `Wave ${waveIndex}`)}</div>
      )}
      {waveSource && (
        <p className="nesio-settings-option-hint" style={{ margin: '0 0 0.4rem' }}>
          {waveSource === 'cache'
            ? L(dict, 'AI 暂时离线 · 复用了上次给你的拆解', 'AI offline · reused its last breakdown for you')
            : L(dict, 'AI 暂时离线 · 这是本地拆的,够你先动起来', 'AI offline · a local breakdown to get you moving')}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 0.45rem' }}>
        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {totalMin > 0 ? L(dict, `共约 ${totalMin} 分钟`, `overall ~${totalMin} min`) : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {/* 批次 72(用户点名):从聚焦卡定位回记忆本体 —— 看详情/关联链/清单 */}
          <button
            type="button"
            onClick={() => { const live = getLiveMemoryNode(node.id); if (live) setMemNode(live); }}
            style={{ background: 'none', border: '1px solid var(--portal-line)', borderRadius: 999, padding: '0.2rem 0.6rem', fontSize: '0.68rem', color: 'var(--portal-muted)', cursor: 'pointer' }}
          >
            {L(dict, '查看详情', 'Details')}
          </button>
          {/* 批次 39:云 AI 只走这颗显式按钮 —— 默认引擎是本地模板/骨架,秒出 */}
          <button
            type="button"
            onClick={() => void aiRefineWave()}
            disabled={aiRefining}
            style={{ background: 'none', border: '1px solid var(--portal-line)', borderRadius: 999, padding: '0.2rem 0.6rem', fontSize: '0.68rem', color: 'var(--portal-accent)', cursor: 'pointer', opacity: aiRefining ? 0.6 : 1 }}
          >
            {aiRefining ? L(dict, 'AI 细化中…', 'Refining…') : L(dict, 'AI 细化', 'AI refine')}
          </button>
        </div>
      </div>
      <ul className="nesio-momentum-list">
        {wave.map((a) => {
          const drills = drillMap.get(a.id);
          const isDrilling = drillingId === a.id;
          const allDrillsDone = drills ? drills.every((d) => d.done) : false;

          return (
            <li key={a.id} className={`nesio-momentum-item${a.done ? ' nesio-momentum-item--done' : ''}`}>
              <div className="nesio-momentum-row">
                <button
                  type="button"
                  className={`nesio-momentum-check${a.done ? ' nesio-momentum-check--done' : ''}`}
                  onClick={() => toggleAction(a.id)}
                  aria-label={a.done ? '取消' : '完成'}
                />
                {/* 批次 14:emoji 不进 UI(红线);动作名本身就够了 */}
                <span className="nesio-momentum-name">{a.name}</span>
                {!!a.durationMin && (
                  <span style={{ flexShrink: 0, fontSize: '0.7rem', color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {a.durationMin} min
                  </span>
                )}
                {!a.done && !drills && !isDrilling && (
                  <button
                    type="button"
                    className="nesio-momentum-hard-btn"
                    onClick={() => handleDrill(a)}
                  >
                    太难
                  </button>
                )}
                {isDrilling && <span className="nesio-momentum-drilling">⋯</span>}
                {drills && !a.done && (
                  <span className={`nesio-momentum-drill-badge${allDrillsDone ? ' nesio-momentum-drill-badge--done' : ''}`}>
                    {drills.filter((d) => d.done).length}/{drills.length}
                  </span>
                )}
              </div>

              {drills && (
                <ul className="nesio-momentum-drill-list">
                  {drills.map((d) => (
                    <li
                      key={d.id}
                      className={`nesio-momentum-drill-item${d.done ? ' nesio-momentum-drill-item--done' : ''}`}
                    >
                      <button
                        type="button"
                        className={`nesio-momentum-drill-check${d.done ? ' nesio-momentum-drill-check--done' : ''}`}
                        onClick={() => toggleDrill(a.id, d.id)}
                        aria-label={d.done ? '取消' : '完成'}
                      />
                      {/* 批次 14:同上,去 emoji */}
                      <span className="nesio-momentum-drill-name">{d.name}</span>
                      {!!d.durationMin && (
                        <span style={{ flexShrink: 0, fontSize: '0.66rem', color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {d.durationMin} min
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {/* 批次 74:portal 到 body —— 聚焦卡在带 transform 的容器里,fixed 详情会被
          困住(半屏卡死无法滚动,用户实锤)。 */}
      {memNode && typeof document !== 'undefined' && createPortal(
        <MemoryNodeDetail node={memNode} onClose={() => setMemNode(null)} />,
        document.body,
      )}
    </div>
  );
}

