'use client';

import { useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
}

interface RecognizedItem {
  name: string;
  suggestion: string;
  icon: string;
}

function mockRecognize(): RecognizedItem {
  const items: RecognizedItem[] = [
    { name: '蓝色收纳盒', suggestion: '建议存到「储物间」', icon: '📦' },
    { name: '药瓶', suggestion: '建议标记为「健康物品」', icon: '💊' },
    { name: '文件', suggestion: '建议存到「重要文件」', icon: '📄' },
    { name: '书本', suggestion: '建议存到「阅读记录」', icon: '📚' },
  ];
  return items[Math.floor(Math.random() * items.length)];
}

export default function CameraSheet({ open, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognized, setRecognized] = useState<RecognizedItem | null>(null);
  const [saved, setSaved] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [mode, setMode] = useState<'camera' | 'gallery'>('camera');

  useEffect(() => {
    if (open) {
      setCameraError(false);
      setRecognized(null);
      setSaved(false);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Simulate auto-recognition after 2s
      setTimeout(() => {
        setRecognizing(true);
        setTimeout(() => {
          setRecognizing(false);
          setRecognized(mockRecognize());
        }, 1500);
      }, 2000);
    } catch {
      setCameraError(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function handleSaveToMemory() {
    if (!recognized) return;
    addLifeNode({
      type: 'object',
      name: recognized.name,
      attributes: { category: recognized.suggestion },
      source: 'photo',
      confidence: 0.85,
      relations: [],
      tags: ['拍一下'],
    });
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); setRecognized(null); }, 1200);
  }

  function handleGallery() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      setRecognizing(true);
      setTimeout(() => {
        setRecognizing(false);
        setRecognized(mockRecognize());
      }, 1500);
    };
    input.click();
  }

  if (!open) return null;

  return (
    <div className="nesio-camera-sheet" role="dialog" aria-modal="true" aria-label="拍一下">
      {/* Header */}
      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </button>
        <h2 className="nesio-camera-title">拍一下</h2>
        <div style={{ width: 40 }} />
      </div>

      {/* Viewfinder */}
      <div className="nesio-camera-viewfinder">
        {cameraError ? (
          <div className="nesio-camera-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" opacity="0.3">
              <path d="M21 8.5L12 3 3 8.5v7L12 21l9-5.5z" /><path d="M12 3v18M3 8.5l9 5.5 9-5.5" />
            </svg>
            <p style={{ color: '#8fa3c0', fontSize: '0.82rem', marginTop: '1rem' }}>相机权限未授权</p>
            <button type="button" className="nesio-camera-gallery-btn" onClick={handleGallery} style={{ marginTop: '1rem' }}>
              从相册选择
            </button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="nesio-camera-video" />
        )}

        {/* Corners */}
        <div className="nesio-camera-corners" aria-hidden>
          <span className="nesio-camera-corner nesio-camera-corner--tl" />
          <span className="nesio-camera-corner nesio-camera-corner--tr" />
          <span className="nesio-camera-corner nesio-camera-corner--bl" />
          <span className="nesio-camera-corner nesio-camera-corner--br" />
        </div>

        {/* Recognizing pill */}
        {recognizing && (
          <div className="nesio-camera-recognizing" aria-live="polite">
            <span className="nesio-camera-recognizing-dot" />
            Nesio 正在识别…
          </div>
        )}
      </div>

      {/* Result card */}
      {recognized && (
        <div className={`nesio-camera-result${saved ? ' nesio-camera-result--saved' : ''}`}>
          <div className="nesio-camera-result-row">
            <span className="nesio-camera-result-icon">{recognized.icon}</span>
            <div>
              <p className="nesio-camera-result-name">{saved ? '已存入 Memory ✓' : recognized.name}</p>
              <p className="nesio-camera-result-hint">{recognized.suggestion}</p>
            </div>
          </div>
          {!saved && (
            <button type="button" className="nesio-camera-save-btn" onClick={handleSaveToMemory}>
              存入 Memory
            </button>
          )}
        </div>
      )}

      {/* Bottom controls */}
      <div className="nesio-camera-controls">
        <button type="button" className="nesio-camera-ctrl-btn" onClick={handleGallery} aria-label="相册">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          className="nesio-camera-shutter"
          onClick={() => { setRecognizing(true); setTimeout(() => { setRecognizing(false); setRecognized(mockRecognize()); }, 1200); }}
          aria-label="拍照"
        />
        <button type="button" className="nesio-camera-ctrl-btn" aria-label="切换镜头">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
