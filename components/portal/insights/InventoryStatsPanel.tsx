'use client';

/**
 * InventoryStatsPanel — 洞察「物品」tab:只读统计 dashboard(件数/估值/归位率/分类/
 * 卖闲置/亚马逊转卖)。要管理仍去物品页(顶部「打开物品管理」派发 nesio-open-inventory)。
 * 与物品页统计视图同口径(inventoryStats/sellPile/amazonSummary),不留双实现的数据源。
 */

import { useEffect, useMemo, useState } from 'react';
import { inventoryStats, type InventoryItem } from '@/lib/portal/inventory';
// 口径和收纳页、记忆页那个「收纳」球共用一处 —— 各写各的正是 22 vs 18 的来源。
import { listStorageItems } from '@/lib/portal/inventory-visibility';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

/**
 * bug2:物品分类由横条列表改成饼图(纯 SVG,无依赖)。类别色走设计系统 --viz-1..8,
 * 换皮肤跟着变;前 7 类 + 其余合并「其他」,免得小切片挤成毛刺。点任意处进物品页。
 */
const PIE_COLORS = Array.from({ length: 8 }, (_, i) => `var(--viz-${i + 1})`);
function CategoryPie({ rows, onOpen, dict }: {
  rows: Array<{ category: string; count: number }>; onOpen: () => void; dict: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return null;
  const top = rows.slice(0, 7);
  const restCount = rows.slice(7).reduce((s, r) => s + r.count, 0);
  const shown = restCount > 0
    ? [...top, { category: L(dict, '其他', 'Other'), count: restCount }]
    : top;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const slices = shown.map((r, i) => {
    const pct = (r.count / total) * 100;
    const len = (pct / 100) * C;
    const node = (
      <circle key={r.category} r={R} fill="none" stroke={PIE_COLORS[i % PIE_COLORS.length]}
        strokeWidth="26" strokeLinecap="butt" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />
    );
    acc += len;
    return { node, pct: Math.round(pct), row: r, color: PIE_COLORS[i % PIE_COLORS.length] };
  });
  return (
    <button type="button" onClick={onOpen}
      style={{ display: 'block', width: '100%', marginTop: 'var(--space-5)', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
      {/* 半径 52 + 描边 26 ⇒ 实心饼(内圈归零),不是环 */}
      <svg viewBox="0 0 140 140" width="140" height="140" style={{ display: 'block', margin: '0 auto' }} aria-label={L(dict, '物品分类占比', 'Items by category')}>
        <g transform="translate(70,70) rotate(-90)">{slices.map((s) => s.node)}</g>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-3)', marginTop: 'var(--space-2)' }}>
        {slices.map((s) => (
          <span key={s.row.category} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            {s.row.category}
            <span style={{ color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>{s.row.count} · {s.pct}%</span>
          </span>
        ))}
      </div>
    </button>
  );
}

export default function InventoryStatsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    // 食材归「做饭·库存」脸,物品统计排除,免得库存数/估值把菠菜也算进去。
    const load = () => { try { setItems(listStorageItems()); } catch { setItems([]); } };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
    };
  }, []);

  const st = useMemo(() => inventoryStats(items), [items]);

  const openInventory = () => window.dispatchEvent(new CustomEvent('nesio-open-inventory'));

  if (items.length === 0) {
    return (
      <div className="nesio-analytics-tab">
        <p className="nesio-insights-empty">{L(dict, '还没有物品。到物品页记几件,统计会自动出现。', 'No items yet — add a few in Items and stats appear here.')}</p>
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-3)' }} onClick={openInventory}>{L(dict, '打开物品管理', 'Open Items')}</button>
      </div>
    );
  }

  const totalItems = items.length;
  const unplaced = items.filter((i) => !i.space).length;
  const placed = totalItems - unplaced;
  const placedPct = totalItems ? Math.round((placed / totalItems) * 100) : 0;
  const maxCat = Math.max(1, ...st.byCategory.map((c) => c.count));

  const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
  const kv: React.CSSProperties = { display: 'block', fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)', color: 'var(--portal-ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };
  const kl: React.CSSProperties = { display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' };
  const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };

  return (
    <div className="nesio-analytics-tab">
      {/* 概览:物品 / 估值 / 未归位 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
        <div style={card}><span style={kv}>{totalItems}</span><span style={kl}>{L(dict, '物品', 'Items')}</span></div>
        <div style={card}><span style={kv}>≈${Math.round(st.totalValue).toLocaleString('en-US')}</span><span style={kl}>{L(dict, '估值', 'Est. value')}</span></div>
        <div style={{ ...card, ...(unplaced > 0 ? { background: 'var(--status-gentle-soft)', borderColor: 'transparent' } : {}) }}>
          <span style={{ ...kv, ...(unplaced > 0 ? { color: 'var(--status-gentle)' } : {}) }}>{unplaced}</span>
          <span style={kl}>{L(dict, '未归位', 'Unplaced')}</span>
        </div>
      </div>

      {/* 归位进度 */}
      <p style={{ ...sectionLbl, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>{L(dict, '归位进度', 'Placement')}</span>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--status-go)', fontVariantNumeric: 'tabular-nums' }}>{placedPct}%</span>
      </p>
      <div style={{ height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--status-gentle-soft)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${placedPct}%`, background: 'var(--status-go)', borderRadius: 'var(--radius-pill)' }} />
      </div>
      <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
        {L(dict, `已归位 ${placed} · 未归位 ${unplaced} · ${st.spaces} 个空间 · ${st.containers} 个容器`, `${placed} placed · ${unplaced} unplaced · ${st.spaces} spaces · ${st.containers} bins`)}
      </p>

      {/* bug2:分类横条图 → 饼图,「按分类」黑体小标题删掉(饼图自带图例) */}
      {st.byCategory.length > 0 && <CategoryPie rows={st.byCategory} onOpen={openInventory} dict={dict} />}

      {/* bug2:「常用标签」「在处理」两节按图注删除 */}

      <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-5)' }} onClick={openInventory}>
        {L(dict, '打开物品管理', 'Open Items')}
      </button>
    </div>
  );
}
