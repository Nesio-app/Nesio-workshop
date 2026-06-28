'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes } from '@/lib/portal/life-graph';
import { ToneSheet, PrivacySheet, SpacesSheet, SubscriptionSheet } from './SettingsSheets';
import ConnectorsHub from './ConnectorsHub';
import HealthLogger from './HealthLogger';
import MirrorProfileCard from './MirrorProfileCard';

type ActiveSheet = 'tone' | 'privacy' | 'spaces' | 'subscription' | 'connectors' | 'health' | null;

export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  const [daysUsed, setDaysUsed] = useState(0);
  const [memoryCount, setMemoryCount] = useState(0);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);
    setMemoryCount(getRecentNodes(100).length);

    try {
      const firstKey = 'nesio-first-open';
      const first = localStorage.getItem(firstKey);
      if (!first) { localStorage.setItem(firstKey, new Date().toISOString()); setDaysUsed(1); }
      else setDaysUsed(Math.max(1, Math.floor((Date.now() - new Date(first).getTime()) / 86_400_000)));
    } catch { /* ignore */ }

    // Check auth session
    fetch('/api/auth/session').then((r) => r.json()).then((d: { ok?: boolean }) => setIsSignedIn(!!d?.ok)).catch(() => {});

    const onUpdate = () => setMemoryCount(getRecentNodes(100).length);
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const initials = displayName.trim().slice(0, 1) || 'J';

  const menuItems = [
    { key: 'tone' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
        </svg>), iconBg: '#e0e7ff', label: '表达方式', sublabel: '你决定 Nesio 怎么说、什么时候少打扰' },
    { key: 'privacy' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>), iconBg: '#d1fae5', label: '我的数据', sublabel: '你能查看、导出或删除 Nesio 记住的内容' },
    { key: 'spaces' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>), iconBg: '#fef3c7', label: '我的生活范围', sublabel: '你选择哪些场景可以被整理' },
    { key: 'subscription' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
        </svg>), iconBg: '#fef9c3', label: '我的计划', sublabel: '查看当前能力与未来可选升级' },
    { key: 'connectors' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>), iconBg: '#dbeafe', label: '数据接入', sublabel: 'Gmail · Calendar · 天气 · Tesla' },
    { key: 'health' as ActiveSheet, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>), iconBg: '#fce7f3', label: '健康记录', sublabel: '记录今日症状、睡眠、精力' },
  ];

  return (
    <>
      <div className="nesio-profile-card">
        {/* Avatar + name + stats */}
        <div className="nesio-profile-card-top">
          <div className="nesio-profile-avatar-lg">{initials}</div>
          <div style={{ flex: 1 }}>
            <p className="nesio-profile-name">{displayName}</p>
            <p className="nesio-profile-days">你已经整理了 {daysUsed} 天生活线索</p>
          </div>
          {memoryCount > 0 && (
            <div className="nesio-profile-stat">
              <span className="nesio-profile-stat-num">{memoryCount}</span>
              <span className="nesio-profile-stat-label">条记忆</span>
            </div>
          )}
        </div>

        {/* Auth status */}
        {!isSignedIn && (
          <a href="/login" className="nesio-profile-auth-banner">
            <span>🔐 登录以跨设备同步 Memory</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
          </a>
        )}

        {/* Mirror Profile card */}
        <MirrorProfileCard embedded />

        {/* Menu */}
        <nav className="nesio-profile-menu" aria-label="设置菜单">
          {menuItems.map((item) => (
            <button key={String(item.key)} type="button" className="nesio-profile-menu-item" onClick={() => setActiveSheet(item.key)}>
              <span className="nesio-profile-menu-icon" style={{ background: item.iconBg }}>{item.icon}</span>
              <div className="nesio-profile-menu-text">
                <span className="nesio-profile-menu-label">{item.label}</span>
                <span className="nesio-profile-menu-sublabel">{item.sublabel}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="nesio-profile-menu-chevron"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}
        </nav>
      </div>

      {/* Sub-sheets */}
      <ToneSheet open={activeSheet === 'tone'} onClose={() => setActiveSheet(null)} />
      <PrivacySheet open={activeSheet === 'privacy'} onClose={() => setActiveSheet(null)} />
      <SpacesSheet open={activeSheet === 'spaces'} onClose={() => setActiveSheet(null)} />
      <SubscriptionSheet open={activeSheet === 'subscription'} onClose={() => setActiveSheet(null)} />
      <ConnectorsHub open={activeSheet === 'connectors'} onClose={() => setActiveSheet(null)} />
      <HealthLogger open={activeSheet === 'health'} onClose={() => setActiveSheet(null)} />
    </>
  );
}
