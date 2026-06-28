'use client';

/**
 * TellNesioSheet — fan overlay only.
 * Sub-sheets (Camera, Voice, Share) are managed by the parent (Portal.tsx)
 * to avoid the race condition where onClose() resets subSheet state.
 */

export type CaptureMode = 'camera' | 'voice' | 'share';

interface TellNesioSheetProps {
  open: boolean;
  onClose: () => void;
  onCapture: (mode: CaptureMode) => void;
}

const FAN_BUTTONS: Array<{
  mode: CaptureMode;
  label: string;
  pos: 'left' | 'center' | 'right';
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
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
      </svg>
    ),
  },
  {
    mode: 'share',
    label: '上传',
    pos: 'right',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
        <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
      </svg>
    ),
  },
];

export default function TellNesioSheet({ open, onClose, onCapture }: TellNesioSheetProps) {
  if (!open) return null;

  return (
    <div className="nesio-tell-overlay" role="dialog" aria-modal="true" aria-label="告诉 Nesio">
      <button type="button" className="nesio-tell-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="nesio-tell-fan">
        {FAN_BUTTONS.map((btn) => (
          <button
            key={btn.mode}
            type="button"
            className={`nesio-tell-fan-btn nesio-tell-fan-btn--${btn.pos}`}
            onClick={() => {
              onClose();          // close fan first
              onCapture(btn.mode); // then open sub-sheet (independent state)
            }}
            aria-label={btn.label}
          >
            <span className="nesio-tell-fan-icon">
              {btn.icon}
            </span>
            <span className="nesio-tell-fan-label">{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
