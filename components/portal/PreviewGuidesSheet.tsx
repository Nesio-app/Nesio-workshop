'use client';

/**
 * PreviewGuidesSheet — 「预览引导 / 模拟运行」:在真机上手动触发本来要等条件才出现的引导,
 * 不必真的空库/第一次登录/来访好几回。设置页入口,方便自查冷启动三件套:
 *   ① 样例数据(灌入 / 清除)   ② 新手引导导览(重放)   ③ 回访再触达提醒(模拟回访用户)
 *
 * 都是本机操作 + 跳回今天页触发;样例走合法写入门可一键清,不污染真实数据。
 */

import { useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { IconBox, IconTarget, IconBulb, IconRefresh } from './icons';
import { seedSampleData, clearSampleData, hasSampleData } from '@/lib/portal/sample-data';
import { primeReengagementPreview } from '@/lib/portal/feature-usage';
import { TIPS_SHOWN_KEY } from './PortalOnboarding';
import { NESIO_ONBOARDING_DONE_KEYS } from '@/lib/portal/auth-client';

export default function PreviewGuidesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const locale = usePortalLocale();
  const dict = portalLocaleToDictionaryLocale(locale);
  const [seeded, setSeeded] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (open) { try { setSeeded(hasSampleData()); } catch { setSeeded(false); } setMsg(''); } }, [open]);

  if (!open) return null;

  const goHome = () => { window.location.href = '/'; };

  function toggleSample() {
    try {
      if (hasSampleData()) {
        const n = clearSampleData();
        setSeeded(false);
        setMsg(L(dict, `已清除 ${n} 条样例。`, `Cleared ${n} sample items.`));
      } else {
        const n = seedSampleData();
        setSeeded(true);
        setMsg(L(dict, `已灌入 ${n} 条样例,回今天页 / 记忆页看看。`, `Seeded ${n} samples — check Today / Memory.`));
      }
    } catch {
      setMsg(L(dict, '操作没成功,请重试。', 'Something went wrong — try again.'));
    }
  }

  function replayTour() {
    try { localStorage.removeItem(TIPS_SHOWN_KEY); } catch { /* ignore */ }
    goHome();
  }

  function replayWelcome() {
    try {
      NESIO_ONBOARDING_DONE_KEYS.forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem(TIPS_SHOWN_KEY);
    } catch { /* ignore */ }
    goHome();
  }

  function simulateReengage() {
    try { primeReengagementPreview(); } catch { /* ignore */ }
    goHome();
  }

  const rows: Array<{ icon: React.ReactNode; title: string; sub: string; cta: string; onClick: () => void }> = [
    {
      icon: <IconBox size={18} />,
      title: L(dict, '样例数据', 'Sample data'),
      sub: seeded
        ? L(dict, '已灌入一批样例(带「样例」标签,可随时清)。', 'Samples are loaded (tagged, clearable anytime).')
        : L(dict, '一键灌入人物/邮件/日历/提醒/位置/心情/回顾等真节点,体验各面。', 'Load people/mail/calendar/reminders/place/mood/retrospect nodes to see every surface.'),
      cta: seeded ? L(dict, '清除样例', 'Clear samples') : L(dict, '灌入样例', 'Seed samples'),
      onClick: toggleSample,
    },
    {
      icon: <IconTarget size={18} />,
      title: L(dict, '重看新手引导导览', 'Replay the guided tour'),
      sub: L(dict, '重放今天/中键/记忆各步的浮层引导(不动欢迎/登录)。', 'Replay the coach-mark tour over Today / center / Memory (skips welcome/sign-in).'),
      cta: L(dict, '重看导览', 'Replay tour'),
      onClick: replayTour,
    },
    {
      icon: <IconRefresh size={18} />,
      title: L(dict, '从头走欢迎流程', 'Restart the full welcome'),
      sub: L(dict, '含欢迎/取名/登录三步 + 导览,像第一次打开。', 'Welcome / name / sign-in steps + tour, like a first launch.'),
      cta: L(dict, '从头开始', 'Start over'),
      onClick: replayWelcome,
    },
    {
      icon: <IconBulb size={18} />,
      title: L(dict, '模拟回访功能提醒', 'Simulate a re-engagement nudge'),
      sub: L(dict, '把状态改成「来过好几回、功能没碰过」,回今天页会弹一条温和提醒(需登录)。', 'Marks you as a returning-but-inactive user — Today shows a gentle nudge (sign-in required).'),
      cta: L(dict, '模拟并回今天', 'Simulate & go'),
      onClick: simulateReengage,
    },
  ];

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '预览引导', 'Preview guides')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '预览引导 · 模拟运行', 'Preview guides · Dry run')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">
          <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
            {L(dict, '手动触发本来要等条件才出现的引导,方便在真机上自查。', 'Manually trigger guides that normally wait for conditions — handy for on-device checks.')}
          </p>
          {rows.map((r) => (
            <div key={r.title} className="nesio-preview-guide-row">
              <span className="nesio-preview-guide-icon" aria-hidden>{r.icon}</span>
              <div className="nesio-preview-guide-text">
                <p className="nesio-preview-guide-title">{r.title}</p>
                <p className="nesio-preview-guide-sub">{r.sub}</p>
              </div>
              <button type="button" className="nesio-preview-guide-cta" onClick={r.onClick}>{r.cta}</button>
            </div>
          ))}
          {msg && <p className="nesio-preview-guide-msg" role="status">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
