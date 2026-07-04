'use client';

/**
 * ThawedReminder — 冷冻仓解冻提醒条(批次 7)。
 * 冷冻仓入口迁进拍一下的购买冷静面板后,「到期做决定」这一环留在 Today 首屏:
 * 有解冻待决定的物品时出现,点开直接进冷冻清单。
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getThawedItems } from '@/lib/platform/impulse-guard';
import { IconSnowflake } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const FreezeVaultSheet = dynamic(() => import('../FreezeVaultSheet'), { ssr: false });

export function ThawedReminder() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const read = () => { try { setCount(getThawedItems().length); } catch { setCount(0); } };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, [open]);

  if (count === 0) return null;

  return (
    <>
      <button type="button" className="nesio-thawed-banner" onClick={() => setOpen(true)}>
        <IconSnowflake size={15} />
        <span>{L(dict, `${count} 件冷冻到期了 — 现在还想买吗？`, `${count} frozen item${count > 1 ? 's' : ''} thawed — still want it?`)}</span>
        <span className="nesio-thawed-banner-cta">{L(dict, '去决定', 'Decide')}</span>
      </button>
      <FreezeVaultSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
