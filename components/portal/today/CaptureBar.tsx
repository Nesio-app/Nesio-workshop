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
import { useMemo, useRef, useState, type RefObject } from 'react';
import { formatWhen, parseWhen, type RepeatGuess } from '@/lib/portal/when-parse';
import { repeatLabel } from '@/lib/portal/schedule-reminders';
import { IconMic, IconPlus, IconSearch } from '../icons';
import { nesioBrandAssets } from '@/lib/portal/nesio-design-system-assets.mjs';
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
   * bug3 p42:话筒听不了时的可见失败态。原来这几种情况会去开「说一句」sheet ——
   * iOS PWA 上 SpeechRecognition 根本不存在,于是点话筒每次都跳那张 sheet(标注要去掉)。
   * 现在不换页,就在输入条下面说清楚,人可以直接打字。
   */
  micError?: string;
  onDismissMicError?: () => void;
  /**
   * #25:恢复出来的草稿如果不是今天留下的,在这儿说清楚是哪天的 ——
   * 否则几周前语音听岔的半句看起来就像用户刚打的,而他根本不记得打过。
   */
  staleNote?: string;
  /**
   * 三合一的另外两条路(2026-07-31)。**都是显式的**:用户点了才走。
   *
   * 为什么不自动判意图 —— intent-router 那套猜测的代价是不对称的:
   * 把「问」猜成「记」只是多一条垃圾记录,把「记」猜成「问」是**你要存的东西没存下来**,
   * 而你以为存了。所以默认永远是记一笔(回车/↑ 行为一个字没改),另外两条摆在下面。
   */
  onSearch?: (q: string) => void;
  onAsk?: (q: string) => void;
  /** 认出时间时的「设成提醒」。没认出来这一条不出现 —— 认不出就不提议。 */
  onRemind?: (at: string, title: string, repeat?: RepeatGuess) => void;
  /** 刚设成提醒之后的那条回执(带撤销)。由上层给,这里只负责显示。 */
  remindReceipt?: { text: string; onUndo: () => void } | null;
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

  const typed = capture.value.trim();
  // 认出时间才提议「设成提醒」。认不出就**不出这一条** —— 宁可让人自己去日程页加,
  // 也不给他一个设在他没说过的时刻上的提醒(那种他不会发现,直到错过那件事)。
  const when = useMemo(() => (typed.length >= 2 ? parseWhen(typed) : null), [typed]);
  // 两个字以下不打扰:打第一个字就弹出三行动作,比没有更烦。
  const showActions = typed.length >= 2 && !!(capture.onSearch || capture.onAsk || capture.onRemind);
  // 「每天 / 每周三」这类频率也要摆在按钮上 —— 用户看不见系统读成了什么,
  // 就只能等到明天发现它天天响才知道。
  const whenRepeat = when?.repeat ? repeatLabel(when.repeat, dict) : '';

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
            onChange={(e) => { capture.onChange(e.target.value); growJot(e.currentTarget); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture.onSubmit(); } }}
            onFocus={(e) => {
              // 聚焦后等键盘升起,把输入框滚到刚好可见(nearest,不留大空隙)。
              const el = e.currentTarget;
              setTimeout(() => { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ } }, 320);
            }}
            placeholder=""
          />

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
              className={`nesio-tl-capture-mic${capture.recording ? ' is-listening' : ''}`}
              aria-label={capture.recording ? L(dict, '正在听,点一下停下来', 'Listening — tap to stop') : L(dict, '说一句', 'Say something')}
              aria-pressed={capture.recording}
              onClick={capture.onMic}
            >
              {/*
               * 录音中换符号(2026-07-31,用户实测 图5:「开始录音的话,符号应该改变」)。
               *
               * 原来不管在不在听都是同一枚话筒 —— 屏幕上唯一的线索是顶部系统那颗
               * 橙点(还得你正好看见)。于是「它到底在不在听」只能靠猜,
               * 而猜错的代价是对着手机说完一整句,发现一个字都没进去。
               *
               * 听的时候给三根跳动的竖条(和一个「停」的语义):动的东西才代表在进行中,
               * 静态图标换个颜色说不清「现在」这件事。
               */}
              {capture.recording ? (
                <span className="nesio-mic-wave" aria-hidden>
                  <i /><i /><i />
                </span>
              ) : (
                <IconMic size={15} />
              )}
            </button>
          )}
        </div>
      </form>

      {capture.staleNote && capture.value.trim() && (
        <p className="nesio-tl-capture-stale">{capture.staleNote}</p>
      )}

      {/* 设成提醒之后的回执。**带撤销** —— 一个自动认出来的时间总有认错的时候,
          而「已经建好了、你自己去日程页找出来删」不是一个能接受的收场。 */}
      {capture.remindReceipt && (
        <p className="nesio-tl-capture-receipt" role="status">
          {capture.remindReceipt.text}
          <button type="button" className="nesio-tl-capture-retry" onClick={capture.remindReceipt.onUndo}>
            {L(dict, '撤销', 'Undo')}
          </button>
        </p>
      )}

      {/* ── 另外两条路(外加认出时间时的第三条)──────────────────────────
          全部显式:点了才走。默认(回车/↑)永远是记一笔。 */}
      {showActions && (
        <div className="nesio-cap-actions">
          {when && capture.onRemind && (
            <button
              type="button"
              className="nesio-cap-action is-when"
              onClick={() => capture.onRemind?.(when.at, when.title, when.repeat)}
            >
              <span className="nesio-cap-action-main">
                {L(dict,
                  `设成提醒 · ${formatWhen(when.at)}${whenRepeat ? ` · ${whenRepeat}` : ''}`,
                  `Set a reminder · ${formatWhen(when.at)}${whenRepeat ? ` · ${whenRepeat}` : ''}`)}
              </span>
              {/* 时间是默认填的就**说出来**。只说了「明天」却装作用户定过九点,
                  是这一整条路上最容易骗到人的地方。 */}
              {!when.hasExplicitTime && (
                <span className="nesio-cap-action-sub">
                  {L(dict, '你没说几点,先按早上 9:00 · 可以改', 'No time given — defaulting to 9:00 AM · editable')}
                </span>
              )}
            </button>
          )}
          {/* 两枚图标就够 —— 原来是两整行,把你刚打的那句话**又重复了两遍**
              (输入框一遍、两行各一遍)。要找什么、要问什么,输入框里写着呢。
              文字留在 aria-label 上,读屏用户不受影响。 */}
          {(capture.onSearch || capture.onAsk) && (
            <div className="nesio-cap-icons">
              {capture.onSearch && (
                <button
                  type="button"
                  className="nesio-cap-icon"
                  aria-label={L(dict, `在我的记忆里找「${typed.slice(0, 18)}」`, `Search my memory for “${typed.slice(0, 18)}”`)}
                  title={L(dict, '在我的记忆里找', 'Search my memory')}
                  onClick={() => capture.onSearch?.(typed)}
                ><IconSearch size={18} /></button>
              )}
              {capture.onAsk && (
                <button
                  type="button"
                  className="nesio-cap-icon"
                  aria-label={L(dict, `问念念「${typed.slice(0, 18)}」`, `Ask Nessa “${typed.slice(0, 18)}”`)}
                  title={L(dict, '问念念', 'Ask Nessa')}
                  onClick={() => capture.onAsk?.(typed)}
                >
                  {/* 「问念念」用**品牌那颗晶体**,不自己画一个星星 ——
                      首页左上角、PWA 图标用的都是它,同一个东西就该长同一个样。 */}
                  <img src={nesioBrandAssets.crystal} alt="" width={18} height={18} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
