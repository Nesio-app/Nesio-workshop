'use client';

/**
 * 每日 AI 图文日报开关关掉时,回顾/计划/日报三个面板都会整段不出现——之前是
 * 直接 return null,一片空白不说明原因(真机反馈:「目标页回顾/计划两个 tab
 * 什么都没有」,查下来是这个开关关着,但界面没说)。改成显式空态,同项目里
 * 别处空态一个规格(nesio-insights-empty)。
 *
 * 单独一个文件,不放进 RetrospectPanel/DailyReportPanel 任一个里——那两个
 * 互相之间已经有 next/dynamic 懒加载关系,再互相 import 这个小组件会绕成环。
 */

import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export function DailyReportOffNotice() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <p className="nesio-insights-empty">
      {L(
        dict,
        '每日 AI 图文日报已关闭 —— 去设置里打开「每日 AI 图文日报」,节律/回顾/计划就会有内容。',
        'Daily AI report is off — turn on "Daily AI report" in Settings to see rhythm/retrospect/plan content here.',
      )}
    </p>
  );
}
