'use client';

/**
 * TellNesioSheet — fan overlay only.
 * Sub-sheets (Camera, Voice, Share) are managed by the parent (Portal.tsx)
 * to avoid the race condition where onClose() resets subSheet state.
 * 拍一下 = 直接调起原生相机(iOS 要求 file-input click 在用户手势内,
 * 所以 input 就渲染在扇形按钮旁,点按钮即点 input,没有二次选择页)。
 */

import { useRef } from 'react';
import { L } from '@/lib/portal/i18n';
import { prefetchCaptureLocation } from '@/lib/portal/capture-location';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { useFeatureEnabled } from './use-feature-flag';

export type CaptureMode = 'camera' | 'voice' | 'share';

interface TellNesioSheetProps {
  open: boolean;
  onClose: () => void;
  onCapture: (mode: CaptureMode, file?: File) => void;
}

const FAN_BUTTONS: Array<{
  mode: CaptureMode;
  label: string;
  labelEn: string;
  pos: 'left' | 'center' | 'right';
  accent?: boolean;
  icon: React.ReactNode;
}> = [
  {
    mode: 'camera',
    label: '拍一下',
    labelEn: 'Snap',
    pos: 'left',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    ),
  },
  {
    mode: 'voice',
    label: '说一句',
    labelEn: 'Say it',
    pos: 'center',
    accent: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
      </svg>
    ),
  },
  {
    mode: 'share',
    label: '分享',
    labelEn: 'Share',
    pos: 'right',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
];

export default function TellNesioSheet({ open, onClose, onCapture }: TellNesioSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const showFreeze = useFeatureEnabled('freeze'); // 功能开关中心:冷冻仓可关
  if (!open) return null;
  // 批次 56:捕获面一打开就预热手机定位(开关开着才动),盖章时坐标已就绪
  prefetchCaptureLocation();

  return (
    <div className="nesio-tell-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '告诉 Nesio', 'Tell Nesio')}>
      <button type="button" className="nesio-tell-backdrop" aria-label={L(dict, '关闭', 'Close')} onClick={onClose} />
      {/* 批次 93(撤批次91):getUserMedia 取景框在 iOS PWA 实锤黑屏 —— 拍一下
          重新一下直达系统相机(同一手势内 click,iOS 全屏打开),不再先进
          会黑屏的应用内取景框、再落到「上传图片」兜底页(那多一步)。 */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          onClose();
          onCapture('camera', file);
        }}
      />
      <div className="nesio-tell-fan">
        {FAN_BUTTONS.map((btn, i) => (
          <button
            key={btn.mode}
            type="button"
            className={`nesio-tell-fan-btn nesio-tell-fan-btn--${btn.pos}`}
            style={{ '--delay': `${i * 0.05}s` } as React.CSSProperties}
            onClick={() => {
              if (btn.mode === 'camera') {
                // 批次 93:iOS PWA getUserMedia 取景框实锤黑屏 —— 直达系统相机
                // (一下打开,不进会黑屏的应用内取景)。拍完回 CameraSheet 结果流。
                cameraInputRef.current?.click();
                return;
              }
              onClose();
              onCapture(btn.mode);
            }}
            aria-label={L(dict, btn.label, btn.labelEn)}
          >
            <span className={`nesio-tell-fan-icon${btn.accent ? ' nesio-tell-fan-icon--voice' : ''}`}>
              {btn.icon}
            </span>
            <span className="nesio-tell-fan-label">{L(dict, btn.label, btn.labelEn)}</span>
          </button>
        ))}
      </div>

      {/* 批次 40/44:记录心情 + 冻一下 —— 与扇形按钮同款,居中放在下方一行 */}
      <div className="nesio-tell-extras">
        <button
          type="button"
          className="nesio-tell-fan-btn nesio-tell-fan-btn--extra"
          onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('nesio-open-mood')); }}
          aria-label={L(dict, '记录此刻心情', 'Log how you feel')}
        >
          <span className="nesio-tell-fan-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </span>
          <span className="nesio-tell-fan-label">{L(dict, '记录心情', 'How I feel')}</span>
        </button>

        {/* 冻一下 —— 想买点东西先冻进冷冻仓(冲动购物防护 + 奖品仓库入口)。功能开关中心可关。 */}
        {showFreeze && (
        <button
          type="button"
          className="nesio-tell-fan-btn nesio-tell-fan-btn--extra"
          onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('nesio-open-freeze')); }}
          aria-label={L(dict, '想买的先冻进冷冻仓', 'Freeze something you want to buy')}
        >
          <span className="nesio-tell-fan-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="12" y1="6" x2="16" y2="3.5" /><line x1="12" y1="6" x2="8" y2="3.5" />
              <line x1="12" y1="18" x2="16" y2="20.5" /><line x1="12" y1="18" x2="8" y2="20.5" />
              <line x1="3.2" y1="7" x2="20.8" y2="17" />
              <line x1="3.2" y1="17" x2="20.8" y2="7" />
            </svg>
          </span>
          <span className="nesio-tell-fan-label">{L(dict, '冻一下', 'Freeze it')}</span>
        </button>
        )}

        {/* 收纳入口已迁记忆页(批次 31 用户指令 + 规格挂账落地):扇形只留捕获动作 */}
      </div>
    </div>
  );
}
