'use client';

/**
 * ConnectorsHub — settings sheet for connecting external data sources.
 * Gmail, Calendar, Apple Health, and future connectors.
 */

import { useEffect, useState } from 'react';

interface ConnectorsHubProps { open: boolean; onClose: () => void; }

interface ConnectorStatus {
  id: string;
  name: string;
  icon: string;
  iconBg: string;
  description: string;
  connected: boolean;
  lastSync?: string;
  setupUrl?: string;
  comingSoon?: boolean;
}

const CONNECTORS_KEY = 'nesio-connectors-v1';

function loadConnectors(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CONNECTORS_KEY) || '{}'); }
  catch { return {}; }
}

async function startGmailOAuth(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        redirectTo: window.location.origin + '/?connector=gmail',
        scope: 'email profile https://www.googleapis.com/auth/gmail.readonly',
      }),
    });
    const data = await res.json() as { ok?: boolean; url?: string };
    return data.ok && data.url ? data.url : null;
  } catch { return null; }
}

async function startCalendarOAuth(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        redirectTo: window.location.origin + '/?connector=calendar',
      }),
    });
    const data = await res.json() as { ok?: boolean; url?: string };
    return data.ok && data.url ? data.url : null;
  } catch { return null; }
}

export default function ConnectorsHub({ open, onClose }: ConnectorsHubProps) {
  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const saved = loadConnectors();

    setStatuses([
      {
        id: 'calendar',
        name: 'Google Calendar',
        icon: '📅',
        iconBg: '#dbeafe',
        description: '读取日程，生成会议提醒和准备 Brief',
        connected: saved['calendar'] ?? false,
        lastSync: saved['calendar'] ? '刚刚' : undefined,
      },
      {
        id: 'gmail',
        name: 'Gmail',
        icon: '📧',
        iconBg: '#fce7f3',
        description: '从邮件自动抽取人物、日期、承诺，存入 Memory',
        connected: saved['gmail'] ?? false,
        lastSync: saved['gmail'] ? '刚刚' : undefined,
      },
      {
        id: 'weather',
        name: '地理位置 · 天气',
        icon: '🌤',
        iconBg: '#fef3c7',
        description: '基于实时天气生成外出提醒和健康建议',
        connected: saved['weather'] ?? false,
      },
      {
        id: 'health',
        name: 'Apple Health',
        icon: '🩷',
        iconBg: '#fce7f3',
        description: '睡眠、步数、心率信号进入 Reasoning Engine',
        connected: false,
        comingSoon: true,
      },
      {
        id: 'tesla',
        name: 'Tesla',
        icon: '🚗',
        iconBg: '#d1fae5',
        description: '电量、行程信号，自动提醒充电',
        connected: false,
        comingSoon: true,
      },
    ]);
  }, [open]);

  async function handleConnect(connector: ConnectorStatus) {
    if (connector.comingSoon) return;
    setLoading(connector.id);

    if (connector.id === 'gmail') {
      const url = await startGmailOAuth();
      if (url) { window.location.href = url; return; }
      // Fallback: mark as connected locally
    } else if (connector.id === 'calendar') {
      const url = await startCalendarOAuth();
      if (url) { window.location.href = url; return; }
    } else if (connector.id === 'weather') {
      // Request geolocation permission
      navigator.geolocation.getCurrentPosition(
        () => {
          const saved = loadConnectors();
          saved['weather'] = true;
          localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved));
          setStatuses((prev) => prev.map((s) => s.id === 'weather' ? { ...s, connected: true } : s));
        },
        () => alert('位置权限被拒绝，请在浏览器设置中开启。'),
      );
      setLoading(null);
      return;
    }

    // Simulate success for demo
    setTimeout(() => {
      const saved = loadConnectors();
      saved[connector.id] = true;
      localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved));
      setStatuses((prev) => prev.map((s) => s.id === connector.id ? { ...s, connected: true, lastSync: '刚刚' } : s));
      setLoading(null);
    }, 1200);
  }

  function handleDisconnect(id: string) {
    const saved = loadConnectors();
    delete saved[id];
    localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved));
    setStatuses((prev) => prev.map((s) => s.id === id ? { ...s, connected: false, lastSync: undefined } : s));
  }

  if (!open) return null;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="数据接入">
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">数据接入</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-settings-sheet-desc">连接外部信号源，让 Today Feed 出现基于真实数据的建议。</p>

        <div className="nesio-settings-sheet-body">
          {statuses.map((c) => (
            <div key={c.id} className="nesio-connector-row">
              <span className="nesio-connector-icon" style={{ background: c.iconBg }}>{c.icon}</span>
              <div className="nesio-connector-body">
                <p className="nesio-connector-name">
                  {c.name}
                  {c.comingSoon && <span className="nesio-connector-soon">即将上线</span>}
                </p>
                <p className="nesio-connector-desc">{c.description}</p>
                {c.connected && c.lastSync && (
                  <p className="nesio-connector-sync">上次同步：{c.lastSync}</p>
                )}
              </div>
              {c.comingSoon ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)' }}>敬请期待</span>
              ) : c.connected ? (
                <button type="button" className="nesio-connector-disconnect" onClick={() => handleDisconnect(c.id)}>
                  断开
                </button>
              ) : (
                <button type="button" className="nesio-connector-connect" onClick={() => handleConnect(c)}
                  disabled={loading === c.id}>
                  {loading === c.id ? '…' : '接入'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
