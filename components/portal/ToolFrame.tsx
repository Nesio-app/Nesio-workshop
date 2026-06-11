'use client';

import type { PortalTool } from '@/lib/portal/types';
import { toolOpenUrl } from '@/lib/portal/open-tool';

interface ToolFrameProps {
  tool: PortalTool;
  onClose: () => void;
}

export default function ToolFrame({ tool, onClose }: ToolFrameProps) {
  const src = toolOpenUrl(tool);

  return (
    <div className="portal-frame">
      <header className="portal-frame-head">
        <button type="button" className="portal-frame-back" onClick={onClose}>
          ‹ 返回
        </button>
        <h1 className="portal-frame-title">{tool.name}</h1>
        <span className="portal-frame-spacer" aria-hidden />
      </header>
      <iframe
        className="portal-frame-embed"
        src={src}
        title={tool.name}
        allow="clipboard-read; clipboard-write; microphone; camera"
      />
    </div>
  );
}
