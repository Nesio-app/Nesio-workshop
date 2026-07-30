'use client';

/**
 * components/portal/StorageWarningCard.tsx
 *
 * 存储空间不足警告卡片。
 * 当 localStorage > 80% 时展示，提供清理和了解更多的选项。
 *
 * 设计原则（CLAUDE.md）：
 * - warm-coach 文案：「还有一件事可以轻轻处理」而非焦虑式警告
 * - 每个提示都提供出口：「跳过 / 稍后 / 清理」
 * - 使用 CSS 变量而非硬编码色值
 */

import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconBox } from './icons';
import { getStorageMetrics, formatStorageMetrics, formatBytes } from '@/lib/idb/storage-monitor';
import { cleanupLRU, cleanupExpiredCache } from '@/lib/idb/cleanup';
import type { StorageMetrics } from '@/lib/idb/storage-monitor';
import '@/styles/storage-warning-card.css';

interface StorageWarningCardProps {
  onClose?: () => void;
  onCleanupStart?: () => void;
  onCleanupComplete?: (deletedCount: number) => void;
}

export default function StorageWarningCard({
  onClose,
  onCleanupStart,
  onCleanupComplete,
}: StorageWarningCardProps) {
  const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [dismissKey, setDismissKey] = useState<string | null>(null);

  // 周期性检查存储使用
  useEffect(() => {
    const checkStorage = async () => {
      try {
        const current = await getStorageMetrics();
        setMetrics(current);

        // 检查是否应该显示
        const shouldShow = current.localStorage > 80 || current.isDanger;
        if (shouldShow) {
          // 检查是否已今天内忽略过
          const dismissedToday = localStorage.getItem('storage-warning-dismissed-at');
          const today = new Date().toDateString();
          if (dismissedToday === today) {
            setIsVisible(false);
          } else {
            setIsVisible(true);
          }
        } else {
          setIsVisible(false);
        }
      } catch (error) {
        console.warn('[StorageWarningCard] Error checking storage:', error);
      }
    };

    // 初始检查
    checkStorage();

    // 监听警告事件
    const handleWarning = (event: Event) => {
      const customEvent = event as CustomEvent;
      setMetrics(customEvent.detail);
      setIsVisible(true);
    };

    const handleDanger = (event: Event) => {
      const customEvent = event as CustomEvent;
      setMetrics(customEvent.detail);
      setIsVisible(true);
    };

    window.addEventListener('nesio-storage-warning', handleWarning);
    window.addEventListener('nesio-storage-danger', handleDanger);

    // 定期检查（每 5 分钟）
    const interval = setInterval(checkStorage, 5 * 60 * 1000);

    return () => {
      window.removeEventListener('nesio-storage-warning', handleWarning);
      window.removeEventListener('nesio-storage-danger', handleDanger);
      clearInterval(interval);
    };
  }, []);

  const handleCleanup = async () => {
    setIsCleaning(true);
    setCleanupMessage('整理中...');
    onCleanupStart?.();

    try {
      let totalDeleted = 0;

      // 1. 清理过期缓存
      try {
        const deletedTTL = await cleanupExpiredCache();
        totalDeleted += deletedTTL;
        setCleanupMessage(`已清理 ${totalDeleted} 项...`);
      } catch (error) {
        console.warn('[StorageWarningCard] TTL cleanup failed:', error);
      }

      // 2. LRU 清理
      try {
        const deletedLRU = await cleanupLRU();
        totalDeleted += deletedLRU;
        setCleanupMessage(`已清理 ${totalDeleted} 项...`);
      } catch (error) {
        console.warn('[StorageWarningCard] LRU cleanup failed:', error);
      }

      // 清理完成后重新检查指标
      const updated = await getStorageMetrics();
      setMetrics(updated);

      setCleanupMessage(`完成！已清理 ${totalDeleted} 项`);
      onCleanupComplete?.(totalDeleted);

      // 2 秒后自动关闭成功提示
      setTimeout(() => {
        setCleanupMessage(null);
        if (!updated.isDanger && updated.localStorage < 80) {
          handleDismiss();
        }
      }, 2000);
    } catch (error) {
      console.error('[StorageWarningCard] Cleanup failed:', error);
      setCleanupMessage(`清理失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setTimeout(() => setCleanupMessage(null), 3000);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleDismiss = () => {
    const today = new Date().toDateString();
    localStorage.setItem('storage-warning-dismissed-at', today);
    setIsVisible(false);
    onClose?.();
  };

  const handleLearnMore = () => {
    // 打开详细信息
    if (metrics) {
      const report = [
        `localStorage: ${metrics.localStorage}%`,
        `IDB: ${metrics.idb} MB`,
        `最大的项: ${metrics.largestLocalStorageKeys.map((k) => `${k.key} (${formatBytes(k.bytes)})`).join(', ')}`,
      ].join('\n');
      console.log('[StorageWarningCard]', report);
    }
  };

  if (!isVisible || !metrics) {
    return null;
  }

  const isDanger = metrics.isDanger;
  const severity = isDanger ? 'danger' : 'warning';

  return (
    <div className={`storage-warning-card storage-warning-${severity}`} role="alert">
      <div className="storage-warning-content">
        <div className="storage-warning-icon">
          {/* 渲染层不写原生 emoji(仓库红线 test:ui-consistency)—— 走 icons.tsx 的描边图标。 */}
          {isDanger ? <IconAlertTriangle size={20} /> : <IconBox size={20} />}
        </div>
        <div className="storage-warning-text">
          <h3 className="storage-warning-title">
            {isDanger ? '存储快要满了' : '本地存储快满了'}
          </h3>
          <p className="storage-warning-description">
            {isDanger
              ? `已使用 ${metrics.localStorage}% 的本地空间。我们正在为你整理，这样可以保存更多内容。`
              : `已使用 ${metrics.localStorage}% 的本地空间。我们可以清理一些缓存，为你腾出空间。`}
          </p>
          {cleanupMessage && (
            <p className="storage-warning-progress">{cleanupMessage}</p>
          )}
          {metrics.largestLocalStorageKeys.length > 0 && !cleanupMessage && (
            <div className="storage-warning-details">
              <details>
                <summary>最大的项目</summary>
                <ul>
                  {metrics.largestLocalStorageKeys.slice(0, 3).map((item) => (
                    <li key={item.key}>
                      <code>{item.key}</code>: {formatBytes(item.bytes)}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      </div>

      <div className="storage-warning-actions">
        {!cleanupMessage && (
          <>
            <button
              type="button"
              className="storage-warning-btn storage-warning-cleanup"
              onClick={handleCleanup}
              disabled={isCleaning}
              aria-label="清理本地存储"
            >
              {isCleaning ? '整理中...' : '清理缓存'}
            </button>
            <button
              type="button"
              className="storage-warning-btn storage-warning-secondary"
              onClick={handleLearnMore}
              disabled={isCleaning}
              aria-label="了解更多信息"
            >
              了解更多
            </button>
            <button
              type="button"
              className="storage-warning-btn storage-warning-dismiss"
              onClick={handleDismiss}
              disabled={isCleaning}
              aria-label="今天不再提醒"
            >
              今天不再提醒
            </button>
          </>
        )}
        {cleanupMessage && (
          <button
            type="button"
            className="storage-warning-btn storage-warning-close"
            onClick={handleDismiss}
            aria-label="关闭"
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
}
