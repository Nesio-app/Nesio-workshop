'use client';

import { useEffect, useState } from 'react';
import DashboardHome from './DashboardHome';
import NotePanelEnhanced from './NotePanelEnhanced';
import PortalBottomNav from './PortalBottomNav';
import PortalSecretaryFab from './PortalSecretaryFab';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { openToolHref } from '@/lib/portal/open-tool';
import { configUrl } from '@/lib/portal/paths';
import type { PortalConfig, PortalTool } from '@/lib/portal/types';

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [noteOpen, setNoteOpen] = useState(false);

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
    window.location.assign(openToolHref(tool));
  };

  const openTodo = () => {
    const plan = config.tools.find((t) => t.id === 'plan' && t.ready);
    if (plan) openTool(plan);
  };

  const scrollHome = () => {
    if (window.location.pathname !== '/') {
      window.location.assign('/');
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNoteOpen(true);
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

      const key = event.key.toLowerCase();
      const tool = config.tools.find((item) => item.hotkey === key && item.ready);
      if (tool) {
        event.preventDefault();
        openTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config.tools]);

  return (
    <>
      <div className="portal-root portal-root--home">
        <div className="portal-grain" aria-hidden />

        <div className="portal-shell portal-shell--single">
          <div className="portal-main">
            <DashboardHome
              config={config}
              noteOpen={noteOpen}
              onOpenNote={() => setNoteOpen(true)}
              onOpenTool={openTool}
            />
          </div>
        </div>
      </div>

      <div className="portal-chrome" aria-hidden={false}>
        <PortalSecretaryFab />
        <PortalBottomNav
          noteOpen={noteOpen}
          onHome={scrollHome}
          onOpenNote={() => setNoteOpen(true)}
          onOpenTodo={openTodo}
        />
      </div>

      <NotePanelEnhanced open={noteOpen} onOpenChange={setNoteOpen} />
    </>
  );
}
