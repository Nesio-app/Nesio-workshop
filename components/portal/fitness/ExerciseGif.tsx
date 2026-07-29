'use client';

/**
 * ExerciseGif — 扩展库演示 GIF(私有仓库自用素材)。
 * 一个会自播的 <img>。加载失败(该动作没下到 GIF)→ 默认返回 null 优雅降级为纯文字卡;
 * 在「图是主角」的场景(跟练播放器)传 fallbackText,失败态可见,不留无解释的空白。
 */

import { useState } from 'react';

export default function ExerciseGif({
  src, alt = '', className = '', fallbackText,
}: { src: string; alt?: string; className?: string; fallbackText?: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) {
    if (!fallbackText) return null;
    return (
      <div className={`nesio-exfig ${className}`.trim()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', padding: 'var(--space-2)', textAlign: 'center' }}>{fallbackText}</span>
      </div>
    );
  }
  return (
    <div className={`nesio-exfig ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="nesio-exfig-img" src={src} alt={alt} draggable={false} onError={() => setOk(false)} />
    </div>
  );
}
