'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import CommandBar from './CommandBar';
import DashboardHome from './DashboardHome';
import ToolSidebar from './ToolSidebar';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { configUrl, withBase } from '@/lib/portal/paths';
import type { PortalConfig } from '@/lib/portal/types';

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);
  }, []);

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

      const key = event.key.toLowerCase();
      const tool = config.tools.find((item) => item.hotkey === key && item.ready);
      if (tool) {
        event.preventDefault();
        const href = withBase(tool.url);
        if (href.startsWith('http')) {
          window.open(href, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = href;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config.tools]);

  return (
    <div className="portal-root portal-root--home">
      <div className="portal-grain" aria-hidden />

      <div className="portal-shell">
        <ToolSidebar tools={config.tools} />

        <div className="portal-main">
          <div className="portal-main-top">
            <button
              type="button"
              className="portal-search-btn"
              onClick={() => setCommandOpen(true)}
              aria-label="搜索或命令"
            >
              <span className="portal-search-icon" aria-hidden>
                ⌕
              </span>
              <span>搜索</span>
            </button>
          </div>

          <DashboardHome config={config} />

          <footer className="portal-footer portal-footer--minimal">
            <Link href="/portfolio">作品集</Link>
          </footer>
        </div>
      </div>

      <CommandBar
        tools={config.tools}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  );
}
