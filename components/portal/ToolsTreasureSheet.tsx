'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PortalTool } from '@/lib/portal/types';
import ToolGrid from './ToolGrid';

interface ToolsTreasurePopupProps {
  tools: PortalTool[];
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

/** Floating toolbox overlay — not in document layout flow. */
export default function ToolsTreasurePopup({
  tools,
  open,
  anchorRef,
  onClose,
  onOpenTool,
}: ToolsTreasurePopupProps) {
  const popupRef = useRef<HTMLElement>(null);
  const [placed, setPlaced] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setPlaced(false);
      return;
    }

    function placePopup() {
      const anchor = anchorRef.current;
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
    if (anchorRef.current) ro?.observe(anchorRef.current);
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', placePopup, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', placePopup);
      window.removeEventListener('scroll', placePopup, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;

  const handleOpen = (tool: PortalTool) => {
    onOpenTool(tool);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button
        type="button"
        className="portal-treasure-scrim"
        aria-label="关闭工具箱"
        onClick={onClose}
      />
      <section
        ref={popupRef}
        className={'portal-treasure-popup' + (placed ? ' portal-treasure-popup--ready' : '')}
        role="dialog"
        aria-label="宝盒工具"
      >
        <header className="portal-treasure-popup-head">
          <h2 className="portal-treasure-popup-title">宝盒</h2>
          <button type="button" className="portal-treasure-popup-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <ToolGrid tools={tools} excludeIds={['secretary']} onOpenTool={handleOpen} />
      </section>
    </>,
    document.body,
  );
}
