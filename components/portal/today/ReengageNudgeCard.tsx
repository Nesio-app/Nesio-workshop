'use client';

/**
 * ReengageNudgeCard — 回访再触达提醒(Part 3/3)。
 *
 * 面向「来过好几回、但某功能一直没碰」的用户:今天页上轻轻探一句「要不要试试?」。
 * 区别于新手引导(第一次)和 demo(空库)。全局两天内至多一条,warm-coach 三个出口:
 * 打开 / 稍后(冷却几天)/ 不再提醒(永久)。功能以现有为准,CTA 只指向已存在的入口。
 */

import { useEffect, useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconBulb } from '../icons';
import {
  pickReengagementNudge,
  markNudgeShown,
  markFeatureUsed,
  snoozeNudge,
  dismissNudgeForever,
  FEATURE_USAGE_EVENT,
  type ReengageNudge,
  type UsageNode,
} from '@/lib/portal/feature-usage';

export function ReengageNudgeCard({ nodes, onOpenInsights }: {
  nodes: readonly UsageNode[];
  onOpenInsights?: () => void;
}) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const zh = locale === 'zh';
  const [dismissed, setDismissed] = useState(false);

  // 只在挂载时定一条(避免节点每变一次就跳来跳去);节点数作稳定性输入。
  const nodeCount = nodes.length;
  const nudge = useMemo<ReengageNudge | null>(
    () => pickReengagementNudge({ nodes, zh }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅按节点数与语言重算,避免引用抖动
    [nodeCount, zh],
  );

  useEffect(() => {
    if (nudge && !dismissed) markNudgeShown();
  }, [nudge, dismissed]);

  if (!nudge || dismissed) return null;

  const open = () => {
    markFeatureUsed(nudge.key);         // 打开即视为已用,不再叨扰
    if (nudge.openEvent) window.dispatchEvent(new CustomEvent(nudge.openEvent));
    else if (nudge.key === 'insights') onOpenInsights?.();
    setDismissed(true);
  };
  const later = () => { snoozeNudge(nudge.key); setDismissed(true); };
  const never = () => { dismissNudgeForever(nudge.key); setDismissed(true); };

  return (
    <div className="nesio-reengage-card" role="note">
      <div className="nesio-reengage-head">
        <span className="nesio-reengage-icon" aria-hidden><IconBulb size={16} /></span>
        <p className="nesio-reengage-title">{nudge.title}</p>
      </div>
      <p className="nesio-reengage-body">{nudge.body}</p>
      <div className="nesio-reengage-actions">
        <button type="button" className="nesio-reengage-cta" onClick={open}>{nudge.ctaLabel}</button>
        <button type="button" className="nesio-reengage-ghost" onClick={later}>{L(dict, '稍后', 'Later')}</button>
        <button type="button" className="nesio-reengage-ghost" onClick={never}>{L(dict, '不再提醒', 'Never')}</button>
      </div>
    </div>
  );
}

// 供测试/外部感知使用的事件名(避免魔法字符串外溢)
export { FEATURE_USAGE_EVENT };
