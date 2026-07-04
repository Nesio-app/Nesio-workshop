'use client';

/**
 * 触发式关联闪现 — 存入新记忆后，顺带显示 1-2 条历史关联
 * 用法：
 *   const { flashNodes, triggerFlash } = useMemoryFlash();
 *   <MemoryFlashBanner nodes={flashNodes} onDismiss={...} />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

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

function timeAgo(iso: string, dict: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return L(dict, '今天', 'today');
  if (days < 7) return L(dict, `${days} 天前`, `${days}d ago`);
  if (days < 30) return L(dict, `${Math.floor(days / 7)} 周前`, `${Math.floor(days / 7)}w ago`);
  if (days < 365) return L(dict, `${Math.floor(days / 30)} 个月前`, `${Math.floor(days / 30)}mo ago`);
  return L(dict, `${Math.floor(days / 365)} 年前`, `${Math.floor(days / 365)}y ago`);
}

interface Props {
  nodes: LifeNode[];
  onDismiss: () => void;
}

export default function MemoryFlashBanner({ nodes, onDismiss }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
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
        <span className="mem-flash-label">{L(dict, '你还记得…', 'Remember this…')}</span>
        <button
          type="button"
          className="mem-flash-close"
          onClick={onDismiss}
          aria-label={L(dict, '关闭关联提示', 'Dismiss related note')}
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
            <span className="mem-flash-node-time">{timeAgo(node.createdAt, dict)}</span>
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
