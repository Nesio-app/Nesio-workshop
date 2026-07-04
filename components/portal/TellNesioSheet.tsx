'use client';

/**
 * TellNesioSheet — fan overlay only.
 * Sub-sheets (Camera, Voice, Share) are managed by the parent (Portal.tsx)
 * to avoid the race condition where onClose() resets subSheet state.
 * 拍一下 = 直接调起原生相机(iOS 要求 file-input click 在用户手势内,
 * 所以 input 就渲染在扇形按钮旁,点按钮即点 input,没有二次选择页)。
 */

import { useRef } from 'react';

export type CaptureMode = 'camera' | 'voice' | 'share';

interface TellNesioSheetProps {
  open: boolean;
  onClose: () => void;
  onCapture: (mode: CaptureMode, file?: File) => void;
}

const FAN_BUTTONS: Array<{
  mode: CaptureMode;
  label: string;
  pos: 'left' | 'center' | 'right';
  accent?: boolean;
  icon: React.ReactNode;
}> = [
  {
    mode: 'camera',
    label: '拍一下',
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
    label: '分析文件',
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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  return (
    <div className="nesio-tell-overlay" role="dialog" aria-modal="true" aria-label="告诉 Nesio">
      <button type="button" className="nesio-tell-backdrop" aria-label="关闭" onClick={onClose} />
      {/* 原生相机直达:capture 属性 → iOS 直接开相机;取消拍摄则什么都不发生 */}
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
                // 同一手势内触发 input.click(),跳过第二次选择页
                cameraInputRef.current?.click();
                return;
              }
              onClose();
              onCapture(btn.mode);
            }}
            aria-label={btn.label}
          >
            <span className={`nesio-tell-fan-icon${btn.accent ? ' nesio-tell-fan-icon--voice' : ''}`}>
              {btn.icon}
            </span>
            <span className="nesio-tell-fan-label">{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
