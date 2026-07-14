'use client';

/**
 * useSheetDrag — 弹出卡顶部「横线」的拖动手势(图1)。
 * 设计定案:所有底部弹出卡去掉右上角 ✕,改用顶部横线:
 *   · 往上拉 → 全屏(expanded)
 *   · 往下滑 → 关闭(普通态直接关;全屏态下滑先回到普通态,再滑才关)
 * 背景点击关闭仍在,横线只是主手势 + 明确的可拖动感。
 */

import { useCallback, useRef, useState } from 'react';

const EXPAND_AT = 44;  // 上拉超过此值进入全屏
const CLOSE_AT = 96;   // 下滑超过此值关闭/收起

export interface SheetDrag {
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    role: 'button';
    tabIndex: number;
    'aria-label': string;
  };
  cardStyle: React.CSSProperties | undefined;
  expanded: boolean;
}

export function useSheetDrag(onClose: () => void, ariaLabel = '拖动:上拉全屏,下滑关闭'): SheetDrag {
  const [dragY, setDragY] = useState(0);      // 仅记录向下位移(视觉跟手)
  const [expanded, setExpanded] = useState(false);
  const startY = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startY.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (dy < 0) {
      if (dy < -EXPAND_AT) setExpanded(true);  // 上拉进全屏
      setDragY(0);
    } else {
      setDragY(dy);                            // 下滑跟手
    }
  }, []);

  const end = useCallback((e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    startY.current = null;
    setDragY(0);
    if (dy > CLOSE_AT) {
      if (expanded) setExpanded(false);        // 全屏态:先收回普通
      else onClose();                          // 普通态:关闭
    }
  }, [expanded, onClose]);

  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end,
    role: 'button' as const, tabIndex: 0, 'aria-label': ariaLabel,
  };
  const cardStyle: React.CSSProperties | undefined = dragY > 0
    ? { transform: `translateY(${dragY}px)`, transition: 'none' }
    : undefined;

  return { handleProps, cardStyle, expanded };
}
