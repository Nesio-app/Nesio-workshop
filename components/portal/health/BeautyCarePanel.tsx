'use client';

/**
 * BeautyCarePanel — 健康页「护理」:护肤/美容物品入口(物品分类「护肤」)。
 * 不另建美容竖井;条码美妆查库仍走相机/物品。
 */

import { useEffect, useState } from 'react';
import { listBeautyCareItems } from '@/lib/portal/body-ledger';
import type { InventoryItem } from '@/lib/portal/inventory';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconBox, IconChevronRight, IconCamera } from '../icons';

export default function BeautyCarePanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);

  function reload() {
    try { setItems(listBeautyCareItems()); } catch { setItems([]); }
  }

  useEffect(() => {
    reload();
    const onUp = () => reload();
    window.addEventListener('nesio-life-graph-updated', onUp);
    return () => window.removeEventListener('nesio-life-graph-updated', onUp);
  }, []);

  function openInventory() {
    window.dispatchEvent(new CustomEvent('nesio-open-inventory'));
  }

  function openCamera() {
    window.dispatchEvent(new CustomEvent('nesio-open-camera'));
  }

  return (
    <div className="nesio-beauty-care">
      <p className="nesio-bl-lede">{L(dict, '护理 · 护肤与美容', 'Care · skincare & beauty')}</p>
      <p className="nesio-trip-footnote">
        {L(dict, '挂在健康页:皮肤护理是身体账的一部分。物品分类选「护肤」就会出现在这里。', 'Lives under Health — skincare is part of the body ledger. Tag items as Skincare to list them here.')}
      </p>

      {items.length === 0 ? (
        <div className="nesio-bl-empty-block">
          <p>{L(dict, '还没有护肤类物品 —— 拍瓶瓶罐罐,或到物品里加一条「护肤」。', 'No skincare items yet — snap a bottle, or add one under Inventory → Skincare.')}</p>
          <div className="nesio-bl-empty-actions">
            <button type="button" className="nesio-trip-action" onClick={openCamera}>
              <IconCamera size={16} /> {L(dict, '拍一拍', 'Snap')}
            </button>
            <button type="button" className="nesio-trip-primary" style={{ width: 'auto' }} onClick={openInventory}>
              {L(dict, '去物品', 'Inventory')}
            </button>
          </div>
        </div>
      ) : (
        <ul className="nesio-bl-care-list">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="nesio-bl-care-row" onClick={openInventory}>
                <span className="nesio-bl-care-ico"><IconBox size={16} /></span>
                <span className="nesio-bl-care-main">
                  <b>{it.name}</b>
                  <small>
                    {[it.category, it.location, it.expiry ? L(dict, `效期 ${it.expiry}`, `exp ${it.expiry}`) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <IconChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
