'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes } from '@/lib/portal/life-graph';

/** New-design "我" profile header — sits above the legacy AccountSettings */
export default function NesioProfileCard() {
  const [displayName, setDisplayName] = useState('Jessy');
  const [daysUsed, setDaysUsed] = useState(0);
  const [memoryCount, setMemoryCount] = useState(0);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);

    // Days since first use (stored in localStorage)
    try {
      const firstKey = 'nesio-first-open';
      const first = localStorage.getItem(firstKey);
      if (!first) {
        localStorage.setItem(firstKey, new Date().toISOString());
        setDaysUsed(1);
      } else {
        const ms = Date.now() - new Date(first).getTime();
        setDaysUsed(Math.max(1, Math.floor(ms / 86_400_000)));
      }
    } catch { /* ignore */ }

    setMemoryCount(getRecentNodes(100).length);

    const onUpdate = () => setMemoryCount(getRecentNodes(100).length);
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const initials = displayName.trim().slice(0, 1) || 'J';

  return (
    <div className="nesio-profile-card">
      {/* Avatar + name */}
      <div className="nesio-profile-card-top">
        <div className="nesio-profile-avatar-lg">{initials}</div>
        <div>
          <p className="nesio-profile-name">{displayName}</p>
          <p className="nesio-profile-days">Nesio 已经陪你 {daysUsed} 天</p>
        </div>
        {memoryCount > 0 && (
          <div className="nesio-profile-stat">
            <span className="nesio-profile-stat-num">{memoryCount}</span>
            <span className="nesio-profile-stat-label">条记忆</span>
          </div>
        )}
      </div>

      {/* Menu items matching the design */}
      <nav className="nesio-profile-menu" aria-label="设置菜单">
        {[
          {
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            ),
            iconBg: '#e0e7ff',
            label: '语气与边界',
            sublabel: 'Nesio 怎么跟你说话、什么时候不打扰',
            href: '#tone',
          },
          {
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            ),
            iconBg: '#d1fae5',
            label: '隐私与数据',
            sublabel: '记住了什么、存在哪、随时可删',
            href: '#privacy',
          },
          {
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
                <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
              </svg>
            ),
            iconBg: '#fef3c7',
            label: '生活空间',
            sublabel: '家 · 工作 · 健康 · 家庭，分区管理',
            href: '#spaces',
          },
          {
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <path d="M2 10h20"/>
              </svg>
            ),
            iconBg: '#fef9c3',
            label: '订阅',
            sublabel: 'Nesio Plus · 管理计划',
            href: '#subscription',
            accent: true,
          },
        ].map((item) => (
          <a key={item.label} href={item.href} className="nesio-profile-menu-item">
            <span className="nesio-profile-menu-icon" style={{ background: item.iconBg }}>
              {item.icon}
            </span>
            <div className="nesio-profile-menu-text">
              <span className="nesio-profile-menu-label">{item.label}</span>
              <span className="nesio-profile-menu-sublabel">{item.sublabel}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="nesio-profile-menu-chevron">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </a>
        ))}
      </nav>
    </div>
  );
}
