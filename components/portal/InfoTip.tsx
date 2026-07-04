'use client';

/**
 * InfoTip — 标题后的「?」说明图标(批次 17)。
 * 用户反馈:长功能说明文字散在界面上太占地方——收进 ? 里,点开即看。
 * 全站凡是"解释这个功能怎么回事"的长文案一律用它,不再平铺。
 */

import { useEffect, useRef, useState } from 'react';
import { IconHelpCircle } from './icons';

export function InfoTip({ text, size = 14 }: { text: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 点击组件外部收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

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
      {open && <span role="tooltip" className="nesio-infotip-pop">{text}</span>}
    </span>
  );
}
