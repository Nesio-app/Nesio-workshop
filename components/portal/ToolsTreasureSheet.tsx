'use client';

import type { PortalTool } from '@/lib/portal/types';
import ToolGrid from './ToolGrid';

interface ToolsTreasurePopupProps {
  tools: PortalTool[];
  open: boolean;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

/** Floating toolbox overlay — not in document layout flow. */
export default function ToolsTreasurePopup({
  tools,
  open,
  onClose,
  onOpenTool,
}: ToolsTreasurePopupProps) {
  if (!open) return null;

  const handleOpen = (tool: PortalTool) => {
    onOpenTool(tool);
  };

  return (
    <>
      <button
        type="button"
        className="portal-treasure-scrim"
        aria-label="关闭工具箱"
        onClick={onClose}
      />
      <section className="portal-treasure-popup" role="dialog" aria-label="宝盒工具">
        <header className="portal-treasure-popup-head">
          <h2 className="portal-treasure-popup-title">宝盒</h2>
          <button type="button" className="portal-treasure-popup-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <ToolGrid tools={tools} excludeIds={['secretary']} onOpenTool={handleOpen} />
      </section>
    </>
  );
}
