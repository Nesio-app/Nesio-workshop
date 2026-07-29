'use client';

/**
 * InventoryStatsPanel — 洞察「物品」tab:只读统计 dashboard(件数/估值/归位率/分类/
 * 卖闲置/亚马逊转卖)。要管理仍去物品页(顶部「打开物品管理」派发 nesio-open-inventory)。
 * 与物品页统计视图同口径(inventoryStats/sellPile/amazonSummary),不留双实现的数据源。
 */

import { useEffect, useMemo, useState } from 'react';
import { listInventoryItems, inventoryStats, sellPile, amazonSummary, type InventoryItem } from '@/lib/portal/inventory';
import { isFoodItem } from '@/lib/cooking/pantry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export default function InventoryStatsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    // 食材归「做饭·库存」脸,物品统计排除,免得库存数/估值把菠菜也算进去。
    const load = () => { try { setItems(listInventoryItems().filter((i) => !isFoodItem(i))); } catch { setItems([]); } };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
    };
  }, []);

  const st = useMemo(() => inventoryStats(items), [items]);
  const sp = useMemo(() => sellPile(items), [items]);
  const amz = useMemo(() => amazonSummary(items), [items]);

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

      {/* 常用标签 */}
      {st.topTags.length > 0 && (
        <>
          <p style={sectionLbl}>{L(dict, '常用标签', 'Top tags')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {st.topTags.map((t) => (
              <button key={t.tag} type="button" onClick={openInventory}
                style={{ padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', background: 'var(--portal-accent-soft)', border: '1px solid var(--portal-line)', color: 'var(--portal-ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {t.tag} <span style={{ color: 'var(--portal-muted)' }}>{t.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 在处理:卖闲置 + 亚马逊转卖(点卡进物品页) */}
      {(sp.items.length > 0 || amz.count > 0) && (
        <>
          <p style={sectionLbl}>{L(dict, '在处理', 'In progress')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: amz.count > 0 ? '1fr 1fr' : '1fr', gap: 'var(--space-2)' }}>
            <button type="button" onClick={openInventory} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{L(dict, '卖闲置堆', 'Sell pile')}</span>
              <span style={{ display: 'block', marginTop: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                {L(dict, `${sp.items.length} 件 · 约 $${Math.round(sp.totalValue).toLocaleString('en-US')}`, `${sp.items.length} items · ≈$${Math.round(sp.totalValue).toLocaleString('en-US')}`)}
              </span>
            </button>
            {amz.count > 0 && (
              <button type="button" onClick={openInventory} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{L(dict, '亚马逊转卖', 'Amazon flip')}</span>
                <span style={{ display: 'block', marginTop: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                  {L(dict, `${amz.count} 件 · 已赚 $${Math.round(amz.realizedProfit).toLocaleString('en-US')}`, `${amz.count} items · $${Math.round(amz.realizedProfit).toLocaleString('en-US')} earned`)}
                </span>
                {amz.reviewDue > 0 && (
                  <span style={{ display: 'inline-block', marginTop: '0.4rem', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>
                    {L(dict, `${amz.reviewDue} 件待留评`, `${amz.reviewDue} to review`)}
                  </span>
                )}
              </button>
            )}
          </div>
        </>
      )}

      <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-5)' }} onClick={openInventory}>
        {L(dict, '打开物品管理', 'Open Items')}
      </button>
    </div>
  );
}
