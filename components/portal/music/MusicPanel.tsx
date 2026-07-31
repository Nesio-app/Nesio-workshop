'use client';

/**
 * 音乐面板(2026-07-30,用户:「那就做本地歌曲,网易,歌曲加自由切换,spotify 和 apple music」)。
 *
 * 这一屏要老实交代的一件事:**四个音源不是一回事**。
 *   · 本地歌曲 / Apple Music —— Nesio 自己出声,车机上显示 Nesio;
 *   · Spotify               —— Nesio 只是遥控器,声音和车机界面都在 Spotify 那边;
 *   · 网易云                —— 没有国内出口的当下,能搜到、放不出声。
 * 所以换源不是换个下拉框那么轻:跨过这条线,用户在车里看到的东西会当场变。
 * switchNotice() 那句话就是为此存在,而且必须在**切之前**说。
 *
 * 每个源都自报「现在能不能放、差哪一步」(canPlayNow / blockedReason),
 * 不能放就不进回退链 —— 正向判据。界面上不留一个点了没反应的按钮。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  MUSIC_SOURCES, blockedReason, canPlayNow, fallbackChain, noSourceLine,
  sourceInfo, sourceName, switchNotice, type MusicSourceId,
} from '@/lib/platform/music/source-catalog';
import {
  importLocalTrack, deleteLocalTrack, loadLocalTracks, libraryHeadline,
  prettyDuration, renameLocalTrack, parseTrackName, type LocalTrack,
} from '@/lib/platform/music/local-tracks';
import { prettyBytes } from '@/lib/portal/local-file-store';
import { loadMusicPrefs, saveMusicPrefs, loadLastPlayed, saveLastPlayed, type MusicPrefs } from '@/lib/platform/music/prefs';
import { EMPTY_READINESS, fetchSpotifyStatus, localReadiness, probeReadiness, type ReadinessMap, type SpotifyStatus } from '@/lib/platform/music/readiness';
import { authorizeApple, lastAppleError } from '@/lib/platform/music/apple-client';
import { useSessionState } from '../use-session-state';
import { useLocalPlayer } from './use-local-player';
import type { RepeatMode } from '@/lib/platform/music/queue';

interface NeteaseHit { id: string; title: string; artist: string; album: string; durationSec: number }

/** 播放进度用:0 秒是**有效**位置,该显示 0:00;prettyDuration 的 --:-- 表示的是「不知道多长」。 */
const clockTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function MusicPanel() {
  // 必须过 portalLocaleToDictionaryLocale:PortalLocale 有 12 种(ja/fr/de/…),
  // 而 L() 只认 'en'。直接把 locale 丢进去,法语用户会看到中文 —— 上一轮 #24 修的
  // 正是这一类,这里不能再犯。
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // 三个远端源的探测路由都走 guardAiRoute —— 没登录一律 401。
  // 不看登录态的话,探测结果会被翻译成「Apple Music 还没配好开发者密钥」,
  // 而真实原因是「还没登录」。给错原因比不给更糟:用户会去改一个没坏的东西。
  const session = useSessionState();
  const signedOut = session.state === 'signed-out';
  const [prefs, setPrefs] = useState<MusicPrefs>(() => loadMusicPrefs());
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [readiness, setReadiness] = useState<ReadinessMap>(EMPTY_READINESS);
  const [probed, setProbed] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<{ to: MusicSourceId; notice: string } | null>(null);
  const [connectMsg, setConnectMsg] = useState('');
  // Spotify 授权回来的那一句。**不放进 spotify 那一段里** —— 用户当前停在哪个源都得看见,
  // 否则从 Spotify 跳回来,当前源还是「本地」,这句话就永远显示不出来。
  const [callbackMsg, setCallbackMsg] = useState('');
  const [neteaseQ, setNeteaseQ] = useState('');
  const [neteaseHits, setNeteaseHits] = useState<NeteaseHit[]>([]);
  const [neteaseMsg, setNeteaseMsg] = useState('');
  const [searching, setSearching] = useState(false);
  const [spotifyInfo, setSpotifyInfo] = useState<SpotifyStatus | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 随机序列的种子。挂载时定一次 —— 每次渲染重掷会让「上一首」回到一首没听过的歌。
  const seedRef = useRef(Math.floor(Math.random() * 1_000_000) + 1);

  // 「上次听到哪」只在客户端读:渲染期直接读 localStorage 会让服务端渲染出的
  // 那一帧与客户端不一致(水合告警),而且首屏会闪一下。
  const [lastId, setLastId] = useState('');
  useEffect(() => { setTracks(loadLocalTracks()); setLastId(loadLastPlayed()); }, []);
  useEffect(() => {
    let alive = true;
    // 明确未登录时不去打那三个 guard 路由 —— 每次都是 401,除了给限流器添噪音没有别的作用。
    // 'unknown'(还没问出来)照常探:那时候贸然当成未登录,已登录的用户会白等一轮。
    if (signedOut) {
      setReadiness({ ...EMPTY_READINESS, local: localReadiness() });
      setProbed(true);
      return;
    }
    probeReadiness().then((r) => { if (alive) { setReadiness(r); setProbed(true); } });
    return () => { alive = false; };
  }, [signedOut]);

  // Spotify 回调:`/?music=1&spotify=…`。每种失败都给一句**不一样**的话 ——
  // 「被拒」「来源没对上」「换令牌失败」需要的下一步动作各不相同,合成一句「连接失败」
  // 等于什么都没说。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const st = params.get('spotify');
    if (!st) return;
    const MSG: Record<string, string> = {
      connected: L(dict, 'Spotify 连上了。', 'Spotify connected.'),
      denied: L(dict, '这次没有授权 —— 随时可以再来一次。', 'Authorization was declined — you can try again anytime.'),
      state_mismatch: L(dict, '这次授权的来源没对上,为安全起见没有保存。重新连一次就好。', 'Could not verify where that came from, so nothing was saved. Please connect again.'),
      exchange_failed: L(dict, '换令牌那一步没成功,再连一次试试。', 'Token exchange did not go through — try connecting again.'),
      unconfigured: L(dict, 'Spotify 还没在服务端配好,这一步得先补上。', 'Spotify is not configured on the server yet.'),
      network: L(dict, '网络没通,这次没连上。', 'Network error — not connected.'),
    };
    setCallbackMsg(MSG[st] || L(dict, '这次没连上。', 'Not connected.'));
    params.delete('spotify');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    if (st === 'connected') void probeReadiness().then(setReadiness);
  }, [dict]);
  // 曲库变了(导入/删除),local 的 streamable 也跟着变 —— 不重探的话
  // 「刚导进第一首歌」之后界面还在说「先导几首吧」。
  useEffect(() => {
    setReadiness((r) => ({ ...r, local: { configured: true, authorized: true, streamable: tracks.length > 0 } }));
  }, [tracks.length]);

  const player = useLocalPlayer(tracks, { repeat: prefs.repeat, shuffle: prefs.shuffle, seed: seedRef.current, locale: dict });
  useEffect(() => { if (player.state.currentId) saveLastPlayed(player.state.currentId); }, [player.state.currentId]);

  const source = prefs.preferredSource;
  const info = sourceInfo(source);
  const ready = readiness[source];
  const playable = !!ready && canPlayNow(source, ready);
  const blocked = ready ? blockedReason(source, ready, dict) : '';
  const chain = useMemo(() => fallbackChain(source, readiness), [source, readiness]);
  const head = useMemo(() => libraryHeadline(tracks), [tracks]);

  const setPref = useCallback((patch: Partial<MusicPrefs>) => {
    setPrefs((p) => { const next = { ...p, ...patch }; saveMusicPrefs(next); return next; });
  }, []);

  /** 换源。跨播放模型时先把话说清楚,用户点了「知道了」再换。 */
  const requestSwitch = useCallback((to: MusicSourceId) => {
    if (to === source) return;
    const notice = switchNotice(source, to, dict);
    if (!notice) { setPref({ preferredSource: to }); return; }
    setPendingSwitch({ to, notice });
  }, [source, setPref, dict]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setImportMsg('');
    const failed: string[] = [];
    let added = 0;
    for (const f of Array.from(files)) {
      const r = await importLocalTrack(f, dict);
      if (r.ok) added += 1; else if (r.error) failed.push(r.error);
    }
    setTracks(loadLocalTracks());
    // 成功几首、哪几首没进来 —— 两边都说。只说「导入完成」会掩盖掉失败的那几首。
    setImportMsg([
      added ? L(dict, `加进来 ${added} 首。`, `Added ${added}.`) : '',
      ...failed,
    ].filter(Boolean).join(' '));
    if (fileRef.current) fileRef.current.value = '';
  }, [dict]);

  const onConnectApple = useCallback(async () => {
    setConnectMsg(L(dict, '正在连 Apple Music…', 'Connecting Apple Music…'));
    const ok = await authorizeApple();
    if (ok) {
      setConnectMsg(L(dict, 'Apple Music 连上了。', 'Apple Music connected.'));
      setReadiness(await probeReadiness());
    } else {
      // 失败必须有话说:没配密钥 / 组件没加载 / 用户取消,三种都不一样。
      setConnectMsg(lastAppleError() || L(dict, '这次没连上,再试一次或先用本地歌曲。', 'Not connected. Try again, or use local files.'));
    }
  }, [dict]);

  // 选到 Spotify 那一格时才去问详情 —— 免费/Premium 与账号名都要照实显示。
  useEffect(() => {
    if (source !== 'spotify') return;
    let alive = true;
    fetchSpotifyStatus().then((v) => { if (alive) setSpotifyInfo(v); });
    return () => { alive = false; };
  }, [source, readiness.spotify?.authorized]);

  const onSearchNetease = useCallback(async () => {
    const q = neteaseQ.trim();
    if (!q) return;
    setSearching(true);
    setNeteaseMsg('');
    try {
      const res = await fetch(`/api/portal/music/netease/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const j = await res.json() as { ok?: boolean; configured?: boolean; hits?: NeteaseHit[] };
      if (!j.configured) {
        setNeteaseHits([]);
        setNeteaseMsg(L(dict, '网易云还没接上 —— 需要一个能连到它的接口地址。', 'NetEase is not wired up yet.'));
      } else if (!j.ok) {
        setNeteaseHits([]);
        setNeteaseMsg(L(dict, '这次没搜到,过一会儿再试。', 'Search failed. Try again shortly.'));
      } else {
        setNeteaseHits(j.hits || []);
        if (!j.hits?.length) setNeteaseMsg(L(dict, '没找到这首。', 'Nothing found.'));
      }
    } catch {
      setNeteaseHits([]);
      setNeteaseMsg(L(dict, '网络没通,搜索没发出去。', 'Network error — search did not go through.'));
    } finally {
      setSearching(false);
    }
  }, [neteaseQ, dict]);

  const current = tracks.find((t) => t.id === player.state.currentId) || null;
  const resumeTrack = !current && lastId ? tracks.find((t) => t.id === lastId) || null : null;

  return (
    <div className="nesio-music">
      {/* 音源。每个 chip 自己说得清能不能放 —— 不做「灰掉但不说为什么」。 */}
      <div className="nesio-music-sources">
        {MUSIC_SOURCES.map((s) => {
          const r = readiness[s.id];
          const ok = !!r && canPlayNow(s.id, r);
          return (
            <button
              key={s.id}
              type="button"
              className={`nesio-music-src${s.id === source ? ' is-on' : ''}`}
              onClick={() => requestSwitch(s.id)}
            >
              <span className="nesio-music-src-name">{L(dict, s.zh, s.en)}</span>
              <span className={`nesio-music-src-dot${ok ? ' is-live' : ''}`} aria-hidden />
            </button>
          );
        })}
      </div>

      {/* 换源前的那句话。跨播放模型才出现 —— 同模型之间不打扰。 */}
      {pendingSwitch && (
        <div className="nesio-music-notice">
          <p>{pendingSwitch.notice}</p>
          <div className="nesio-music-notice-acts">
            <button type="button" onClick={() => { setPref({ preferredSource: pendingSwitch.to }); setPendingSwitch(null); }}>
              {L(dict, '知道了,换过去', 'Got it, switch')}
            </button>
            <button type="button" className="ghost" onClick={() => setPendingSwitch(null)}>
              {L(dict, '算了', 'Never mind')}
            </button>
          </div>
        </div>
      )}

      {callbackMsg && <p className="nesio-music-msg">{callbackMsg}</p>}
      {/* 未登录时,远端三源的探测一律 401 —— 先把真原因说出来,别让下面那些
          「还没配好 / 还没连上」的话去背这口锅。本地歌曲不受影响,照常能听。 */}
      {signedOut && source !== 'local' && (
        <p className="nesio-music-blocked">
          {L(dict,
            `${sourceName(source, dict)}要先登录 Nesio 才连得上。本地歌曲不用登录,现在就能听。`,
            `${sourceName(source, dict)} needs you signed in to Nesio first. Local files work without an account.`)}
        </p>
      )}

      {/* 这个源现在的处境。能放就不说话。 */}
      {probed && !playable && blocked && !(signedOut && source !== 'local') && <p className="nesio-music-blocked">{blocked}</p>}
      {/* 回退链的真实出口:当前源放不了时,把**真能放**的那几个摆出来、一键切过去。
          光说「放不了」而不给下一步,就是把用户留在死路上。切过去仍然走 requestSwitch,
          跨播放模型的那句提示不会被绕过。 */}
      {probed && !playable && !!chain.length && (
        <div className="nesio-music-fallback">
          <span>{L(dict, '现在能放的是:', 'These can play right now:')}</span>
          {chain.map((id) => (
            <button key={id} type="button" onClick={() => requestSwitch(id)}>
              {sourceName(id, dict)}
            </button>
          ))}
        </div>
      )}
      {probed && !chain.length && <p className="nesio-music-blocked">{noSourceLine(readiness, dict)}</p>}
      {playable && info.model === 'remote' && (
        <p className="nesio-music-model">
          {L(dict,
            `声音由 ${info.zh} 播,车机上显示的是 ${info.showsOnCar}。`,
            `${info.en} plays the audio; your car shows ${info.showsOnCar}.`)}
        </p>
      )}

      {/* ── 本地歌曲 ─────────────────────────────────────────────── */}
      {source === 'local' && (
        <section className="nesio-music-sec">
          <div className="nesio-music-libhead">
            <span>{head.count
              ? L(dict, `${head.count} 首 · ${prettyBytes(head.bytes)}`, `${head.count} tracks · ${prettyBytes(head.bytes)}`)
              : L(dict, '曲库还是空的', 'Library is empty')}</span>
            <button type="button" onClick={() => fileRef.current?.click()}>
              {L(dict, '导入歌曲', 'Import')}
            </button>
          </div>
          {/* 不能用 hidden / display:none —— iOS 的 WKWebView 会忽略这种 input 的 click(),
              表现正是「点导入完全没反应」而桌面一切正常。视觉隐藏即可(test:qa-ui-truth 压这条)。 */}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            className="nesio-visually-hidden"
            onChange={(e) => { void onFiles(e.target.files); }}
          />
          {importMsg && <p className="nesio-music-msg">{importMsg}</p>}

          {player.state.error && (
            <div className="nesio-music-err">
              <span>{player.state.error}</span>
              <button type="button" onClick={player.clearError}>{L(dict, '知道了', 'OK')}</button>
            </div>
          )}

          {!tracks.length && (
            <p className="nesio-music-empty">
              {L(dict,
                '把手机里的歌拖进来,离线也听得到 —— 这一路不要账号、不要订阅。',
                'Drop in audio files. This path needs no account and no subscription.')}
            </p>
          )}

          {resumeTrack && (
            <button type="button" className="nesio-music-resume" onClick={() => { void player.playId(resumeTrack.id); }}>
              {L(dict, `接着听「${resumeTrack.title}」`, `Resume “${resumeTrack.title}”`)}
            </button>
          )}

          <ul className="nesio-music-list">
            {tracks.map((t) => (
              <li key={t.id} className={t.id === player.state.currentId ? 'is-cur' : ''}>
                <button type="button" className="nesio-music-row" onClick={() => { void player.playId(t.id); }}>
                  <span className="nesio-music-title">{t.title}</span>
                  <span className="nesio-music-sub">
                    {[t.artist, prettyDuration(t.durationSec)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <button
                  type="button"
                  className="nesio-music-del"
                  aria-label={L(dict, '移出曲库', 'Remove')}
                  onClick={async () => {
                    // 正在放的这首被移出曲库,得停 —— 列表里没了却还在响是同屏矛盾。
                    if (t.id === player.state.currentId) player.stop();
                    await deleteLocalTrack(t.id);
                    setTracks(loadLocalTracks());
                  }}
                >×</button>
              </li>
            ))}
          </ul>

          {(current || player.state.loading) && (
            <div className="nesio-music-bar">
              <div className="nesio-music-bar-meta">
                <strong>{current?.title || L(dict, '载入中…', 'Loading…')}</strong>
                <span>{current?.artist || ''}</span>
              </div>
              <div className="nesio-music-bar-acts">
                <button type="button" onClick={player.prev} aria-label={L(dict, '上一首', 'Previous')}>‹‹</button>
                <button type="button" onClick={() => { void player.toggle(); }}>
                  {player.state.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play')}
                </button>
                <button type="button" onClick={player.next} aria-label={L(dict, '下一首', 'Next')}>››</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!current) return;
                    // 曲名是从文件名**猜**的,猜错很常见 —— 所以必须给得起改。
                    // 一次输入,格式跟文件名一样(「艺术家 - 曲名」),复用同一套解析。
                    const raw = window.prompt(
                      L(dict, '改成(艺术家 - 曲名):', 'Rename (artist - title):'),
                      [current.artist, current.title].filter(Boolean).join(' - ') || current.title,
                    );
                    if (raw == null || !raw.trim()) return;
                    const parsed = parseTrackName(raw.trim());
                    renameLocalTrack(current.id, parsed.title, parsed.artist);
                    setTracks(loadLocalTracks());
                  }}
                >{L(dict, '改名', 'Rename')}</button>
              </div>
              <div className="nesio-music-bar-time">
                {clockTime(player.state.positionSec)} / {prettyDuration(player.state.durationSec)}
              </div>
            </div>
          )}

          <div className="nesio-music-modes">
            <button
              type="button"
              className={prefs.shuffle ? 'is-on' : ''}
              onClick={() => setPref({ shuffle: !prefs.shuffle })}
            >{L(dict, '随机', 'Shuffle')}</button>
            {(['off', 'all', 'one'] as RepeatMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={prefs.repeat === m ? 'is-on' : ''}
                onClick={() => setPref({ repeat: m })}
              >
                {m === 'off' ? L(dict, '不循环', 'No repeat') : m === 'all' ? L(dict, '列表循环', 'Repeat all') : L(dict, '单曲循环', 'Repeat one')}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Apple Music ─────────────────────────────────────────── */}
      {source === 'apple' && (
        <section className="nesio-music-sec">
          <p className="nesio-music-model">
            {L(dict,
              '连上之后,声音仍然从 Nesio 自己播,车机上显示的也还是 Nesio。',
              'Once connected, Nesio itself plays; your car still shows Nesio.')}
          </p>
          <button type="button" className="nesio-music-connect" onClick={() => { void onConnectApple(); }}>
            {readiness.apple?.authorized
              ? L(dict, '已连接 Apple Music', 'Apple Music connected')
              : L(dict, '连接 Apple Music', 'Connect Apple Music')}
          </button>
          {connectMsg && <p className="nesio-music-msg">{connectMsg}</p>}
        </section>
      )}

      {/* ── Spotify ─────────────────────────────────────────────── */}
      {source === 'spotify' && (
        <section className="nesio-music-sec">
          <p className="nesio-music-model">
            {L(dict,
              'Spotify 这条是遥控:Nesio 发指令,声音由 Spotify 播,车机上显示 Spotify。需要 Premium。',
              'Spotify is remote control: Nesio sends commands, Spotify plays. Premium required.')}
          </p>
          {spotifyInfo?.authorized && (
            <p className="nesio-music-msg">
              {spotifyInfo.displayName
                ? L(dict, `已连接:${spotifyInfo.displayName}`, `Connected as ${spotifyInfo.displayName}`)
                : L(dict, '已连接。', 'Connected.')}
              {spotifyInfo.product && ` · ${spotifyInfo.product === 'premium'
                ? L(dict, 'Premium,能放', 'Premium — can play')
                : L(dict, '免费版,搜得到但放不了', 'Free plan — search works, playback does not')}`}
            </p>
          )}
          {readiness.spotify?.authorized ? (
            <button
              type="button"
              className="nesio-music-connect"
              onClick={async () => {
                await fetch('/api/portal/music/spotify', { method: 'DELETE' }).catch(() => null);
                setReadiness(await probeReadiness());
              }}
            >{L(dict, '断开 Spotify', 'Disconnect Spotify')}</button>
          ) : (
            <a className="nesio-music-connect" href="/api/portal/music/spotify/connect">
              {L(dict, '连接 Spotify', 'Connect Spotify')}
            </a>
          )}
        </section>
      )}

      {/* ── 网易云:能搜,放不出声 ───────────────────────────────── */}
      {source === 'netease' && (
        <section className="nesio-music-sec">
          <div className="nesio-music-search">
            <input
              value={neteaseQ}
              onChange={(e) => setNeteaseQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onSearchNetease(); }}
              placeholder={L(dict, '搜歌名或歌手', 'Search songs or artists')}
            />
            <button type="button" onClick={() => { void onSearchNetease(); }} disabled={searching}>
              {searching ? L(dict, '搜索中…', 'Searching…') : L(dict, '搜索', 'Search')}
            </button>
          </div>
          {neteaseMsg && <p className="nesio-music-msg">{neteaseMsg}</p>}
          <ul className="nesio-music-list">
            {neteaseHits.map((h) => (
              <li key={h.id}>
                <div className="nesio-music-row is-static">
                  <span className="nesio-music-title">{h.title}</span>
                  <span className="nesio-music-sub">{[h.artist, h.album, prettyDuration(h.durationSec)].filter(Boolean).join(' · ')}</span>
                </div>
              </li>
            ))}
          </ul>
          {!!neteaseHits.length && (
            <p className="nesio-music-blocked">
              {L(dict,
                '搜到了,但这里放不出声。想听的话,先在别的源找同一首,或者把文件导进本地歌曲。',
                'Found — but playback is unavailable here. Try another source, or import the file locally.')}
            </p>
          )}
        </section>
      )}

      {/* in-app 播放器的音频元素。只有本地源用它。 */}
      <audio ref={player.audioRef} preload="metadata" />
    </div>
  );
}
