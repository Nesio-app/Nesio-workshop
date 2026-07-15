'use client';

/**
 * ThawedReminder — 冷冻仓解冻提醒条(批次 7)。
 * 有解冻待决定的物品时出现在 Today 首屏,点开进冷冻清单。
 *
 * 安全审计(freeze 走闭环):此前它**直接** open FreezeVaultSheet,绕过 Portal 的
 * canOpenFreeze 门(付费墙旁路)。现改为派发 `nesio-open-freeze`,经**唯一开门点**
 * (Portal.freezeHandler)统一走门;且未上线 / 无权益时整条不出现(canOpenFreeze 为假)。
 */

import { useEffect, useState } from 'react';
import { getThawedItems } from '@/lib/platform/impulse-guard';
import { canOpenFreeze } from '@/lib/portal/entitlement';
import { IconSnowflake } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export function ThawedReminder() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [count, setCount] = useState(0);

  useEffect(() => {
    const read = () => { try { setCount(getThawedItems().length); } catch { setCount(0); } };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);

  // 未上线 / 无权益 → 不出现;开门统一走 Portal 的 nesio-open-freeze 门(不再自开旁路)。
  if (count === 0 || !canOpenFreeze()) return null;

  return (
    <button
      type="button"
      className="nesio-thawed-banner"
      onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-freeze'))}
    >
      <IconSnowflake size={15} />
      <span>{L(dict, `${count} 件冷冻到期了 — 现在还想买吗？`, `${count} frozen item${count > 1 ? 's' : ''} thawed — still want ${count > 1 ? 'them' : 'it'}?`)}</span>
      <span className="nesio-thawed-banner-cta">{L(dict, '去决定', 'Decide')}</span>
    </button>
  );
}
