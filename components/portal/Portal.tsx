'use client';

import { useEffect, useState } from 'react';
import CommandBar from './CommandBar';
import DashboardHome from './DashboardHome';
import ToolFrame from './ToolFrame';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { configUrl } from '@/lib/portal/paths';
import type { PortalConfig, PortalTool } from '@/lib/portal/types';

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<PortalTool | null>(null);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);
  }, []);

  const openTool = (tool: PortalTool) => {
    if (!tool.ready) return;
    setActiveTool(tool);
    setCommandOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'Escape' && activeTool) {
        setActiveTool(null);
        return;
      }

      const key = event.key.toLowerCase();
      const tool = config.tools.find((item) => item.hotkey === key && item.ready);
      if (tool) {
        event.preventDefault();
        openTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config.tools, activeTool]);

  if (activeTool) {
    return (
      <div className="portal-root portal-root--tool">
        <div className="portal-grain" aria-hidden />
        <ToolFrame tool={activeTool} onClose={() => setActiveTool(null)} />
        <CommandBar
          tools={config.tools}
          open={commandOpen}
          onOpenChange={setCommandOpen}
          onOpenTool={openTool}
        />
      </div>
    );
  }

  return (
    <div className="portal-root portal-root--home">
      <div className="portal-grain" aria-hidden />

      <div className="portal-shell portal-shell--single">
        <div className="portal-main">
          <DashboardHome
            config={config}
            onOpenSearch={() => setCommandOpen(true)}
            onOpenTool={openTool}
          />
        </div>
      </div>

      <CommandBar
        tools={config.tools}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenTool={openTool}
      />
    </div>
  );
}
