'use client';

/**
 * 触发式关联闪现 — 存入新记忆后，顺带显示 1-2 条历史关联
 * 用法：
 *   const { flashNodes, triggerFlash } = useMemoryFlash();
 *   <MemoryFlashBanner nodes={flashNodes} onDismiss={...} />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMemoryFlash() {
  const [flashNodes, setFlashNodes] = useState<LifeNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setFlashNodes([]);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const triggerFlash = useCallback((savedNode: { id: string; name: string; rawInput?: string }) => {
    // Search for related nodes by name + raw input
    const query = [savedNode.name, savedNode.rawInput ?? ''].join(' ').trim();
    if (!query) return;

    const hits = searchLifeGraphFuzzy(query, 8);
    const related = hits
      .filter((node) => {
        if (node.id === savedNode.id) return false;
        // Only show nodes older than 7 days (avoid immediate re-flash of similar saves)
        const ageDays = (Date.now() - new Date(node.createdAt).getTime()) / 86_400_000;
        return ageDays >= 7;
      })
      .slice(0, 2);

    if (related.length === 0) return;

    setFlashNodes(related);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlashNodes([]), 7000);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { flashNodes, triggerFlash, dismiss };
}

// ── UI component ─────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return '今天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

interface Props {
  nodes: LifeNode[];
  onDismiss: () => void;
}

export default function MemoryFlashBanner({ nodes, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  // Animate in
  useEffect(() => {
    if (nodes.length > 0) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [nodes.length]);

  if (nodes.length === 0) return null;

  return (
    <div
      className={`mem-flash-wrap${visible ? ' mem-flash-wrap--in' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="mem-flash-header">
        <span className="mem-flash-label">你还记得…</span>
        <button
          type="button"
          className="mem-flash-close"
          onClick={onDismiss}
          aria-label="关闭关联提示"
        >
          ✕
        </button>
      </div>

      <div className="mem-flash-list">
        {nodes.map((node) => (
          <div key={node.id} className="mem-flash-node">
            <span className="mem-flash-node-type">{TYPE_EMOJI[node.type] ?? '📌'}</span>
            <div className="mem-flash-node-body">
              <p className="mem-flash-node-name">{node.name}</p>
              {node.rawInput && node.rawInput !== node.name && (
                <p className="mem-flash-node-hint">
                  {node.rawInput.slice(0, 60)}{node.rawInput.length > 60 ? '…' : ''}
                </p>
              )}
            </div>
            <span className="mem-flash-node-time">{timeAgo(node.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TYPE_EMOJI: Partial<Record<string, string>> = {
  person:       '👤',
  event:        '📅',
  commitment:   '🤝',
  health_state: '💚',
  preference:   '⭐',
  place:        '📍',
  object:       '📦',
};
