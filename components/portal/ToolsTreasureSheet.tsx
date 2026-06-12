'use client';

import type { PortalTool } from '@/lib/portal/types';
import ToolGrid from './ToolGrid';

interface ToolsTreasureInlineProps {
  tools: PortalTool[];
  open: boolean;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

/** Inline toolbox between widgets and calendar; scrim dismisses on outside tap. */
export default function ToolsTreasureInline({
  tools,
  open,
  onClose,
  onOpenTool,
}: ToolsTreasureInlineProps) {
  if (!open) return null;

  const handleOpen = (tool: PortalTool) => {
    onClose();
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
      <section className="portal-treasure-inline" role="region" aria-label="宝盒工具">
        <header className="portal-treasure-inline-head">
          <h2 className="portal-treasure-inline-title">宝盒</h2>
        </header>
        <ToolGrid tools={tools} excludeIds={['secretary']} onOpenTool={handleOpen} />
      </section>
    </>
  );
}
