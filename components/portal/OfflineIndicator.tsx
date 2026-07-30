/**
 * Phase 2 离线指示器 —— 用户明确可见的离线状态和队列监控
 *
 * 显示信息：
 * - 网络状态（在线/离线）
 * - 待同步项数量
 * - 最老项的年龄
 * - "现在同步"按钮（手动触发重试）
 *
 * 位置：Portal 顶部 banner 或侧边栏
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  watchQueueChanges,
  triggerAutoRetry,
  getCurrentQueueStats,
  cancelQueueItem,
  type QueueStats,
} from '@/lib/portal/offline-queue-watcher';
import { logDropped } from '@/lib/portal/storage-health';

export interface OfflineIndicatorProps {
  /**
   * 显示位置：'banner'（顶部横幅）| 'sidebar'（侧边栏小组件）| 'corner'（右下角浮球）
   */
  placement?: 'banner' | 'sidebar' | 'corner';
  /**
   * 是否自动初始化监控
   */
  autoInit?: boolean;
  /**
   * 队列改变时的回调
   */
  onQueueChange?: (stats: QueueStats) => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  placement = 'banner',
  autoInit = true,
  onQueueChange,
}) => {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    // 初始化统计
    const initialStats = getCurrentQueueStats();
    if (initialStats) {
      setStats(initialStats);
    }

    // 订阅队列变化
    const unsubscribe = watchQueueChanges((newStats) => {
      setStats(newStats);
      onQueueChange?.(newStats);
    });

    return () => {
      unsubscribe();
    };
  }, [onQueueChange]);

  // 如果队列为空且在线，不显示任何东西
  if (!stats || (stats.count === 0 && stats.isOnline)) {
    return null;
  }

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryProgress({ current: 0, total: stats?.count || 0 });

    try {
      const successCount = await triggerAutoRetry((progress) => {
        setRetryProgress(progress);
      });

      logDropped('offline-indicator:retry-complete', {
        successCount,
        total: stats?.count,
      });

      // 1 秒后清除进度条
      setTimeout(() => {
        setIsRetrying(false);
        setRetryProgress(null);
      }, 1000);
    } catch (error) {
      logDropped('offline-indicator:retry-failed', error);
      setIsRetrying(false);
      setRetryProgress(null);
    }
  };

  const oldestDate =
    stats && stats.oldestCreatedAt
      ? new Date(stats.oldestCreatedAt).toLocaleString()
      : null;

  if (placement === 'banner') {
    return (
      <OfflineBanner
        stats={stats}
        isRetrying={isRetrying}
        retryProgress={retryProgress}
        oldestDate={oldestDate}
        onRetry={handleRetry}
      />
    );
  }

  if (placement === 'sidebar') {
    return (
      <OfflineSidebarWidget
        stats={stats}
        isRetrying={isRetrying}
        onRetry={handleRetry}
      />
    );
  }

  if (placement === 'corner') {
    return (
      <OfflineCornerBubble
        stats={stats}
        isRetrying={isRetrying}
        onRetry={handleRetry}
      />
    );
  }

  return null;
};

/**
 * 顶部 Banner 样式
 */
const OfflineBanner: React.FC<{
  stats: QueueStats;
  isRetrying: boolean;
  retryProgress: { current: number; total: number } | null;
  oldestDate: string | null;
  onRetry: () => void;
}> = ({ stats, isRetrying, retryProgress, oldestDate, onRetry }) => {
  const statusText = stats.isOnline
    ? `待同步 ${stats.count} 项`
    : '离线模式 · 待同步' + (stats.count > 0 ? ` ${stats.count} 项` : '');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: stats.isOnline
          ? 'var(--status-calm-soft)'
          : 'var(--status-risk-soft)',
        borderBottom: `1px solid ${
          stats.isOnline ? 'var(--status-calm)' : 'var(--status-risk)'
        }`,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        color: 'var(--portal-ink)',
        gap: 'var(--space-2)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 'var(--weight-medium)' }}>{statusText}</div>
        {oldestDate && stats.count > 0 && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--portal-muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            最早未同步于 {oldestDate}
          </div>
        )}
      </div>

      {retryProgress && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--portal-muted)',
            minWidth: '60px',
            textAlign: 'right',
          }}
        >
          {retryProgress.current} / {retryProgress.total}
        </div>
      )}

      {stats.count > 0 && !isRetrying && (
        <button
          onClick={onRetry}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'var(--portal-accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          现在同步
        </button>
      )}

      {isRetrying && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            color: 'var(--portal-accent)',
            fontWeight: 'var(--weight-medium)',
          }}
        >
          同步中...
        </div>
      )}
    </div>
  );
};

/**
 * 侧边栏小组件样式
 */
const OfflineSidebarWidget: React.FC<{
  stats: QueueStats;
  isRetrying: boolean;
  onRetry: () => void;
}> = ({ stats, isRetrying, onRetry }) => {
  return (
    <div
      style={{
        padding: 'var(--space-3)',
        backgroundColor: stats.isOnline
          ? 'var(--status-calm-soft)'
          : 'var(--status-risk-soft)',
        borderRadius: 'var(--radius-md)',
        borderLeft: `4px solid ${
          stats.isOnline ? 'var(--status-calm)' : 'var(--status-risk)'
        }`,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-2)' }}>
        {stats.isOnline ? '网络已恢复' : '离线模式'}
      </div>
      {stats.count > 0 && (
        <>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--portal-muted)',
              marginBottom: 'var(--space-2)',
            }}
          >
            {stats.count} 项操作待同步
          </div>
          <button
            onClick={onRetry}
            disabled={isRetrying}
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              backgroundColor: isRetrying
                ? 'var(--status-calm)'
                : 'var(--portal-accent)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              cursor: isRetrying ? 'not-allowed' : 'pointer',
              opacity: isRetrying ? 0.6 : 1,
            }}
          >
            {isRetrying ? '同步中...' : '立即同步'}
          </button>
        </>
      )}
    </div>
  );
};

/**
 * 右下角浮球样式
 */
const OfflineCornerBubble: React.FC<{
  stats: QueueStats;
  isRetrying: boolean;
  onRetry: () => void;
}> = ({ stats, isRetrying, onRetry }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-4)',
        right: 'var(--space-4)',
        zIndex: 1000,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          backgroundColor: stats.isOnline
            ? 'var(--status-calm)'
            : 'var(--status-risk)',
          color: 'white',
          border: 'none',
          fontWeight: 'var(--weight-bold)',
          fontSize: '24px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {stats.count}
      </button>

      {expanded && stats.count > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '70px',
            right: 0,
            backgroundColor: 'white',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            minWidth: '200px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--portal-ink)',
            zIndex: 1001,
          }}
        >
          <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-2)' }}>
            {stats.count} 项待同步
          </div>
          <button
            onClick={onRetry}
            disabled={isRetrying}
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              backgroundColor: 'var(--portal-accent)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--weight-medium)',
              cursor: isRetrying ? 'not-allowed' : 'pointer',
              opacity: isRetrying ? 0.6 : 1,
            }}
          >
            {isRetrying ? '同步中...' : '同步'}
          </button>
        </div>
      )}
    </div>
  );
};
