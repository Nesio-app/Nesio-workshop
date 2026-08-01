'use client';

/**
 * 歌单这一屏(2026-08-01,用户:「在音乐板面应该有歌单 子tab 才对」)。
 *
 * 两层:歌单列表 → 某个歌单的曲目。「我喜欢的音乐」永远排第一 ——
 * 它是唯一一个不用自己建、也删不掉的。
 *
 * ── 一处取舍 ────────────────────────────────────────────────────────────────
 * 歌单里**本地和网易的歌混着**是常态(自己导的几首 + 搜到的几首)。
 * 所以「播放全部」交给引擎的统一队列(setEntryQueue),而不是本地一条、
 * 远端一条 —— 分成两条的话「下一首」会在两种源的交界处莫名其妙地停住,
 * 而用户完全看不出为什么。
 */

import { useCallback, useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  LIKED_ID, deletePlaylist, loadPlaylists, parseTrackRef, playlistHeadline, playlistName,
  removeFromPlaylist, PLAYLISTS_CHANGED, type Playlist,
} from '@/lib/platform/music/playlists';
import { prettyDuration } from '@/lib/platform/music/local-tracks';
import { playEntry, setEntryQueue, type QueueEntry } from '@/lib/platform/music/player-engine';
import type { ProbeOutcome } from '@/lib/platform/music/auto-advance';

interface Props {
  /** 问一首网易的歌现在能不能放。由面板注入 —— 它知道该走哪条路由。 */
  probeRemote: (id: string) => Promise<ProbeOutcome>;
  /** 自动往下找停下来时说的那句话(风控/断网/都放不了)。 */
  onQueueStop: (r: { stop: string; skipped: number }) => void;
  currentId: string;
}

function toQueueEntries(p: Playlist): QueueEntry[] {
  return p.entries
    .map((e) => {
      const parsed = parseTrackRef(e.ref);
      if (!parsed) return null;
      return {
        ref: e.ref, source: parsed.source, id: parsed.id,
        title: e.title, artist: e.artist, durationSec: e.durationSec,
      } satisfies QueueEntry;
    })
    .filter((x): x is QueueEntry => x !== null);
}

export default function PlaylistsTab({ probeRemote, onQueueStop, currentId }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const lang: 'zh' | 'en' = dict === 'en' ? 'en' : 'zh';

  const [lists, setLists] = useState<Playlist[]>([]);
  const [openId, setOpenId] = useState('');

  const refresh = useCallback(() => { setLists(loadPlaylists()); }, []);

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener(PLAYLISTS_CHANGED, refresh);
    return () => window.removeEventListener(PLAYLISTS_CHANGED, refresh);
  }, [refresh]);

  const open = lists.find((p) => p.id === openId) || null;

  const playFrom = useCallback((p: Playlist, startIndex: number) => {
    const entries = toQueueEntries(p);
    if (!entries.length) return;
    setEntryQueue(entries, probeRemote, onQueueStop);
    const e = entries[Math.min(Math.max(0, startIndex), entries.length - 1)];
    void playEntry(e);
  }, [probeRemote, onQueueStop]);

  /* ── 某个歌单里面 ───────────────────────────────────────────────────────── */
  if (open) {
    return (
      <section className="nesio-music-sec">
        <div className="nesio-pl-detail-head">
          <button type="button" className="nesio-pl-back" onClick={() => setOpenId('')}>
            ‹ {L(dict, '歌单', 'Playlists')}
          </button>
        </div>

        <div className="nesio-pl-hero">
          <div className="nesio-pl-hero-art" aria-hidden>♪</div>
          <div className="nesio-pl-hero-meta">
            <strong>{playlistName(open, lang)}</strong>
            <span>{playlistHeadline(open, lang)}</span>
          </div>
        </div>

        <div className="nesio-pl-acts">
          <button
            type="button"
            className="nesio-pl-play-all"
            onClick={() => playFrom(open, 0)}
            disabled={!open.entries.length}
          >
            ▶ {L(dict, '播放全部', 'Play all')}
          </button>
          {open.id !== LIKED_ID && (
            <button
              type="button"
              className="nesio-pl-del"
              onClick={() => { deletePlaylist(open.id); setOpenId(''); refresh(); }}
            >
              {L(dict, '删除这个歌单', 'Delete playlist')}
            </button>
          )}
        </div>

        {!open.entries.length && (
          <p className="nesio-music-empty">
            {L(dict, '这个歌单还是空的。在曲库或搜索结果里点「＋」就能加进来。',
              'This playlist is empty. Tap “＋” on any track to add it here.')}
          </p>
        )}

        <ul className="nesio-music-list">
          {open.entries.map((e, i) => {
            const parsed = parseTrackRef(e.ref);
            return (
              <li key={e.ref} className={currentId && parsed?.id === currentId ? 'is-on' : ''}>
                <button type="button" className="nesio-music-row" onClick={() => playFrom(open, i)}>
                  <span className="nesio-music-title">{e.title}</span>
                  <span className="nesio-music-sub">
                    {[e.artist, e.durationSec > 0 ? prettyDuration(e.durationSec) : '',
                      parsed?.source === 'netease' ? L(dict, '网易云', 'NetEase') : L(dict, '本地', 'Local')]
                      .filter(Boolean).join(' · ')}
                  </span>
                </button>
                <button
                  type="button"
                  className="nesio-music-del"
                  onClick={() => { removeFromPlaylist(open.id, e.ref); refresh(); }}
                  aria-label={L(dict, `把「${e.title}」移出这个歌单`, `Remove “${e.title}” from this playlist`)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  /* ── 歌单列表 ───────────────────────────────────────────────────────────── */
  return (
    <section className="nesio-music-sec">
      <p className="nesio-music-model">
        {L(dict, '歌单存在这台设备上,并跟着你的账号同步到别的设备。',
          'Playlists live on this device and sync to your other devices with your account.')}
      </p>
      <ul className="nesio-pl-list">
        {lists.map((p) => (
          <li key={p.id}>
            <button type="button" className="nesio-pl-card" onClick={() => setOpenId(p.id)}>
              <span className="nesio-pl-card-art" aria-hidden>{p.id === LIKED_ID ? '♥' : '♪'}</span>
              <span className="nesio-pl-card-meta">
                <strong>{playlistName(p, lang)}</strong>
                <span>{playlistHeadline(p, lang)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="nesio-music-model">
        {L(dict, '新建歌单在任意一首歌的「＋」里 —— 那样建完就直接把这首放进去了。',
          'Create a playlist from any track’s “＋” — that way the track goes in right as you create it.')}
      </p>
    </section>
  );
}
