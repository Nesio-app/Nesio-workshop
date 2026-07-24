'use client';

/**
 * ExerciseGif — 扩展库演示 GIF(私有仓库自用素材)。
 * 一个会自播的 <img>。加载失败(该动作没下到 GIF)→ 返回 null,优雅降级为纯文字卡。
 */

import { useState } from 'react';

export default function ExerciseGif({
  src, alt = '', className = '',
}: { src: string; alt?: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <div className={`nesio-exfig ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="nesio-exfig-img" src={src} alt={alt} draggable={false} onError={() => setOk(false)} />
    </div>
  );
}
