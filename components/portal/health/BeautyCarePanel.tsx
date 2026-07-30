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
import SnapButton from '../SnapButton';

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

  return (
    <div className="nesio-beauty-care">
      {/* bug3 p36:「护理 · 护肤与美容」标题和空态那句小字都删了 —— tab 名已经说了这是护理页,
          两个按钮自己就说明了要干什么。 */}
      {items.length === 0 ? (
        <div className="nesio-bl-empty-block">
          <div className="nesio-bl-empty-actions">
            {/* bug3:「拍一拍」原来只派 nesio-open-camera(不带图),相机停在选择页 ——
                改走 SnapButton:按钮自己持 capture 相机,拿到图再派事件,直接进识别。 */}
            <SnapButton className="nesio-trip-action" ariaLabel={L(dict, '拍一拍', 'Snap')}>
              <IconCamera size={16} /> {L(dict, '拍一拍', 'Snap')}
            </SnapButton>
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
