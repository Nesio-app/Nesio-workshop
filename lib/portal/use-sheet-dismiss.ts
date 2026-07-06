'use client';

/**
 * useSheetDismiss —— sheet/overlay 的共享无障碍原语。
 *
 * 修「一批 sheet 缺 Escape/焦点管理」:每个全屏 sheet 各自实现、大多没挂 Escape 与
 * 焦点回收,键盘/读屏用户只能鼠标点 ✕。这个 hook 统一挂:
 *   - Escape 关闭
 *   - 打开时锁背景滚动
 *   - 关闭后把焦点还给打开它的元素
 *
 * 用法:在 sheet 组件里 `useSheetDismiss(open, onClose);`(open=false 时自动不生效)。
 */
import { useEffect, useRef } from 'react';

export function useSheetDismiss(open: boolean, onClose: () => void): void {
  // 用 ref 存 onClose,避免调用方每次渲染传新函数导致 effect 反复解绑重绑。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // 关闭后把焦点还回去(元素还在 DOM 里才还)。
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);
}
