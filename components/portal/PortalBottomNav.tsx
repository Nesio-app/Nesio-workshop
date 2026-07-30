'use client';

import { useRef } from 'react';
import NesioMark from './NesioMark';
import type { PortalLocale } from '@/lib/portal/profile';
import { L, t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';

interface PortalBottomNavProps {
  activeSurface: 'today' | 'tell' | 'memory';
  locale?: PortalLocale;
  onToday: () => void;
  /** 拍到了 —— 直接把文件交给相机结果流(CameraSheet)。 */
  onCamera: (file: File) => void;
  onAsk?: () => void;
  onInsights: () => void;
  insightsActive?: boolean;
  onChatOpen: () => void;
}

const LONG_PRESS_MS = 450;

export default function PortalBottomNav({
  activeSurface,
  locale = 'zh',
  onToday,
  onCamera,
  onInsights,
  insightsActive = false,
  onChatOpen,
}: PortalBottomNavProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const startPress = (e: React.PointerEvent) => {
    e.preventDefault();
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      navigator.vibrate?.(12);
      onChatOpen();
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // 2026-07-29:点一下 = **直接开相机**,不再先弹「拍/说/收」那三个扇形按钮。
    // 那一步是纯中转:三个里最常用的就是拍,另外两个在别处都有入口
    // (说 = 输入框右边的话筒,收 = 输入框左边的 +)。
    //
    // ⚠️ click() 必须留在这个同步栈里。iOS 的 WKWebView 只认用户手势栈里的
    // 程序化 click,挪进 setTimeout / await 之后就是「点了没反应,也不报错」——
    // 本会话已经因为这条规律修过两个 bug(隐藏 file input、更换头像)。
    if (!firedRef.current) cameraInputRef.current?.click();
    firedRef.current = false;
  };

  const cancelPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    firedRef.current = false;
  };

  return (
    <nav className="nesio-bottom-nav" aria-label={L(portalLocaleToDictionaryLocale(locale), '主导航', 'Main navigation')}>
      {/* Today */}
      <button
        type="button"
        data-tour="today"
        className={`nesio-bottom-nav-btn${activeSurface === 'today' ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onToday}
        aria-label="Today"
        aria-current={activeSurface === 'today' ? 'page' : undefined}
      >
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7.5V12l3 2.2" />
        </svg>
        <span className="nesio-bottom-nav-label">{t(locale, 'navToday')}</span>
      </button>

      {/* Nesio center button — tap = 输入, long-press = 问一问 */}
      <button
        type="button"
        data-tour="center"
        className="nesio-bottom-nav-center"
        aria-label={L(portalLocaleToDictionaryLocale(locale), '记录 / 问一问', 'Capture / Ask')}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 批次 13:白底 PWA PNG 换成无底色矢量 logo,昼夜双资产 */}
        <NesioMark className="nesio-bottom-nav-center-icon" />
      </button>
      {/* 直达系统相机。批次 93 实测:iOS PWA 的 getUserMedia 取景框是黑的,
          所以走 capture="environment" 让系统相机全屏打开,拍完回 CameraSheet 结果流。
          ⚠️ 用 visually-hidden 而不是 display:none —— 不参与布局的 file input
          在 WKWebView 上会**静默忽略** click()(qa-ui-truth 那条契约管的就是这个)。 */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="nesio-visually-hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) onCamera(file);
        }}
      />

      {/* Insights — 全屏浮层(洞察),非 surface;点开由 Portal 渲染 */}
      <button
        type="button"
        data-tour="insights"
        className={`nesio-bottom-nav-btn${insightsActive ? ' nesio-bottom-nav-btn--active' : ''}`}
        onClick={onInsights}
        aria-label={L(portalLocaleToDictionaryLocale(locale), '洞察', 'Insights')}
        aria-current={insightsActive ? 'page' : undefined}
      >
        {/* 品牌晶体:钻石轮廓,呼应 Nesio,区别于今天(钟)/记忆(立方)。
            bug3 p44「洞察符号钻石简化」:原来里面还有三条切面线(横线 + 两条斜线),
            在 22px 的导航图标里挤成一团糊 —— 只留外轮廓 + 一条腰线,形还在,不糊了。 */}
        <svg className="nesio-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 4h12l3 5-9 11L3 9z" />
          <path d="M3 9h18" />
        </svg>
        <span className="nesio-bottom-nav-label">{t(locale, 'navInsights')}</span>
      </button>
    </nav>
  );
}
