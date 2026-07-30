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
import { loadMontages, deleteMontage, saveMontage, buildMemoryMontage, KIND_LABEL, DEMO_MONTAGES, SLIDE_MS, type VideoMontage } from '@/lib/portal/video-montage';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { getLocalImage } from '@/lib/portal/local-image-store';
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
  // ── 记忆短片(Bug4 图21:按钮从「弹个 toast」变成真的做出一部片子)──
  // 素材全部来自本机记忆节点里的照片,不上传、不调 AI。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pool, setPool] = useState<Array<{ nodeId: string; assetId: string; caption?: string; createdAt: string; name: string }>>([]);
  const [picked, setPicked] = useState<string[]>([]);            // assetId 顺序 = 播放顺序
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // assetId → objectURL
  const [slideIdx, setSlideIdx] = useState(0);                    // 幻灯播放到第几张

  /** 本机记忆里所有带图的节点,新的在前。一个节点取它的全部图片资产。 */
  function loadPool() {
    const rows: Array<{ nodeId: string; assetId: string; caption?: string; createdAt: string; name: string }> = [];
    for (const n of getLifeGraph()) {
      for (const a of n.assets || []) {
        if (a.kind !== 'image' || !a.local) continue;
        rows.push({
          nodeId: n.id,
          assetId: a.id,
          // 字幕只用**用户自己写下的**:原话优先,其次节点名。不生成、不改写。
          caption: (n.rawInput || '').trim() || n.name,
          createdAt: a.createdAt || n.createdAt,
          name: n.name,
        });
      }
    }
    rows.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
    setPool(rows.slice(0, 60));
  }

  const refresh = () => {
    const real = loadMontages();
    if (real.length) { setItems(real); setIsDemo(false); }
    else { setItems(DEMO_MONTAGES); setIsDemo(true); }
  };
  useEffect(() => { refresh(); }, []);

  // 落差揭晓:原话叠在视频上(~0.8s),视频在同一用户手势内 muted 起播,
  // 避免 1.9s 后 autoPlay 手势过期 → 壳里点了没声/没画。
  useEffect(() => {
    if (!playing) { setPhase('intro'); setFeelOn(false); return; }
    setPhase('intro'); setFeelOn(false);
    const t = setTimeout(() => setPhase('playing'), 800);
    return () => clearTimeout(t);
  }, [playing]);
  useEffect(() => {
    if (phase !== 'playing') return;
    const v = videoRef.current;
    if (v) {
      try {
        v.muted = false;
        const p = v.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => showToast(L(dict, '没播起来 — 点一下画面上的播放键,或用「全屏」', 'Didn’t start — tap play on the video, or Fullscreen')));
        }
      } catch {
        showToast(L(dict, '没播起来 — 点一下画面上的播放键', 'Didn’t start — tap play on the video'));
      }
    }
    const a = setTimeout(() => setFeelOn(true), 700);
    const b = setTimeout(() => setFeelOn(false), 5200);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [phase, dict]);

  function openFilm(m: VideoMontage) {
    // 幻灯片(本机记忆短片)没有 videoUrl,一样能播 —— 这里放行。
    if (!m.videoUrl && !m.slides?.length) return;
    setSlideIdx(0);
    setPlaying(m);
    if (!m.videoUrl) return; // 幻灯没有 <video>,不用抢全屏
    // 同一次点击里尽量进系统全屏播放器(iOS WKWebView 上更接近「系统播放器」)。
    requestAnimationFrame(() => {
      const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      if (!v) return;
      try {
        v.muted = true;
        void v.play()?.catch(() => {});
        if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen();
      } catch { /* 不支持全屏:留内嵌播放 */ }
    });
  }

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

  /**
   * 本机图片按需读出来(picker 全量 / 播放中的全部帧 / 片库封面各取第一张)。
   * objectURL 在组件卸载时统一 revoke —— 不 revoke 会一直占着 blob。
   */
  const wantedAssets = [
    ...(pickerOpen ? pool.map((p) => p.assetId) : []),
    ...(playing?.slides || []).map((s) => s.assetId),
    ...items.map((m) => m.slides?.[0]?.assetId).filter((x): x is string => Boolean(x)),
  ];
  const wantedKey = wantedAssets.join(',');
  const madeUrls = useRef<string[]>([]);
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const id of wantedKey ? wantedKey.split(',') : []) {
        if (!alive) return;
        if (thumbsRef.current[id]) continue;
        const url = await getLocalImage(id);
        if (!alive || !url) continue;
        madeUrls.current.push(url);
        setThumbs((t) => ({ ...t, [id]: url }));
      }
    })();
    return () => { alive = false; };
    // thumbs 故意不进依赖:每读一张它就变一次,进依赖这个 effect 会自激。
    // 用 ref 读最新值,依赖只留「要哪些图」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);
  useEffect(() => () => { madeUrls.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* 已释放 */ } }); }, []);

  /** 幻灯自动前进:播到最后一张停住(不循环 —— 循环会让人不知道什么时候结束)。 */
  useEffect(() => {
    const slides = playing?.slides;
    if (!slides?.length || phase !== 'playing') { setSlideIdx(0); return; }
    if (slideIdx >= slides.length - 1) return;
    const t = setTimeout(() => setSlideIdx((i) => i + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [playing, phase, slideIdx]);

  function openPicker() {
    loadPool();
    setPicked([]);
    setPickerOpen(true);
  }

  function makeFilm() {
    const rows = picked
      .map((id) => pool.find((p) => p.assetId === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const film = buildMemoryMontage(rows, {
      id: `mm-${Date.now()}`,
      title: L(dict, '记忆短片', 'Memory film'),
    });
    if (!film) { showToast(L(dict, '先选几张照片', 'Pick a few photos first')); return; }
    if (!saveMontage(film)) {
      showToast(L(dict, '没能存下来 —— 本机空间满了,清一些再试', 'Could not save — device storage is full'));
      return;
    }
    setPickerOpen(false);
    refresh();
    showToast(L(dict, `拍好了 · ${film.slides!.length} 张 · ${film.durationSec} 秒`, `Done · ${film.slides!.length} shots · ${film.durationSec}s`));
  }

  const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
  // Bug4 图21:角标只说这是什么片 —— 「送你的 / 免费 / Pro」全部删掉。
  // 用户不需要在自己的片库里被反复提醒哪部是买来的。
  const badgeText = (m: VideoMontage) => L(dict, KIND_LABEL[m.kind].zh, KIND_LABEL[m.kind].en);
  const coverOf = (m: VideoMontage) => m.poster || (m.slides?.[0] ? thumbs[m.slides[0].assetId] : '') || '';

  const gift = items.find((m) => m.gift) ?? items[0];
  const rest = items.filter((m) => m !== gift);

  const Poster = ({ m }: { m: VideoMontage }) => {
    const cover = coverOf(m);
    return (
    <div className="nm-poster" role="button" tabIndex={0} style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      onClick={() => openFilm(m)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilm(m); } }}
      aria-label={L(dict, `播放 ${m.title}`, `Play ${m.title}`)}>
      <span className="kind">{badgeText(m)}</span>
      <span className="dur">{fmtDur(m.durationSec)}</span>
      <span className="play"><PlayIcon /></span>
      <span className="sh" />
      <span className="txt">
        <span className="t" style={{ display: 'block' }}>{m.title}</span>
        <span className="s" style={{ display: 'block' }}>{m.storyLine}</span>
      </span>
    </div>
    );
  };

  return (
    <div className="nesio-montage">
      {/* 2026-07-28 UI 精修(标注 图27):页内再写一遍「小剧场」+ 一句副标题划掉 ——
          顶栏已经写着「剧场」,进来先看见的应该是那部片子,不是又一层标题。 */}

      {/* ── 首片 ── */}
      {gift && (
        <>
          {/* Bug4 图21:三段解说词全删 —— 导语(「不用你做任何事…」)、
              「怎么做到的?」那一整段自夸、以及角标里的「送你的」。
              片子本身就是说明书;它旁边不该站着一个替它讲话的人。 */}
          <div className="nm-gift">
            <Poster m={gift} />
          </div>

          {/* Bug4 图21:按钮改叫「记忆短片」,「还剩 N 次」删掉。
              功能也从「弹个 toast」换成真的能做出一部片子 —— 挑本机记忆里的照片,
              就地排成一段会自己走的画面,不上传、不排队、不等后端。 */}
          <button type="button" className="nm-make" onClick={openPicker}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            {L(dict, '记忆短片', 'Memory film')}
          </button>
        </>
      )}

      {/* ── 片库 ── */}
      <div className="nm-gap" />
      {/* 图21:「都在本机 · 只有你能看到」删掉 —— 整个 App 都在本机,不必每屏声明一次。 */}
      <div className="nm-sec"><span className="l">{L(dict, '片库', 'Library')}</span></div>
      {rest.length > 0 ? (
        <div className="nm-grid2">{rest.map((m) => <Poster key={m.id} m={m} />)}</div>
      ) : (
        <div className="nm-empty">{L(dict, '拍一部,这里就会多一格。', 'Make one and this shelf fills up.')}</div>
      )}
      {/* 图20:「下面是示例 —— 你的短片会…」那句删掉。示例卡自己已经写着示例,
          而且这句话印在网格**下面**,说的却是上面的东西。 */}

      {/* ── 落差揭晓播放器(NesioSheet·Radix 居中,稳稳叠在洞察抽屉之上,不再手写 portal 漏手势)── */}
      <NesioSheet variant="center" card={false} dismissible open={playing !== null}
        onOpenChange={(o) => { if (!o) setPlaying(null); }} ariaLabel={playing?.title ?? L(dict, '播放', 'Play')}>
        {playing && (
          <div className="nesio-montage nm-cinema" onClick={() => setPlaying(null)}>
          <div className="nm-player" onClick={(e) => e.stopPropagation()}>
            <div style={{ position: 'relative' }}>
              {playing.slides?.length ? (
                // 本机记忆短片:一张一张自己走,点画面手动翻页。没有 <video>,也就没有全屏。
                (() => {
                  const s = playing.slides[Math.min(slideIdx, playing.slides.length - 1)];
                  const url = thumbs[s.assetId];
                  return (
                    <div
                      className="nm-screen nm-slides"
                      role="button"
                      tabIndex={0}
                      style={url ? { backgroundImage: `url(${url})` } : undefined}
                      onClick={() => setSlideIdx((i) => (i + 1) % playing.slides!.length)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSlideIdx((i) => (i + 1) % playing.slides!.length); } }}
                      aria-label={L(dict, '下一张', 'Next')}
                    >
                      {s.caption && <p className="note">「{s.caption}」</p>}
                      <span className="nm-slide-n">{Math.min(slideIdx, playing.slides.length - 1) + 1}/{playing.slides.length}</span>
                    </div>
                  );
                })()
              ) : (
                <>
                  <video
                    ref={videoRef}
                    src={playing.videoUrl}
                    controls={phase === 'playing'}
                    playsInline
                    muted={phase === 'intro'}
                    autoPlay
                    className="nm-video"
                    style={phase === 'intro' ? { position: 'absolute', inset: 0, opacity: 0 } : undefined}
                  />
                  {phase === 'intro' && (
                    <div className="nm-screen" style={playing.poster ? { backgroundImage: `url(${playing.poster})` } : undefined}>
                      <p className="note">「{playing.sourceNote || playing.storyLine}」</p>
                    </div>
                  )}
                  {phase === 'playing' && playing.feel && <div className={`nm-feel${feelOn ? ' on' : ''}`}>{playing.feel}</div>}
                </>
              )}
            </div>
            {!playing.slides?.length && (
              <p className="nm-stage">{phase === 'intro' ? L(dict, '先给你看你写下的那句…', 'First, the line you wrote…') : L(dict, '…再看它变成的样子', '…now watch it become this')}</p>
            )}
            <div className="nm-prow">
              <button type="button" className="pri" onClick={() => { setSharing(playing); setPlaying(null); }}>{L(dict, '分享这一片', 'Share this')}</button>
              {!playing.slides?.length && <button type="button" onClick={goFullscreen}>{L(dict, '全屏', 'Fullscreen')}</button>}
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
              <div className="top" style={coverOf(sharing) ? { backgroundImage: `url(${coverOf(sharing)})` } : undefined}>
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

      {/* ── 挑素材(Bug4 图21:按钮的真实功能)── */}
      <NesioSheet variant="bottom" card={false} open={pickerOpen} elevated
        onOpenChange={(o) => { if (!o) setPickerOpen(false); }} ariaLabel={L(dict, '挑照片', 'Pick photos')}>
        <div className="nm-pick">
          <div className="nm-pick-head">
            <span className="t">{L(dict, '挑几张,按你点的顺序播', 'Pick a few — they play in the order you tap')}</span>
            <span className="n">{picked.length}</span>
          </div>
          {pool.length === 0 ? (
            <p className="nm-empty">{L(dict, '本机记忆里还没有照片 —— 先记一条带图的。', 'No photos in your memories yet — save one with a picture first.')}</p>
          ) : (
            <div className="nm-pick-grid">
              {pool.map((p) => {
                const at = picked.indexOf(p.assetId);
                return (
                  <button
                    key={p.assetId}
                    type="button"
                    className={`nm-pick-cell${at >= 0 ? ' on' : ''}`}
                    style={thumbs[p.assetId] ? { backgroundImage: `url(${thumbs[p.assetId]})` } : undefined}
                    onClick={() => setPicked((cur) => cur.includes(p.assetId) ? cur.filter((x) => x !== p.assetId) : [...cur, p.assetId])}
                    aria-pressed={at >= 0}
                    title={p.name}
                  >
                    {at >= 0 && <span className="ord">{at + 1}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="nm-pick-foot">
            <button type="button" onClick={() => setPickerOpen(false)}>{L(dict, '稍后', 'Later')}</button>
            <button type="button" className="pri" disabled={picked.length === 0} onClick={makeFilm}>
              {L(dict, picked.length ? `拍成 ${Math.round((picked.length * SLIDE_MS) / 1000)} 秒` : '拍成短片', picked.length ? `Make ${Math.round((picked.length * SLIDE_MS) / 1000)}s` : 'Make it')}
            </button>
          </div>
        </div>
      </NesioSheet>

      {toast && typeof document !== 'undefined' && createPortal(<div className="nm-toast">{toast}</div>, document.body)}
    </div>
  );
}
