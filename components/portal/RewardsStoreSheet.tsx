'use client';

/**
 * RewardsStoreSheet — 奖品商城独立入口(App 级)。原来只埋在冷冻仓的 rewards tab 里;
 * 积分现在来自忍住没买 / 跟练打卡 / 深度疗愈,是全 App 的,所以抽成独立 sheet:
 * 今天顶栏的积分徽章 + 「我」都开它(经 nesio-open-rewards 事件,Portal 挂载)。冷冻仓就地兑换保留。
 */

import NesioSheet from './ui/NesioSheet';
import RewardsStore from './RewardsStore';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

export default function RewardsStoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <NesioSheet variant="bottom" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={L(dict, '奖品商城', 'Rewards store')}>
      <RewardsStore />
    </NesioSheet>
  );
}
