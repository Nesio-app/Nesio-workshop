'use client';

import { useEffect, useState } from 'react';
import VoiceInputSheet from './VoiceInputSheet';
import CameraSheet from './CameraSheet';
import ShareSheet from './ShareSheet';

interface TellNesioSheetProps {
  open: boolean;
  onClose: () => void;
}

type SubSheet = 'voice' | 'camera' | 'share' | null;

export default function TellNesioSheet({ open, onClose }: TellNesioSheetProps) {
  const [subSheet, setSubSheet] = useState<SubSheet>(null);

  useEffect(() => {
    if (!open) setSubSheet(null);
  }, [open]);

  function openSub(s: SubSheet) {
    setSubSheet(s);
    onClose(); // close the fan overlay
  }

  function closeSub() {
    setSubSheet(null);
  }

  return (
    <>
      {/* Fan overlay */}
      {open && (
        <div className="nesio-tell-overlay" role="dialog" aria-modal="true" aria-label="告诉 Nesio">
          <button type="button" className="nesio-tell-backdrop" aria-label="关闭" onClick={onClose} />

          {/* Fan: camera (left), voice (center-top), share (right) */}
          <div className="nesio-tell-fan">
            {/* Camera — lower left */}
            <button
              type="button"
              className="nesio-tell-fan-btn nesio-tell-fan-btn--left"
              onClick={() => openSub('camera')}
              aria-label="拍一下"
              style={{ '--delay': '0.05s' } as React.CSSProperties}
            >
              <span className="nesio-tell-fan-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </span>
              <span className="nesio-tell-fan-label">拍一下</span>
            </button>

            {/* Voice — center top (larger) */}
            <button
              type="button"
              className="nesio-tell-fan-btn nesio-tell-fan-btn--center"
              onClick={() => openSub('voice')}
              aria-label="说一句"
              style={{ '--delay': '0s' } as React.CSSProperties}
            >
              <span className="nesio-tell-fan-icon nesio-tell-fan-icon--voice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              </span>
              <span className="nesio-tell-fan-label">说一句</span>
            </button>

            {/* Share — lower right */}
            <button
              type="button"
              className="nesio-tell-fan-btn nesio-tell-fan-btn--right"
              onClick={() => openSub('share')}
              aria-label="分享·上传"
              style={{ '--delay': '0.05s' } as React.CSSProperties}
            >
              <span className="nesio-tell-fan-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                </svg>
              </span>
              <span className="nesio-tell-fan-label">分享 · 上传</span>
            </button>
          </div>
        </div>
      )}

      {/* Sub-sheets rendered outside the overlay */}
      <VoiceInputSheet open={subSheet === 'voice'} onClose={closeSub} />
      <CameraSheet open={subSheet === 'camera'} onClose={closeSub} />
      <ShareSheet open={subSheet === 'share'} onClose={closeSub} />
    </>
  );
}
