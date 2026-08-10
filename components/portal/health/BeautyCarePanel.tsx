'use client';

/**
 * BeautyCarePanel — 健康页「护理」:护肤/美容物品入口(物品分类「护肤」)。
 * 不另建美容竖井;条码美妆查库仍走相机/物品。
 */

import { useEffect, useRef, useState } from 'react';
import { listBeautyCareItems } from '@/lib/portal/body-ledger';
import type { InventoryItem } from '@/lib/portal/inventory';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconBox, IconChevronRight, IconCamera, IconUpload } from '../icons';
import SnapButton from '../SnapButton';

export default function BeautyCarePanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function onUploadPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    window.dispatchEvent(new CustomEvent('nesio-open-camera', { detail: { file } }));
  }

  return (
    <div className="nesio-beauty-care">
      <div className="nesio-bl-empty-actions" style={{ marginBottom: 'var(--space-3)' }}>
        <SnapButton className="nesio-health-iconbtn" ariaLabel={L(dict, '拍一拍', 'Snap')}>
          <IconCamera size={18} />
        </SnapButton>
        <button type="button" className="nesio-health-iconbtn" aria-label={L(dict, '上传图片', 'Upload photo')}
          onClick={() => fileRef.current?.click()}>
          <IconUpload size={18} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUploadPick} />
        <button type="button" className="nesio-health-iconbtn" aria-label={L(dict, '去物品', 'Inventory')}
          onClick={openInventory}>
          <IconBox size={18} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="nesio-trip-footnote" style={{ margin: 0 }}>
          {L(dict, '还没有护肤物品 —— 拍一张或去物品里加。', 'No skincare items yet — snap a photo or add in Inventory.')}
        </p>
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
