'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortalTool } from '@/lib/portal/types';

interface CommandBarProps {
  tools: PortalTool[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTool: (tool: PortalTool) => void;
}

export default function CommandBar({ tools, open, onOpenChange, onOpenTool }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;

    return tools.filter((tool) => {
      const haystack = [
        tool.name,
        tool.nameEn,
        tool.description,
        tool.command,
        tool.hotkey,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q) || tool.command.toLowerCase().startsWith(q);
    });
  }, [query, tools]);

  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const navigate = (tool: PortalTool) => {
    if (!tool.ready) return;
    onOpenTool(tool);
  };

  if (!open) return null;

  return (
    <div
      className="portal-command-overlay"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="portal-command-panel"
        role="dialog"
        aria-label="全局命令"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="portal-command-input-wrap">
          <span className="portal-command-prefix">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具，或输入 /plan、/soul …"
            className="portal-command-input"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                navigate(results[0]);
                onOpenChange(false);
              }
            }}
          />
          <kbd className="portal-command-kbd">esc</kbd>
        </div>

        <ul className="portal-command-list">
          {results.length === 0 ? (
            <li className="portal-command-empty">没有匹配的入口</li>
          ) : (
            results.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  className="portal-command-item"
                  data-ready={tool.ready ? 'true' : 'false'}
                  onClick={() => {
                    navigate(tool);
                    onOpenChange(false);
                  }}
                >
                  <span className="portal-command-icon">{tool.icon}</span>
                  <span className="portal-command-copy">
                    <span className="portal-command-name">{tool.name}</span>
                    <span className="portal-command-desc">{tool.description}</span>
                  </span>
                  <span className="portal-command-meta">
                    <span>{tool.command}</span>
                    <kbd>{tool.hotkey.toUpperCase()}</kbd>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
