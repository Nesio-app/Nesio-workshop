'use client';

import { useEffect, useRef, useState } from 'react';

interface TellNesioSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function TellNesioSheet({ open, onClose }: TellNesioSheetProps) {
  const [recording, setRecording] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setRecording(false);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  const handleVoice = () => {
    setRecording(true);
    // Real voice input would use Web Speech API or MediaRecorder
    setTimeout(() => { setRecording(false); onClose(); }, 3000);
  };

  const handleCamera = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => onClose();
    input.click();
  };

  const handleShare = () => {
    // Web Share Target or file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => onClose();
    input.click();
  };

  return (
    <div
      className="nesio-tell-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="告诉 Nesio"
    >
      <button
        type="button"
        className="nesio-tell-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />

      <div className="nesio-tell-actions">
        {/* Left: Camera */}
        <button type="button" className="nesio-tell-action" onClick={handleCamera}>
          <span className="nesio-tell-action-icon" aria-hidden>📷</span>
          <span className="nesio-tell-action-label">拍一下</span>
        </button>

        {/* Center: Voice (larger) */}
        <button
          type="button"
          className={`nesio-tell-action nesio-tell-action--voice${recording ? ' nesio-tell-action--recording' : ''}`}
          onClick={handleVoice}
          aria-label={recording ? '录音中…' : '说一句'}
        >
          <span className="nesio-tell-action-icon" aria-hidden>
            {recording ? '⏹' : '🎤'}
          </span>
          <span className="nesio-tell-action-label">{recording ? '录音中…' : '说一句'}</span>
        </button>

        {/* Right: Share */}
        <button type="button" className="nesio-tell-action" onClick={handleShare}>
          <span className="nesio-tell-action-icon" aria-hidden>⬆️</span>
          <span className="nesio-tell-action-label">分享 · 上传</span>
        </button>
      </div>
    </div>
  );
}
