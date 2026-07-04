'use client';

/**
 * FocusCardDetail — 聚焦卡展开视图:会议直达 + Momentum 三步微行动引擎。
 * 从 TodayFeed 拆出(工程 PRD 组件阈值整改)。
 */

import { useState } from 'react';
import type { FocusNode, SubTask } from '@/lib/platform/view-models/today-view-model';
import { isMeetingNode, getMeetingTime, getMeetingUrl, safeExternalUrl } from './meeting-node';

export const FOCUS_TYPE_LABEL: Record<string, string> = {
  commitment: '任务', event: '日程', object: '物品', person: '联系人',
  place: '地点', health_state: '健康', preference: '偏好',
};
export const FOCUS_TYPE_ICON: Record<string, string> = {
  commitment: '📋', event: '📅', object: '📦', person: '👤',
  place: '📍', health_state: '🩷', preference: '⭐',
};

// ── Momentum Engine ── 3-action wave, auto-unlock, recursive drill ──────────

interface MomentumAction {
  id: string;
  name: string;
  emoji: string;
  done: boolean;
}

export function FocusCardDetail({
  node,
  onSubtasksChange: _onSubtasksChange,
  onOpenRecorder,
}: {
  node: FocusNode;
  onSubtasksChange: (nodeId: string, subtasks: SubTask[]) => void;
  onOpenRecorder?: () => void;
}) {
  const [wave, setWave] = useState<MomentumAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillMap, setDrillMap] = useState<Map<string, MomentumAction[]>>(new Map());
  const [drillingId, setDrillingId] = useState<string | null>(null);
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [waveIndex, setWaveIndex] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  const isMeeting = isMeetingNode(node);
  const meetingUrl = getMeetingUrl(node);
  const meetingTime = getMeetingTime(node);

  async function fetchWave(previousAction?: string, history: string[] = []) {
    setLoading(true);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName: node.name,
          context: node.rawInput,
          previousAction,
          completedActions: history,
        }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji?: string }> };
      if (data.ok && data.steps?.length) {
        const actions: MomentumAction[] = data.steps.slice(0, 3).map((s, i) => ({
          id: `m-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji || '⚡',
          done: false,
        }));
        setWave(actions);
        setWaveIndex((w) => w + 1);
        setDrillMap(new Map());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleDrill(action: MomentumAction) {
    setDrillingId(action.id);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName: action.name, context: node.name, drill: true }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji?: string }> };
      if (data.ok && data.steps?.length) {
        const drills: MomentumAction[] = data.steps.slice(0, 3).map((s, i) => ({
          id: `d-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji || '▸',
          done: false,
        }));
        setDrillMap((prev) => new Map(prev).set(action.id, drills));
      }
    } catch { /* ignore */ }
    setDrillingId(null);
  }

  function toggleAction(actionId: string) {
    const next = wave.map((a) => a.id === actionId ? { ...a, done: !a.done } : a);
    setWave(next);
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
              🔗 进入会议
            </a>
          )}
          {onOpenRecorder && (
            <button type="button" className="nesio-focus-meeting-record-btn" onClick={onOpenRecorder}>
              🎙 会议记录
            </button>
          )}
        </div>
        {meetingTime && <p className="nesio-focus-meeting-prep-hint">提前 5 分钟打开，检查静音和摄像头</p>}
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
            🔗 直达链接
          </a>
        )}
        <button type="button" className="nesio-momentum-ignite-btn" onClick={() => fetchWave()}>
          ⚡ 开始动量
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

  return (
    <div className="nesio-momentum">
      {waveIndex > 1 && (
        <div className="nesio-momentum-wave-badge">第 {waveIndex} 波</div>
      )}
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
                <span className="nesio-momentum-emoji">{a.emoji}</span>
                <span className="nesio-momentum-name">{a.name}</span>
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
                      <span className="nesio-momentum-drill-emoji">{d.emoji}</span>
                      <span className="nesio-momentum-drill-name">{d.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

