'use client';

import { useEffect, useState } from 'react';
import DashboardHome from './DashboardHome';
import NotePanelEnhanced from './NotePanelEnhanced';
import PortalBottomNav from './PortalBottomNav';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { openToolHref } from '@/lib/portal/open-tool';
import { configUrl } from '@/lib/portal/paths';
import type { PortalConfig, PortalTool } from '@/lib/portal/types';

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [noteOpen, setNoteOpen] = useState(false);
  const [treasureOpen, setTreasureOpen] = useState(false);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteParam = params.get('note');
    if (noteParam === '1' || noteParam === 'open') {
      setNoteOpen(true);
      params.delete('note');
      const qs = params.toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
  }, []);

  const openTool = (tool: PortalTool) => {
    if (!tool.ready) return;
    window.location.assign(openToolHref(tool));
  };

  const openTodo = () => {
    const tool = config.tools.find((item) => item.id === 'plan' && item.ready);
    if (tool) openTool(tool);
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
              treasureOpen={treasureOpen}
              onTreasureOpenChange={setTreasureOpen}
              onOpenNote={() => setNoteOpen(true)}
              onOpenTool={openTool}
            />
          </div>
        </div>
      </div>

      {!noteOpen ? (
        <div className="portal-chrome">
          <PortalBottomNav
            noteOpen={noteOpen}
            treasureOpen={treasureOpen}
            onHome={() => setTreasureOpen((open) => !open)}
            onOpenNote={() => setNoteOpen(true)}
            onOpenTodo={openTodo}
          />
        </div>
      ) : null}

      <NotePanelEnhanced open={noteOpen} onOpenChange={setNoteOpen} />
    </>
  );
}
