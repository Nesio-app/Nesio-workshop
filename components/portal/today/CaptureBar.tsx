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
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import MentionPicker from '../MentionPicker';
import { activeMentionQuery, applyMention, mentionCandidatesFromGraph, type MentionCandidate, type PendingMention } from '@/lib/portal/mention';
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
  /**
   * 打 @ 选中了一条记忆。**只是记下待结算**,不是当场就连 ——
   * 文本是纯的,你插了又删掉就不该连。真正结算在提交时(`settleMentions`)。
   */
  onMention?: (m: PendingMention) => void;
  /**
   * bug3 p42:话筒听不了时的可见失败态。原来这几种情况会去开「说一句」sheet ——
   * iOS PWA 上 SpeechRecognition 根本不存在,于是点话筒每次都跳那张 sheet(标注要去掉)。
   * 现在不换页,就在输入条下面说清楚,人可以直接打字。
   */
  micError?: string;
  onDismissMicError?: () => void;
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

  // ── @提及:打字的时候顺手连一条已有的记忆 ──────────────────────────────────
  // 为什么值得做:Notion/Roam 的图之所以密,是因为**边写边连**。我们原来要进详情页
  // 点关联再搜再挑,四步摩擦,所以自己建的边几乎没有。
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [cands, setCands] = useState<MentionCandidate[]>([]);

  const syncMention = useCallback((text: string, caret: number) => {
    const q = activeMentionQuery(text, caret);
    setMention(q);
    if (!q || !q.query.trim()) { setCands([]); return; }
    // 全图线性扫 —— 只在真的打了 @ 且有查询词时才扫,而且 mentionCandidatesFromGraph 内部有
    // 200 条命中上限。不做去抖是因为它比一次 setState 还快;真慢了再说。
    try { setCands(mentionCandidatesFromGraph(q.query, { max: 6 })); }
    catch { setCands([]); }
  }, []);

  const pickMention = useCallback((c: MentionCandidate) => {
    if (!mention) return;
    const el = capture.inputRef.current;
    const text = capture.value;
    const next = applyMention(text, mention, c);
    capture.onChange(next.text);
    capture.onMention?.({ id: c.id, name: c.name } as PendingMention);
    setMention(null); setCands([]);
    // 光标放到插入位之后 —— 不放的话会跳到末尾,接着打字就接错地方了
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(next.caret, next.caret); } catch { /* 老浏览器 */ }
    });
  }, [mention, capture]);

  const mentionOpen = Boolean(mention && cands.length);
  void useMemo(() => mentionOpen, [mentionOpen]);

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
                // ⚠️ 不能用 hidden(= display:none)。iOS 的 WKWebView 对**不参与布局**的
                // file input 会忽略程序化 click() —— 桌面 Chrome 照开,所以本地测不出来,
                // 装到手机上就是「点『+』完全没反应,也不报错」。visually-hidden 保留布局盒子。
                className="nesio-visually-hidden"
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
            onChange={(e) => {
              capture.onChange(e.target.value);
              growJot(e.currentTarget);
              syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            // 光标移动(点、方向键)也要重算 —— 只在 onChange 算的话,
            // 你把光标挪回一个已经打好的 @xxx 后面,候选不会出来。
            onSelect={(e) => {
              const el = e.currentTarget;
              syncMention(el.value, el.selectionStart ?? el.value.length);
            }}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              // 候选开着的时候 Enter 归它(选中候选),不能变成「记下」。
              // MentionPicker 在 capture 阶段就拦了,这里再挡一次防漏。
              if (mention && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) return;
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture.onSubmit(); }
            }}
            onFocus={(e) => {
              // 聚焦后等键盘升起,把输入框滚到刚好可见(nearest,不留大空隙)。
              const el = e.currentTarget;
              setTimeout(() => { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ } }, 320);
            }}
            placeholder=""
          />

          {mentionOpen && mention && (
            <MentionPicker items={cands} dict={dict} onPick={pickMention} onClose={() => { setMention(null); setCands([]); }} />
          )}

          {/* 清空。草稿是持久化的(没点记下就退出,下次进来还在),而在这之前**没有任何删掉它的入口** ——
              用户碰到一条自己从没打过的草稿(语音把环境音听成了字),只能一个字一个字退,
              连清 localStorage 都没用:页面还开着,React state 里那份会立刻写回去。 */}
          {capture.value.trim() && (
            <button
              type="button"
              className="nesio-tl-capture-clear"
              aria-label={L(dict, '清空', 'Clear')}
              onClick={() => { capture.onChange(''); capture.inputRef.current?.focus(); }}
            >
              ×
            </button>
          )}

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

      {capture.micError && (
        <p className="nesio-tl-capture-err" role="alert">
          {capture.micError}
          {capture.onDismissMicError && (
            <button type="button" className="nesio-tl-capture-retry" onClick={capture.onDismissMicError}>
              {L(dict, '知道了', 'Got it')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
