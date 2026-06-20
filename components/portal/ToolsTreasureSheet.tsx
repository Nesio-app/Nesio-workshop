'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PortalTool } from '@/lib/portal/types';
import type { PortalLocale } from '@/lib/portal/profile';
import {
  readLaunchSurfaceContextFromBrowser,
} from '@/lib/portal/launch-surface.mjs';
import {
  getBaohePersonalizationProfile,
  readBaohePersonalizationStage,
  type BaoheDataDepthItem,
} from '@/lib/portal/personalization-insights';
import { resolveShellRuntimeTools } from '@/lib/portal/shell-runtime-resolver.mjs';
import { t } from '@/lib/portal/i18n';
import { formatStatusSummaryLine, type ToolForShellState } from './tool-state';
import ToolGrid from './ToolGrid';

interface LaunchSurfaceContext {
  viewerRole: 'public' | 'tester' | 'personal_lab';
  testerAllowlist: string[];
  testerCohort?: string | null;
}

function normalizeLaunchContext(raw: {
  viewerRole?: string;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}): LaunchSurfaceContext {
  return {
    viewerRole: raw.viewerRole === 'personal_lab'
      ? 'personal_lab'
      : raw.viewerRole === 'tester' ? 'tester' : 'public',
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

interface ToolsTreasurePopupProps {
  tools: PortalTool[];
  open: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  locale?: PortalLocale;
  variant?: 'popup' | 'screen';
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

const MY_TOOL_PREVIEWS = [
  {
    id: 'inventory',
    label: '物品库',
    description: '购买记忆',
    status: '今日可用',
  },
  {
    id: 'spending-record',
    label: '支出记录',
    description: '本地预览',
    status: '待确认',
  },
  {
    id: 'important-dates',
    label: '重要日期',
    description: '链接/预览',
    status: '待确认',
  },
  {
    id: 'later-processing',
    label: '稍后处理',
    description: '整理入口',
    status: '待确认',
  },
] as const;

const ADDABLE_TOOLS = [
  ['📖', 'reading-tracker', '阅读追踪'],
  ['🏋️', 'fitness-log', '健身记录'],
  ['🌱', 'habit-tracker', '习惯追踪'],
  ['🚗', 'vehicle-manager', '车辆管理'],
  ['💊', 'health-records', '健康档案'],
  ['🏡', 'home-maintenance', '家居维护'],
] as const;

const TOOL_PACKAGES = [
  {
    id: 'efficiency-daily',
    icon: '⚡',
    label: '效率日常包',
    description: '物品库 · 待办 · 习惯追踪',
  },
  {
    id: 'ai-assistant',
    icon: '✦',
    label: 'AI 助理包',
    description: '笔记 · 日程同步 · 后续接入',
  },
  {
    id: 'custom-toolbox',
    icon: '＋',
    label: '自定义工具包',
    description: '选择你的工具组合',
  },
] as const;

type ToolboxAction = {
  kind: 'tool' | 'package';
  id: string;
  label: string;
  message: string;
};

function dataDepthToneClass(item: BaoheDataDepthItem): string {
  return `portal-treasure-data-card--${item.tone}`;
}

/** Floating toolbox overlay — launch visibility is resolved before rendering. */
export default function ToolsTreasurePopup({
  tools,
  open,
  anchorRef,
  locale = 'zh',
  variant = 'popup',
  onClose,
  onOpenTool,
}: ToolsTreasurePopupProps) {
  const popupRef = useRef<HTMLElement>(null);
  const [placed, setPlaced] = useState(false);
  const [launchContext, setLaunchContext] = useState<LaunchSurfaceContext>({
    viewerRole: 'public',
    testerAllowlist: [],
  });
  const [personalizationProfile, setPersonalizationProfile] = useState(() => getBaohePersonalizationProfile());
  const [selectedToolboxAction, setSelectedToolboxAction] = useState<ToolboxAction | null>(null);

  useEffect(() => {
    setLaunchContext(normalizeLaunchContext(readLaunchSurfaceContextFromBrowser()));
    setPersonalizationProfile(getBaohePersonalizationProfile(readBaohePersonalizationStage()));
  }, []);

  useLayoutEffect(() => {
    if (!open || variant === 'screen') {
      setPlaced(false);
      return;
    }

    function placePopup() {
      const anchor = anchorRef?.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const r = anchor.getBoundingClientRect();
      const gap = 8;
      const margin = 12;
      const maxH = Math.min(window.innerHeight * 0.52, 320);
      let top = r.bottom + gap;
      let origin: 'top right' | 'bottom right' = 'top right';
      if (top + maxH > window.innerHeight - margin) {
        top = Math.max(margin, r.top - maxH - gap);
        origin = 'bottom right';
      }
      popup.style.setProperty('--treasure-top', `${top}px`);
      popup.style.setProperty('--treasure-right', `${Math.max(margin, window.innerWidth - r.right)}px`);
      popup.style.transformOrigin = origin;
      setPlaced(true);
    }

    placePopup();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placePopup) : null;
    if (anchorRef?.current) ro?.observe(anchorRef.current);
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', placePopup, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', placePopup);
      window.removeEventListener('scroll', placePopup, true);
    };
  }, [open, anchorRef, variant]);

  const visibleTools = useMemo(
    () => {
      return resolveShellRuntimeTools(
        tools.filter((tool) => tool.id !== 'secretary'),
        launchContext,
      ).visibleTools;
    },
    [tools, launchContext],
  );

  if (!open) return null;

  const toolsWithShellState = visibleTools as ToolForShellState[];
  const statusSummaryLine = formatStatusSummaryLine(toolsWithShellState, locale);
  const planTool = visibleTools.find((tool) => tool.id === 'plan');
  const inventoryTool = visibleTools.find((tool) => tool.id === 'inventory');

  function handleAddTool(id: string, label: string) {
    setSelectedToolboxAction({
      kind: 'tool',
      id,
      label,
      message: `${label} 已加入本地工作台请求。等对应模块开放后，会从这里继续。`,
    });
  }

  function handleRequestToolAccess(id: string, label: string) {
    setSelectedToolboxAction({
      kind: 'tool',
      id,
      label,
      message: `${label} 还没有加入当前工作台。我已先保存为本地开启请求；可在工具箱继续购买/加入。`,
    });
  }

  function handleSelectPackage(id: string, label: string) {
    setSelectedToolboxAction({
      kind: 'package',
      id,
      label,
      message: `${label} 已选中。宝盒会优先围绕这组工具整理首页入口。`,
    });
  }

  if (typeof document === 'undefined') return null;

  if (variant === 'screen') {
    return (
      <section className="portal-treasure-screen" aria-label="工具箱">
        <header className="portal-treasure-screen-head">
          <div>
            <h1>工具箱</h1>
            <p>发现适合你的工具，一键加入工作台</p>
          </div>
        </header>

        {selectedToolboxAction ? (
          <section className="portal-treasure-action-status" aria-live="polite">
            <span>{selectedToolboxAction.kind === 'package' ? '已选择工具包' : '已加入请求'}</span>
            <b>{selectedToolboxAction.label}</b>
            <small>{selectedToolboxAction.message}</small>
          </section>
        ) : null}

        <section className="portal-treasure-screen-section" aria-label="我的工具">
          <h2>我的工具</h2>
          <div className="portal-treasure-data-grid">
            {personalizationProfile.dataDepth.map((entry) => {
              const tool = entry.id === 'home_items' ? inventoryTool : entry.id === 'tasks' ? planTool : null;
              const isSelected = selectedToolboxAction?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`portal-treasure-data-card ${dataDepthToneClass(entry)}${tool ? ' is-owned' : ' is-requestable'}${isSelected ? ' is-selected' : ''}`}
                  onClick={tool ? () => onOpenTool(tool) : () => handleRequestToolAccess(entry.id, entry.name)}
                >
                  <span className="portal-treasure-data-icon" aria-hidden>
                    {entry.icon}
                  </span>
                  <span className="portal-treasure-data-copy">
                    <b>{entry.name}</b>
                    <small>{entry.value}</small>
                  </span>
                  <span className="portal-treasure-data-track" aria-hidden>
                    <i style={{ width: `${entry.progress}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="portal-treasure-screen-section" aria-label="可添加">
          <h2>可添加</h2>
          <div className="portal-treasure-screen-grid">
            {ADDABLE_TOOLS.map(([icon, id, label]) => (
              <button
                key={id}
                type="button"
                className={selectedToolboxAction?.id === id ? 'is-selected' : ''}
                onClick={() => handleAddTool(id, label)}
              >
                <span className="portal-treasure-screen-icon" aria-hidden>{icon}</span>
                <b>{label}</b>
                <small>{selectedToolboxAction?.id === id ? '已加入' : '＋ 添加'}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="portal-treasure-discovery-hero" aria-label="个性化推荐">
          <p>个性化推荐</p>
          <h2>礼物管家</h2>
          <span>根据你的重要日期和亲友偏好推荐。当前先保存为本地工作台请求，算法接入后会继续优化。</span>
          <button type="button" onClick={() => handleAddTool('gift-concierge', '礼物管家')}>
            {selectedToolboxAction?.id === 'gift-concierge' ? '已加入工作台' : '＋ 加入工作台'}
          </button>
        </section>

        <section className="portal-treasure-screen-section" aria-label="工具包">
          <h2>工具包</h2>
          <div className="portal-treasure-package-list">
            {TOOL_PACKAGES.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className={selectedToolboxAction?.id === pack.id ? 'is-selected' : ''}
                onClick={() => handleSelectPackage(pack.id, pack.label)}
              >
                <span aria-hidden>{pack.icon}</span>
                <b>{pack.label}</b>
                <small>{pack.description}</small>
              </button>
            ))}
          </div>
        </section>

        <p className="portal-treasure-screen-boundary">
          健康 / 金融 / 心理 / 自动化仍需确认后开放。
        </p>
      </section>
    );
  }

  return createPortal(
    <>
      <button
        type="button"
        className="portal-treasure-scrim"
        aria-label={t(locale, 'shellCloseTreasure')}
        onClick={onClose}
      />
      <section
        ref={popupRef}
        className={'portal-treasure-popup' + (placed ? ' portal-treasure-popup--ready' : '')}
        role="dialog"
        aria-label={t(locale, 'shellTreasurePopupAriaLabel')}
      >
        <header className="portal-treasure-popup-head">
          <div>
            <h2 className="portal-treasure-popup-title">
              {t(locale, 'shellTreasureTitleTemplate', { count: visibleTools.length })}
            </h2>
            <p className="portal-treasure-popup-meta">{statusSummaryLine}</p>
          </div>
          <button
            type="button"
            className="portal-treasure-popup-close"
            onClick={onClose}
            aria-label={t(locale, 'shellClose')}
          >
            x
          </button>
        </header>
        <section className="portal-treasure-pack" aria-label="工具包发现">
          <div className="portal-treasure-pack-head">
            <span>轻启动包</span>
            <small>今日可用</small>
          </div>
          <div className="portal-treasure-pack-actions">
            {planTool ? (
              <button type="button" onClick={() => onOpenTool(planTool)}>
                <span>待办</span>
                <small>粉碎任务</small>
              </button>
            ) : null}
            {inventoryTool ? (
              <button type="button" onClick={() => onOpenTool(inventoryTool)}>
                <span>物品库</span>
                <small>购买记忆</small>
              </button>
            ) : null}
          </div>
          <p>健康 / 金融 / 心理 / 自动化仍需确认后开放。</p>
        </section>
        <section className="portal-treasure-my-tools" aria-label="我的工具">
          <div className="portal-treasure-pack-head">
            <span>我的工具</span>
            <small>首发只开放安全入口</small>
          </div>
          <div className="portal-treasure-my-grid">
            {MY_TOOL_PREVIEWS.map((entry) => {
              const tool = entry.id === 'inventory' ? inventoryTool : null;
              const isSelected = selectedToolboxAction?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${tool ? 'is-ready' : 'is-requestable'}${isSelected ? ' is-selected' : ''}`}
                  onClick={tool ? () => onOpenTool(tool) : () => handleRequestToolAccess(entry.id, entry.label)}
                >
                  <span>{entry.label}</span>
                  <small>{entry.description} · {entry.status}</small>
                </button>
              );
            })}
          </div>
        </section>
        <ToolGrid
          tools={visibleTools}
          includeNotReady
          showStatus
          locale={locale}
          onOpenTool={onOpenTool}
        />
      </section>
    </>,
    document.body,
  );
}
