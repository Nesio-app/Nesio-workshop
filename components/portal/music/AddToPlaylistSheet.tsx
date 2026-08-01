'use client';

/**
 * 「加到歌单」(2026-08-01,用户:「每一个可以的歌曲要有按钮可以加歌单」)。
 *
 * 一件小事,但有两处**不加就一定会被当成坏了**:
 *
 * ① **已经在里面**要说出来。加歌单这个按钮天然会被重复点(点完没有明显反馈的
 *    按钮每个人都会再点一次),而数据层是幂等的 —— 界面若也只说「已加入」,
 *    用户就永远不知道自己刚才那一下有没有生效。所以这里区分
 *    「加好了」和「本来就在这个歌单里」。
 *
 * ② **写失败要说话**。localStorage 满了的时候写会静默失败,而攒了半天的歌单
 *    悄悄丢掉是最伤的那一类(见 lib/portal/storage-health)。
 */

import { useCallback, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import {
  addToPlaylist, createPlaylist, loadPlaylists, playlistName, playlistHeadline,
  type Playlist, type PlaylistEntry,
} from '@/lib/platform/music/playlists';

interface Props {
  entry: Omit<PlaylistEntry, 'addedAt'>;
  onClose: () => void;
}

export default function AddToPlaylistSheet({ entry, onClose }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const lang: 'zh' | 'en' = dict === 'en' ? 'en' : 'zh';

  const [lists, setLists] = useState<Playlist[]>(() => loadPlaylists());
  const [msg, setMsg] = useState<{ id: string; kind: 'added' | 'already' | 'failed'; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const add = useCallback((p: Playlist) => {
    const before = loadPlaylists().find((x) => x.id === p.id)?.entries.length ?? 0;
    const added = addToPlaylist(p.id, entry);
    const after = loadPlaylists().find((x) => x.id === p.id)?.entries.length ?? 0;
    setLists(loadPlaylists());

    if (added && after > before) {
      setMsg({ id: p.id, kind: 'added', text: L(dict, '加好了', 'Added') });
      return;
    }
    if (!added && after === before && before > 0) {
      // 幂等挡下来的:本来就在里面。**说清楚**,否则用户不知道刚才那一下算不算数
      setMsg({ id: p.id, kind: 'already', text: L(dict, '这首本来就在这个歌单里', 'Already in this playlist') });
      return;
    }
    // 数量没变、也不是「本来就在」—— 只剩写失败这一种。不许静默
    setMsg({
      id: p.id,
      kind: 'failed',
      text: L(dict, '没能存下来 —— 本机存储可能满了。到设置里清一下再试。',
        'Could not save — local storage may be full. Free some space in Settings and try again.'),
    });
  }, [entry, dict]);

  const onCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const p = createPlaylist(name);
      setNewName('');
      setLists(loadPlaylists());
      add(p);
    } finally {
      setCreating(false);
    }
  }, [newName, add]);

  return (
    <NesioSheet
      variant="bottom"
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel={L(dict, '加到歌单', 'Add to playlist')}
      className="nesio-atp"
      card={false}
      elevated
    >
      <div className="nesio-atp-head">
        <strong>{L(dict, '加到歌单', 'Add to playlist')}</strong>
        <button type="button" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>
      <p className="nesio-atp-track">{entry.title}{entry.artist ? ` · ${entry.artist}` : ''}</p>

      <ul className="nesio-atp-list">
        {lists.map((p) => (
          <li key={p.id}>
            <button type="button" className="nesio-atp-row" onClick={() => add(p)}>
              <span className="nesio-atp-name">{playlistName(p, lang)}</span>
              <span className="nesio-atp-sub">{playlistHeadline(p, lang)}</span>
            </button>
            {msg?.id === p.id && (
              <p className={`nesio-atp-msg${msg.kind === 'failed' ? ' is-bad' : ''}`}>{msg.text}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="nesio-atp-new">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={L(dict, '新建一个歌单…', 'New playlist…')}
          aria-label={L(dict, '新歌单的名字', 'New playlist name')}
          onKeyDown={(e) => { if (e.key === 'Enter') onCreate(); }}
        />
        <button type="button" onClick={onCreate} disabled={!newName.trim() || creating}>
          {L(dict, '新建并加入', 'Create & add')}
        </button>
      </div>
    </NesioSheet>
  );
}
