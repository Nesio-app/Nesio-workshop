'use client';

import { useEffect, useRef, useState } from 'react';
import { addLifeNode, type LifeNode } from '@/lib/portal/life-graph';

interface ConnectorsHubProps { open: boolean; onClose: () => void; }

type ConnectorId = 'calendar' | 'gmail' | 'weather' | 'health' | 'tesla';

interface ConnectorStatus {
  id: ConnectorId;
  name: string;
  icon: string;
  iconBg: string;
  description: string;
  connected: boolean;
  syncing?: boolean;
  lastSync?: string;
  nodeCount?: number;
  comingSoon?: boolean;
}

const CONNECTORS_KEY = 'nesio-connectors-v1';

function loadConnectors(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CONNECTORS_KEY) || '{}'); }
  catch { return {}; }
}
function saveConnector(id: string, connected: boolean) {
  const saved = loadConnectors();
  if (connected) saved[id] = true;
  else delete saved[id];
  try { localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
}

// Check URL params on mount for OAuth callback results
function checkOAuthCallback(): { connector?: string; status?: string; error?: string } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const connector = params.get('connector') || undefined;
  const status = params.get('status') || undefined;
  const error = params.get('error') || undefined;
  if (connector) {
    // Clean URL
    params.delete('connector'); params.delete('status'); params.delete('error');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }
  return { connector, status, error };
}

export default function ConnectorsHub({ open, onClose }: ConnectorsHubProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [syncResult, setSyncResult] = useState<{ id: string; count: number } | null>(null);
  const [oauthError, setOauthError] = useState('');

  useEffect(() => {
    if (!open) return;

    // Check OAuth callback
    const { connector, status, error } = checkOAuthCallback();
    if (connector && status === 'connected') {
      saveConnector(connector, true);
      if (connector === 'gmail') setTimeout(() => syncGmail(), 500);
    }
    if (error) setOauthError(`连接失败：${error}`);
    else setOauthError('');

    const saved = loadConnectors();
    setStatuses([
      { id: 'calendar', name: 'Google Calendar', icon: '📅', iconBg: '#dbeafe', description: '读取日程，生成会议提醒和准备 Brief', connected: saved['calendar'] ?? false },
      { id: 'gmail', name: 'Gmail', icon: '📧', iconBg: '#fce7f3', description: '从邮件自动抽取人物、日期、承诺，存入 Memory', connected: saved['gmail'] ?? false },
      { id: 'weather', name: '地理位置 · 天气', icon: '🌤', iconBg: '#fef3c7', description: '基于实时天气生成外出提醒和健康建议', connected: saved['weather'] ?? false },
      { id: 'health', name: 'Apple Health 导出', icon: '🩷', iconBg: '#fce7f3', description: '上传 Apple Health 的 export.xml，自动提取步数、睡眠、心率', connected: saved['health'] ?? false },
      { id: 'tesla', name: 'Tesla', icon: '🚗', iconBg: '#d1fae5', description: '电量、行程信号，自动提醒充电', connected: false, comingSoon: true },
    ]);
  }, [open]);

  function updateStatus(id: ConnectorId, patch: Partial<ConnectorStatus>) {
    setStatuses((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  async function handleConnect(connector: ConnectorStatus) {
    if (connector.comingSoon) return;

    if (connector.id === 'gmail') {
      // Real OAuth redirect
      window.location.href = '/api/portal/gmail/connect';
      return;
    }

    if (connector.id === 'calendar') {
      window.location.href = '/api/portal/calendar/connect';
      return;
    }

    if (connector.id === 'weather') {
      updateStatus('weather', { syncing: true });
      navigator.geolocation.getCurrentPosition(
        () => {
          saveConnector('weather', true);
          updateStatus('weather', { connected: true, syncing: false, lastSync: '刚刚' });
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
        },
        () => {
          updateStatus('weather', { syncing: false });
          alert('位置权限被拒绝，请在浏览器设置→网站设置→位置中允许。');
        },
        { timeout: 8000 },
      );
      return;
    }

    if (connector.id === 'health') {
      fileRef.current?.click();
      return;
    }
  }

  async function syncGmail() {
    updateStatus('gmail', { syncing: true });
    try {
      const res = await fetch('/api/portal/gmail');
      const data = await res.json() as { ok?: boolean; nodes?: Array<Omit<LifeNode, 'id' | 'createdAt'>>; count?: number; error?: string; connectUrl?: string };

      if (!data.ok) {
        if (data.connectUrl) {
          setOauthError('Gmail 授权已过期，请重新连接。');
          saveConnector('gmail', false);
          updateStatus('gmail', { connected: false, syncing: false });
        } else {
          setOauthError(`同步失败：${data.error || '未知错误'}`);
          updateStatus('gmail', { syncing: false });
        }
        return;
      }

      const count = data.nodes?.length || 0;
      data.nodes?.forEach((node) => addLifeNode({ ...node, source: 'email' }));
      saveConnector('gmail', true);
      updateStatus('gmail', { connected: true, syncing: false, lastSync: '刚刚', nodeCount: count });
      setSyncResult({ id: 'gmail', count });
      window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    } catch {
      updateStatus('gmail', { syncing: false });
      setOauthError('Gmail 同步失败，请检查网络连接。');
    }
  }

  async function handleHealthFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    updateStatus('health', { syncing: true });
    try {
      let text = '';
      if (file.name.endsWith('.zip')) {
        // Can't unzip in browser easily — instruct user
        alert('请先在 Apple 健康 App 中导出，解压 zip 后上传里面的 export.xml 文件。');
        updateStatus('health', { syncing: false });
        return;
      }
      text = await file.text();

      const res = await fetch('/api/portal/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: text }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: Array<Omit<LifeNode, 'id' | 'createdAt'>>; count?: number };

      if (data.ok && data.nodes?.length) {
        data.nodes.forEach((node) => addLifeNode({ ...node, source: 'system' }));
        saveConnector('health', true);
        updateStatus('health', { connected: true, syncing: false, lastSync: '刚刚', nodeCount: data.count });
        setSyncResult({ id: 'health', count: data.count || 0 });
        window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
      }
    } catch {
      updateStatus('health', { syncing: false });
      setOauthError('健康数据解析失败。');
    }
  }

  function handleDisconnect(id: ConnectorId) {
    saveConnector(id, false);
    updateStatus(id, { connected: false, lastSync: undefined, nodeCount: undefined });
  }

  if (!open) return null;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="数据接入">
      <input ref={fileRef} type="file" accept=".xml,.zip" style={{ display: 'none' }} onChange={handleHealthFile} />
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">数据接入</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-settings-sheet-desc">连接外部信号源，让 Today Feed 出现真实数据驱动的建议。</p>

        {oauthError && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', padding: '0.65rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#ef4444' }}>
            {oauthError}
          </div>
        )}

        {syncResult && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.75rem', padding: '0.65rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#059669' }}>
            ✓ 已提取 {syncResult.count} 个记忆节点存入 Life Graph
          </div>
        )}

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
                {c.connected && (
                  <p className="nesio-connector-sync">
                    {c.syncing ? '同步中…' : `上次同步：${c.lastSync || '—'}`}
                    {c.nodeCount ? `  ·  ${c.nodeCount} 个节点` : ''}
                  </p>
                )}
              </div>

              {c.comingSoon ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', flexShrink: 0 }}>敬请期待</span>
              ) : c.connected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                  {c.id === 'gmail' && (
                    <button type="button" className="nesio-connector-connect" onClick={syncGmail} disabled={c.syncing}>
                      {c.syncing ? '…' : '同步'}
                    </button>
                  )}
                  <button type="button" className="nesio-connector-disconnect" onClick={() => handleDisconnect(c.id)}>断开</button>
                </div>
              ) : (
                <button type="button" className="nesio-connector-connect" onClick={() => handleConnect(c)}
                  disabled={c.syncing} style={{ flexShrink: 0 }}>
                  {c.syncing ? '…' : c.id === 'health' ? '上传' : '接入'}
                </button>
              )}
            </div>
          ))}

          {/* Apple Health instructions */}
          <div style={{ marginTop: '1rem', background: 'rgba(88,140,227,0.05)', border: '1px dashed rgba(88,140,227,0.2)', borderRadius: '0.75rem', padding: '0.75rem 0.85rem', fontSize: '0.75rem', color: 'var(--portal-muted)', lineHeight: '1.6' }}>
            <strong style={{ color: 'var(--portal-ink)', display: 'block', marginBottom: '0.3rem' }}>如何导出 Apple Health 数据</strong>
            健康 App → 右上角头像 → 导出健康数据 → 解压 zip → 上传 export.xml
          </div>

          <div style={{ marginTop: '0.85rem', fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center' }}>
            所有数据仅在你的设备上处理和存储
          </div>
        </div>
      </div>
    </div>
  );
}
