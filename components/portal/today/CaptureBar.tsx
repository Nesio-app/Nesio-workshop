'use client';

/**
 * CaptureBar — 今天页「说一句 / 记一下」输入条。
 *
 * 2026-07-28 UI 精修(用户标注 PDF-1 图4/图5):这条原本挂在时间线最下面(记一笔·话筒末节点),
 * 现在搬到时间线**上方**、原「+ 新建日程」的位置 —— 新建日程按钮同批删掉。
 * 逻辑一字未改(话筒录音 / 回车记下 / 填了才出 ↑ 圆钮),只是换了挂载点,故拆成独立组件。
 */
import type { RefObject } from 'react';
import { IconMic } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export interface CaptureBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onMic: () => void;
  recording: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** 输入框随字数长高(和成长页文本框同一套手感)。 */
function growJot(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 8 * 16)}px`;
}

export default function CaptureBar(capture: CaptureBarProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <div className={`nesio-tl-capture nesio-tl-capture--top${capture.recording ? ' nesio-tl-capture--rec' : ''}${capture.value.trim() ? ' nesio-tl-capture--filled' : ''}`}>
      <button
        type="button"
        className="nesio-tl-capture-mic"
        aria-label={capture.recording ? L(dict, '说完了,点击保存', 'Done — tap to save') : L(dict, '说一句', 'Say something')}
        onClick={capture.onMic}
      >
        <IconMic size={13} />
      </button>
      <form className="nesio-tl-capture-form" onSubmit={(e) => { e.preventDefault(); capture.onSubmit(); }}>
        <div className={`nesio-tl-capture-box${capture.value.trim() ? ' nesio-tl-capture-box--filled' : ''}`}>
          <textarea
            ref={capture.inputRef}
            className="nesio-tl-capture-input"
            rows={1}
            value={capture.value}
            onChange={(e) => { capture.onChange(e.target.value); growJot(e.currentTarget); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture.onSubmit(); } }}
            onFocus={(e) => {
              // 聚焦后等键盘升起,把输入框滚到刚好可见(nearest,不留大空隙)。
              const el = e.currentTarget;
              setTimeout(() => { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ } }, 320);
            }}
            placeholder={L(dict, '点话筒说一句,或记一下…', 'Tap the mic to speak, or jot…')}
          />
          {capture.value.trim() && (
            <div className="nesio-tl-capture-actions">
              <button type="submit" className="nesio-tl-capture-send" aria-label={L(dict, '记下', 'Jot')}>↑</button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
