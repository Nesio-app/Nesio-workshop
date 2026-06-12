'use client';

import { useEffect } from 'react';
import type { PortalTool } from '@/lib/portal/types';
import ToolGrid from './ToolGrid';

interface ToolsTreasureSheetProps {
  tools: PortalTool[];
  open: boolean;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

export default function ToolsTreasureSheet({
  tools,
  open,
  onClose,
  onOpenTool,
}: ToolsTreasureSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleOpen = (tool: PortalTool) => {
    onClose();
    onOpenTool(tool);
  };

  return (
    <div className="portal-treasure-sheet" role="presentation">
      <button
        type="button"
        className="portal-treasure-sheet-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="portal-treasure-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label="宝盒工具"
      >
        <header className="portal-treasure-sheet-head">
          <h2 className="portal-treasure-sheet-title">宝盒</h2>
          <button
            type="button"
            className="portal-treasure-sheet-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <ToolGrid
          tools={tools}
          excludeIds={['secretary']}
          onOpenTool={handleOpen}
        />
      </div>
    </div>
  );
}
