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
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.8rem' }} onClick={openInventory}>{L(dict, '打开物品管理', 'Open Items')}</button>
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
  const kl: React.CSSProperties = { display: 'block', marginTop: '0.25rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' };
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

      {/* 按分类 */}
      {st.byCategory.length > 0 && (
        <>
          <p style={sectionLbl}>{L(dict, '按分类', 'By category')}</p>
          {/* 长得像入口就得是入口(QA):点分类行进物品页 */}
          {st.byCategory.slice(0, 8).map((c) => (
            <button key={c.category} type="button" onClick={openInventory}
              style={{ display: 'block', width: '100%', margin: '0 0 var(--space-2)', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', marginBottom: '0.2rem' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.category}</span>
                <span style={{ color: 'var(--portal-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)' }}>
                <div style={{ height: '100%', borderRadius: 'var(--radius-pill)', width: `${Math.round((c.count / maxCat) * 100)}%`, background: 'var(--portal-accent)' }} />
              </div>
            </button>
          ))}
        </>
      )}

      {/* bug2:「常用标签」「在处理」两节按图注删除 */}

      <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-5)' }} onClick={openInventory}>
        {L(dict, '打开物品管理', 'Open Items')}
      </button>
    </div>
  );
}
