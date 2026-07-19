'use client';

/**
 * MontageTab — 洞察「小剧场 · 想试 · 想分享」(artifact 0119784e)。
 * 三根钉子:① 惊喜首片(送你的第一部,零操作/免费/自动拍好你快忘了的真实一刻)
 * ② 落差揭晓(播放先亮你写的原话 → 再放真视频 → 落一句「说中你」的话)
 * ③ 分享卡(念念水印 + 邀请,分享=拉新)。Pro 额度/分享此版为 UI(真实计费/外链留后续)。
 * 走 app 主题 token + 统一 --nm-ease;短片仍在 Lab 端生成,这里是它的家与入口。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadMontages, deleteMontage, KIND_LABEL, DEMO_MONTAGES, MONTHLY_PRO_QUOTA, type VideoMontage } from '@/lib/portal/video-montage';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const PlayIcon = () => <svg viewBox="0 0 24 24" aria-hidden><path d="M7 5l12 7-12 7z" /></svg>;

export default function MontageTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [items, setItems] = useState<VideoMontage[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [playing, setPlaying] = useState<VideoMontage | null>(null);
  const [phase, setPhase] = useState<'intro' | 'playing'>('intro');
  const [feelOn, setFeelOn] = useState(false);
  const [sharing, setSharing] = useState<VideoMontage | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    const real = loadMontages();
    if (real.length) { setItems(real); setIsDemo(false); }
    else { setItems(DEMO_MONTAGES); setIsDemo(true); }
  };
  useEffect(() => { refresh(); }, []);

  // 落差揭晓:先亮原话(intro ~1.9s)→ 放真视频(playing);feel 结尾句延迟浮现再淡出
  useEffect(() => {
    if (!playing) { setPhase('intro'); setFeelOn(false); return; }
    setPhase('intro'); setFeelOn(false);
    const t = setTimeout(() => setPhase('playing'), 1900);
    return () => clearTimeout(t);
  }, [playing]);
  useEffect(() => {
    if (phase !== 'playing') return;
    const a = setTimeout(() => setFeelOn(true), 700);
    const b = setTimeout(() => setFeelOn(false), 5200);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [phase]);

  function showToast(t: string) {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }
  function goFullscreen() {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitRequestFullscreen?: () => void }) | null;
    if (!v) return;
    try {
      if (typeof v.requestFullscreen === 'function') void v.requestFullscreen();
      else if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen();
      else if (typeof v.webkitRequestFullscreen === 'function') v.webkitRequestFullscreen();
    } catch { /* 非用户手势/不支持:静默 */ }
  }
  function removeFilm(m: VideoMontage) {
    deleteMontage(m.id); setPlaying(null); refresh();
  }

  const fmtDur = (s: number) => `0:${String(s).padStart(2, '0')}`;
  const badgeText = (m: VideoMontage) => m.gift
    ? `${L(dict, KIND_LABEL[m.kind].zh, KIND_LABEL[m.kind].en)} · ${L(dict, '送你的', 'a gift')}`
    : `${L(dict, KIND_LABEL[m.kind].zh, KIND_LABEL[m.kind].en)} · ${m.tier === 'pro' ? 'Pro' : L(dict, '免费', 'Free')}`;

  const gift = items.find((m) => m.gift) ?? items[0];
  const rest = items.filter((m) => m !== gift);

  const Poster = ({ m }: { m: VideoMontage }) => (
    <div className="nm-poster" role="button" tabIndex={0} style={m.poster ? { backgroundImage: `url(${m.poster})` } : undefined}
      onClick={() => m.videoUrl && setPlaying(m)}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && m.videoUrl) { e.preventDefault(); setPlaying(m); } }}
      aria-label={L(dict, `播放 ${m.title}`, `Play ${m.title}`)}>
      <span className={`kind${m.tier === 'pro' ? ' pro' : ''}`}>{badgeText(m)}</span>
      <span className="dur">{fmtDur(m.durationSec)}</span>
      <span className="play"><PlayIcon /></span>
      <span className="sh" />
      <span className="txt">
        <span className="t" style={{ display: 'block' }}>{m.title}</span>
        <span className="s" style={{ display: 'block' }}>{m.storyLine}</span>
      </span>
    </div>
  );

  return (
    <div className="nesio-montage">
      <div className="nm-hd">
        <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2" /></svg>
        <h1>{L(dict, '小剧场', 'Short films')}</h1>
      </div>
      <p className="nm-sub">{L(dict, '你的记忆,偶尔变成一小段可以看的东西', 'Your memories, now and then, become something to watch')}</p>

      {/* ── 送你的第一部:惊喜首片 ── */}
      {gift && (
        <>
          <div className="nm-sec"><span className="l">{L(dict, '送你的第一部', 'Your first film')}</span><span className="r">{L(dict, '已经拍好了 · 免费', 'Already made · free')}</span></div>
          <div className="nm-gift">
            <p className="gh">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7S9 2 6.5 4 9 7 12 7zM12 7s3-5 5.5-3S15 7 12 7z" /></svg>
              {L(dict, '不用你做任何事 —— 念念翻了翻你的记录,悄悄拍了一部', 'You did nothing — Nessa looked through your notes and quietly made one')}
            </p>
            <Poster m={gift} />
            {gift.sourceNote && (
              <p className="nm-how">
                {L(dict, '怎么做到的?用你 ', 'How? From your ')}<b>{gift.sourceNote}</b>{L(dict, '。你没选、没剪、没写脚本 —— 它替你挑了这个你快忘了的下午。', '. You didn’t pick, cut, or script it.')}
                <b>{L(dict, '这就是别的 App 做不到的:它认识你的记忆。', ' What no other app can do: it knows your memories.')}</b>
              </p>
            )}
          </div>

          <div className="nm-quota">
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <div>
              <b>{L(dict, '《你的一周》', '“Your week”')}</b>{L(dict, '每周一自动到(照片拼贴,免费)。把某段记忆拍成 ', ' arrives every Monday (free). Turn a memory into a ')}<b>{L(dict, '厚涂动漫短片', 'painted anime short')}</b>{L(dict, '?本月还剩 ', '? ')}<b>{MONTHLY_PRO_QUOTA}</b>{L(dict, ' 次(Pro)—— 稀有的礼物,不是随手刷的。', ' left this month (Pro) — a rare gift, not an endless feed.')}
            </div>
          </div>
          <button type="button" className="nm-make" onClick={() => showToast(L(dict, '挑好记忆,送去后台拍了 · 几分钟后回到片库', 'Picked — sent to render · back in your library in a few minutes'))}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" /></svg>{L(dict, '把一段记忆拍成短片', 'Turn a memory into a film')}
          </button>
        </>
      )}

      {/* ── 片库 ── */}
      <div className="nm-gap" />
      <div className="nm-sec"><span className="l">{L(dict, '片库', 'Library')}</span><span className="r">{L(dict, '都在本机 · 只有你能看到', 'On your device · only you')}</span></div>
      {rest.length > 0 ? (
        <div className="nm-grid2">{rest.map((m) => <Poster key={m.id} m={m} />)}</div>
      ) : (
        <div className="nm-empty">{L(dict, '还只有送你的第一部 —— 拍一部,这里就会多一格。', 'Just your first film so far — make one and this shelf fills up.')}</div>
      )}
      {isDemo && <p className="nm-sub" style={{ margin: '11px 0 0 0' }}>{L(dict, '下面是示例 —— 你的短片会从真实记忆生成后出现在这里。', 'Examples — your own films appear here once generated from real memories.')}</p>}

      <div className="nm-privacy">
        <svg viewBox="0 0 24 24" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        <div>{L(dict, '都在本机生成 · 只有你能看到 · ', 'Rendered on your device · only you can see them · ')}<b>{L(dict, '分享了才出门', 'shared only if you share')}</b>{L(dict, '(每条链接只这一片,可随时收回)', ' (each link is just this one film, revocable anytime)')}</div>
      </div>

      {/* ── 落差揭晓播放器(NesioSheet·Radix 居中,稳稳叠在洞察抽屉之上,不再手写 portal 漏手势)── */}
      <NesioSheet variant="center" card={false} dismissible open={playing !== null}
        onOpenChange={(o) => { if (!o) setPlaying(null); }} ariaLabel={playing?.title ?? L(dict, '播放', 'Play')}>
        {playing && (
          <div className="nesio-montage nm-cinema" onClick={() => setPlaying(null)}>
          <div className="nm-player" onClick={(e) => e.stopPropagation()}>
            {phase === 'intro' ? (
              <div className="nm-screen" style={playing.poster ? { backgroundImage: `url(${playing.poster})` } : undefined}>
                <p className="note">「{playing.sourceNote || playing.storyLine}」</p>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <video ref={videoRef} src={playing.videoUrl} controls autoPlay playsInline className="nm-video" />
                {playing.feel && <div className={`nm-feel${feelOn ? ' on' : ''}`}>{playing.feel}</div>}
              </div>
            )}
            <p className="nm-stage">{phase === 'intro' ? L(dict, '先给你看你写下的那句…', 'First, the line you wrote…') : L(dict, '…再看它变成的样子', '…now watch it become this')}</p>
            <div className="nm-prow">
              <button type="button" className="pri" onClick={() => { setSharing(playing); setPlaying(null); }}>{L(dict, '分享这一片', 'Share this')}</button>
              <button type="button" onClick={goFullscreen}>{L(dict, '全屏', 'Fullscreen')}</button>
              {!isDemo && <button type="button" onClick={() => removeFilm(playing)}>{L(dict, '删除', 'Delete')}</button>}
              <button type="button" onClick={() => setPlaying(null)}>{L(dict, '收起', 'Close')}</button>
            </div>
          </div>
          </div>
        )}
      </NesioSheet>

      {/* ── 分享卡(病毒单元)── */}
      <NesioSheet variant="center" card={false} dismissible open={sharing !== null}
        onOpenChange={(o) => { if (!o) setSharing(null); }} ariaLabel={L(dict, '分享卡', 'Share card')}>
        {sharing && (
          <div className="nesio-montage nm-cinema" onClick={() => setSharing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="nm-sharecard">
              <div className="top" style={sharing.poster ? { backgroundImage: `url(${sharing.poster})` } : undefined}>
                <div className="sh" />
                <div className="fl">{sharing.feel || sharing.storyLine}</div>
              </div>
              <div className="bot">
                <div className="brand"><span className="dot" />{L(dict, '念念 · Nesio 小剧场', 'Nessa · Nesio Films')}</div>
                <p className="invite">{L(dict, '你也有这样一个下午 —— ', 'You have an afternoon like this too — ')}<b>{L(dict, '让念念拍给你看 →', 'let Nessa film it →')}</b></p>
              </div>
            </div>
            <div className="nm-sharebtns">
              <button type="button" className="pri" onClick={() => { showToast(L(dict, '已复制分享卡 · 可发朋友圈 / IG / 短视频', 'Share card copied · post it anywhere')); setSharing(null); }}>{L(dict, '保存 / 发出去', 'Save / share')}</button>
              <button type="button" onClick={() => setSharing(null)}>{L(dict, '再想想', 'Maybe later')}</button>
            </div>
            <p className="nm-shareprivacy">{L(dict, '这一条链接只这一片,别人看不到你其它记忆,你随时能收回。', 'This link is just this one film — no other memories, revocable anytime.')}</p>
          </div>
          </div>
        )}
      </NesioSheet>

      {toast && typeof document !== 'undefined' && createPortal(<div className="nm-toast">{toast}</div>, document.body)}
    </div>
  );
}
