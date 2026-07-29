'use client';

/**
 * CaptureBar — 今天页「说一句 / 记一下」输入条。
 *
 * 2026-07-28 UI 精修(用户标注 PDF-1 图4/图5):这条原本挂在时间线最下面(记一笔·话筒末节点),
 * 现在搬到时间线**上方**、原「+ 新建日程」的位置 —— 新建日程按钮同批删掉。
 *
 * 2026-07-28 形态改版(用户给了参考图):整条收成**一个胶囊** ——
 * 左边一枚「+」(上传图片/文件)、中间输入、右边实心话筒。
 * 之前是「话筒在框外左边 + 一个独立输入框」两个物件,参考图是一个整体。
 *
 * 「+」上传落到哪:
 *   · 图片 → 压缩存 IndexedDB,建一条带照片的记忆(复用记忆详情「补传照片」那条路,
 *     lib/portal/local-image-store,本机存不上传);
 *   · 文本类文件(.txt/.md/.csv/.json…)→ 正文读进 rawInput(这样能被本地检索搜到);
 *   · 其余(pdf/docx/xlsx/zip…)→ lib/portal/local-file-store 原样存 Blob。
 * 不按类型白名单收,按体积设限 —— 白名单永远会漏掉某个「常见类型」。
 */
import { useRef, useState, type RefObject } from 'react';
import { IconMic, IconPlus } from '../icons';
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
  /** 上传落库。由 TodayFeed 提供(它才知道怎么建节点);没给就不显示「+」。 */
  onFiles?: (files: File[]) => Promise<void>;
}

/** 输入框随字数长高(和成长页文本框同一套手感)。 */
function growJot(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 8 * 16)}px`;
}

/**
 * 不限类型 —— 用户要的是「常见文件类型都能收」,而白名单永远会漏掉某一个。
 * 拦截改在体积上(见 local-file-store 的 MAX_FILE_BYTES),那才是真正的约束。
 */
export const CAPTURE_ACCEPT = '';

export default function CaptureBar(capture: CaptureBarProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function take(files: File[]) {
    if (!files.length || !capture.onFiles) return;
    setBusy(true); setErr('');
    try {
      await capture.onFiles(files);
    } catch (e) {
      // 红线:每个 async 动作都要有显式失败态,不许静默回 idle。
      setErr(e instanceof Error && e.message ? e.message : L(dict, '没存进去,再试一次。', 'Could not save — try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`nesio-tl-capture nesio-tl-capture--top${capture.recording ? ' nesio-tl-capture--rec' : ''}${capture.value.trim() ? ' nesio-tl-capture--filled' : ''}`}>
      <form className="nesio-tl-capture-form" onSubmit={(e) => { e.preventDefault(); capture.onSubmit(); }}>
        <div className="nesio-tl-capture-pill">
          {capture.onFiles && (
            <>
              <button
                type="button"
                className="nesio-tl-capture-plus"
                aria-label={L(dict, '加图片或文件', 'Add a photo or file')}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <span className="nesio-tl-capture-spin" aria-hidden /> : <IconPlus size={16} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                {...(CAPTURE_ACCEPT ? { accept: CAPTURE_ACCEPT } : {})}
                multiple
                hidden
                // ⚠️ 先快照成数组再清 value:input.value = '' 会把 FileList 一起清空,
                //    先清后读拿到的是空表,表现是「点了没反应、也不报错」。踩过。
                onChange={(e) => { const picked = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; void take(picked); }}
              />
            </>
          )}

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
            placeholder={L(dict, '问一问、找一找,或记一下…', 'Ask, find, or jot…')}
          />

          {/* 填了字 → 右边那枚圆钮从「话筒」变「记下」。同一个位置,不再多摆一个按钮。 */}
          {capture.value.trim() ? (
            <button type="submit" className="nesio-tl-capture-send" aria-label={L(dict, '记下', 'Jot')}>↑</button>
          ) : (
            <button
              type="button"
              className="nesio-tl-capture-mic"
              aria-label={capture.recording ? L(dict, '说完了,点击保存', 'Done — tap to save') : L(dict, '说一句', 'Say something')}
              onClick={capture.onMic}
            >
              <IconMic size={15} />
            </button>
          )}
        </div>
      </form>

      {err && (
        <p className="nesio-tl-capture-err" role="alert">
          {err}
          <button type="button" className="nesio-tl-capture-retry" onClick={() => fileRef.current?.click()}>
            {L(dict, '重试', 'Retry')}
          </button>
        </p>
      )}
    </div>
  );
}
