'use client';

/**
 * InfoTip — 标题后的「?」说明图标(批次 17)。
 * 用户反馈:长功能说明文字散在界面上太占地方——收进 ? 里,点开即看。
 * 全站凡是"解释这个功能怎么回事"的长文案一律用它,不再平铺。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconHelpCircle } from './icons';

export function InfoTip({ text, size = 14 }: { text: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0); // 出右边界时向左推回的位移(px)
  const rootRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  // 点击组件外部收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  // 视口夹取:? 图标可能在标题任意位置,固定 left:0 展开会顶出右边界(用户实测:例行提醒的说明字出屏)。
  // 打开后量一次 —— 右溢出就整体左移推回,左侧再夹回 8px 安全边,任何宿主位置都不出屏。
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const pop = popRef.current;
    if (!pop) return;
    setShift(0);
    const measure = () => {
      const r = pop.getBoundingClientRect();
      const margin = 8;
      let next = 0;
      const overRight = r.right - (window.innerWidth - margin);
      if (overRight > 0) next = -overRight;
      if (r.left + next < margin) next = margin - r.left;
      setShift(next);
    };
    // 量测在下一帧(等布局稳定),避免首帧 0 宽度误判
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [open, text]);

  return (
    <span className="nesio-infotip" ref={rootRef}>
      <button
        type="button"
        className="nesio-infotip-btn"
        aria-expanded={open}
        aria-label={text}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <IconHelpCircle size={size} />
      </button>
      {open && (
        <span
          ref={popRef}
          role="tooltip"
          className="nesio-infotip-pop"
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        >
          {text}
        </span>
      )}
    </span>
  );
}
