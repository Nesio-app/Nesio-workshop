'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import CommandBar from './CommandBar';
import ToolCard from './ToolCard';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { configUrl, withBase } from '@/lib/portal/paths';
import type { PortalConfig, PortalTool, ZoneId } from '@/lib/portal/types';

const ZONE_ORDER: ZoneId[] = ['kinetic', 'reflective', 'manifest'];

function dayProgress(): number {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function pickQuote(quotes: string[]): string {
  if (quotes.length === 0) return '理智在场，情感柔软。';
  const index = new Date().getDate() % quotes.length;
  return quotes[index];
}

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [commandOpen, setCommandOpen] = useState(false);
  const [progress, setProgress] = useState(dayProgress());

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setProgress(dayProgress()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

  const toolsByZone = useMemo(() => {
    const grouped: Record<ZoneId, PortalTool[]> = {
      kinetic: [],
      reflective: [],
      manifest: [],
    };
    for (const tool of config.tools) {
      grouped[tool.zone].push(tool);
    }
    for (const zone of ZONE_ORDER) {
      grouped[zone].sort((a, b) => Number(b.featured) - Number(a.featured));
    }
    return grouped;
  }, [config.tools]);

  const quote = pickQuote(config.meta.energyQuotes);
  const today = formatDate(new Date());

  return (
    <div className="portal-root">
      <div className="portal-grain" aria-hidden />

      <header className="portal-header">
        <div className="portal-header-top">
          <div>
            <p className="portal-eyebrow">{config.meta.subtitle}</p>
            <h1 className="portal-title">{config.meta.title}</h1>
          </div>
          <div className="portal-header-actions">
            <a href={withBase('/secretary/')} className="portal-secretary-link">
              <span>AI 秘书</span>
              <kbd>A</kbd>
            </a>
            <button
              type="button"
              className="portal-command-trigger"
              onClick={() => setCommandOpen(true)}
            >
              <span>搜索或命令</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </div>

        <div className="portal-energy">
          <p className="portal-quote">{quote}</p>
          <div className="portal-day">
            <time dateTime={new Date().toISOString().slice(0, 10)}>{today}</time>
            <div className="portal-progress" aria-hidden>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="portal-matrix">
        {ZONE_ORDER.map((zoneId) => {
          const zone = config.zones[zoneId];
          const tools = toolsByZone[zoneId];
          return (
            <section
              key={zoneId}
              className={`portal-column portal-column--${zone.tone}`}
              aria-label={zone.title}
            >
              <header className="portal-column-head">
                <h2>{zone.title}</h2>
                <p>{zone.subtitle}</p>
              </header>
              <div className="portal-column-grid">
                {tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} zone={zone} />
                ))}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="portal-footer">
        <span>单键直达 · 悬停即亮</span>
        <Link href="/portfolio">作品集</Link>
      </footer>

      <CommandBar
        tools={config.tools}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  );
}
