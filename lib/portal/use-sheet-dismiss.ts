'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * 共享的 sheet/modal 无障碍原语 —— 一处解决四件此前每个手搓 overlay 都缺的事:
 *   1. Escape 关闭(键盘/AT 用户能打开却关不掉的根因);
 *   2. body 滚动锁(sheet 打开时背景不跟着滚);
 *   3. 归还焦点(关闭后焦点回到打开它的元素);
 *   4. 焦点陷阱(传入 containerRef 时,Tab 循环留在 sheet 内)。
 *
 * 用法(放在组件顶层,无条件调用):
 *   useSheetDismiss(onClose);                       // Escape + 滚动锁 + 归还焦点
 *   useSheetDismiss(onClose, { containerRef });     // 再加焦点陷阱
 */
export function useSheetDismiss(
  onClose: () => void,
  opts?: { enabled?: boolean; containerRef?: RefObject<HTMLElement | null> },
): void {
  const enabled = opts?.enabled ?? true;
  const containerRef = opts?.containerRef;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const root = containerRef?.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && containerRef?.current) {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch { /* element gone */ }
      }
    };
  }, [enabled, containerRef]);
}
