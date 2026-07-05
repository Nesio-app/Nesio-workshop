'use client';

import { useEffect, useState } from 'react';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import {
  getNamedPlaces,
  upsertNamedPlace,
  deleteNamedPlace,
  type NamedPlace,
} from '@/lib/portal/named-places';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMOJI_OPTIONS = ['🏠', '🏢', '🏫', '🛒', '🏋️', '☕', '🏥', '🚗', '🌳', '📦'];

function newPlace(): NamedPlace {
  return {
    id: `place-${Date.now()}`,
    name: '',
    emoji: '📍',
    lat: 0,
    lon: 0,
    radiusMeters: 150,
    rooms: [],
    subRooms: {},
  };
}

function RoomEditor({
  place,
  onChange,
}: {
  place: NamedPlace;
  onChange: (updated: NamedPlace) => void;
}) {
  const [roomInput, setRoomInput] = useState('');
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [subInput, setSubInput] = useState('');

  function addRoom() {
    const r = roomInput.trim();
    if (!r || place.rooms.includes(r)) return;
    onChange({ ...place, rooms: [...place.rooms, r] });
    setRoomInput('');
  }

  function removeRoom(r: string) {
    const rooms = place.rooms.filter((x) => x !== r);
    const subRooms = { ...place.subRooms };
    delete subRooms[r];
    onChange({ ...place, rooms, subRooms });
    if (expandedRoom === r) setExpandedRoom(null);
  }

  function addSubRoom(room: string) {
    const s = subInput.trim();
    if (!s) return;
    const existing = place.subRooms[room] ?? [];
    if (existing.includes(s)) return;
    onChange({ ...place, subRooms: { ...place.subRooms, [room]: [...existing, s] } });
    setSubInput('');
  }

  function removeSubRoom(room: string, sub: string) {
    const existing = (place.subRooms[room] ?? []).filter((x) => x !== sub);
    onChange({ ...place, subRooms: { ...place.subRooms, [room]: existing } });
  }

  return (
    <div className="nesio-np-room-editor">
      <p className="nesio-np-section-label">区域 / 房间</p>
      <div className="nesio-np-room-chips">
        {place.rooms.map((r) => (
          <div key={r} className="nesio-np-room-chip-row">
            <button
              type="button"
              className={`nesio-np-room-chip ${expandedRoom === r ? 'nesio-np-room-chip--active' : ''}`}
              onClick={() => setExpandedRoom(expandedRoom === r ? null : r)}
            >
              {r} {(place.subRooms[r]?.length ?? 0) > 0 && `· ${place.subRooms[r].length}`}
            </button>
            <button type="button" className="nesio-np-chip-del" onClick={() => removeRoom(r)}>×</button>
          </div>
        ))}
      </div>
      {/* Sub-room editor when a room is expanded */}
      {expandedRoom && (
        <div className="nesio-np-subroom-editor">
          <p className="nesio-np-section-label" style={{ fontSize: '0.72rem' }}>{expandedRoom} 的具体位置</p>
          <div className="nesio-np-room-chips">
            {(place.subRooms[expandedRoom] ?? []).map((s) => (
              <div key={s} className="nesio-np-room-chip-row">
                <span className="nesio-np-sub-chip">{s}</span>
                <button type="button" className="nesio-np-chip-del" onClick={() => removeSubRoom(expandedRoom, s)}>×</button>
              </div>
            ))}
          </div>
          <div className="nesio-np-add-row">
            <input
              className="nesio-np-input"
              value={subInput}
              placeholder="添加具体位置（如：电视柜）"
              onChange={(e) => setSubInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSubRoom(expandedRoom)}
            />
            <button type="button" className="nesio-np-add-btn" onClick={() => addSubRoom(expandedRoom)}>添加</button>
          </div>
        </div>
      )}
      <div className="nesio-np-add-row">
        <input
          className="nesio-np-input"
          value={roomInput}
          placeholder="添加区域（如：客厅）"
          onChange={(e) => setRoomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRoom()}
        />
        <button type="button" className="nesio-np-add-btn" onClick={addRoom}>添加</button>
      </div>
    </div>
  );
}

function PlaceCard({
  place,
  onSave,
  onDelete,
}: {
  place: NamedPlace;
  onSave: (p: NamedPlace) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<NamedPlace>({ ...place });
  const [capturing, setCapturing] = useState(false);
  const [dirty, setDirty] = useState(false);

  function update(patch: Partial<NamedPlace>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }

  async function captureGps() {
    if (!navigator.geolocation) return;
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setCapturing(false);
      },
      () => setCapturing(false),
      { timeout: 10000, maximumAge: 0 },
    );
  }

  function save() {
    if (!draft.name.trim()) return;
    onSave(draft);
    setDirty(false);
  }

  const hasGps = draft.lat !== 0 || draft.lon !== 0;

  return (
    <div className="nesio-np-card">
      <div className="nesio-np-card-row">
        {/* Emoji picker */}
        <div className="nesio-np-emoji-picker">
          {EMOJI_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              className={`nesio-np-emoji-btn ${draft.emoji === e ? 'nesio-np-emoji-btn--active' : ''}`}
              onClick={() => update({ emoji: e })}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          className="nesio-np-input nesio-np-name-input"
          value={draft.name}
          placeholder="地点名称（如：家）"
          onChange={(e) => update({ name: e.target.value })}
        />
        <button type="button" className="nesio-np-del-btn" onClick={onDelete}>删除</button>
      </div>

      {/* GPS */}
      <div className="nesio-np-gps-row">
        <span className={`nesio-np-gps-badge ${hasGps ? 'nesio-np-gps-badge--set' : ''}`}>
          {hasGps
            ? `📍 已记录位置 (${draft.lat.toFixed(4)}, ${draft.lon.toFixed(4)})`
            : '📍 未设置 GPS'}
        </span>
        <button
          type="button"
          className="nesio-np-gps-btn"
          onClick={captureGps}
          disabled={capturing}
        >
          {capturing ? '定位中…' : '记录当前位置'}
        </button>
      </div>

      {/* Room editor */}
      <RoomEditor place={draft} onChange={(p) => { setDraft(p); setDirty(true); }} />

      {dirty && (
        <button type="button" className="nesio-np-save-btn" onClick={save}>
          保存
        </button>
      )}
    </div>
  );
}

export default function NamedPlacesSheet({ open, onClose }: Props) {
  useSheetDismiss(onClose, { enabled: open });
  const [places, setPlaces] = useState<NamedPlace[]>([]);

  useEffect(() => {
    if (open) setPlaces(getNamedPlaces());
  }, [open]);

  function handleSave(updated: NamedPlace) {
    upsertNamedPlace(updated);
    setPlaces(getNamedPlaces());
  }

  function handleDelete(id: string) {
    deleteNamedPlace(id);
    setPlaces(getNamedPlaces());
  }

  function addNew() {
    const p = newPlace();
    setPlaces((prev) => [...prev, p]);
  }

  if (!open) return null;

  return (
    <div className="nesio-sheet-overlay" role="dialog" aria-modal>
      <button type="button" className="nesio-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-sheet nesio-sheet--tall">
        <div className="nesio-sheet-handle" />
        <div className="nesio-sheet-header">
          <h2 className="nesio-sheet-title">命名地点</h2>
          <button type="button" className="nesio-sheet-close" onClick={onClose}>×</button>
        </div>
        <p className="nesio-np-desc">
          保存常用地点并起名字。拍照时 Nesio 会自动匹配最近的地点，帮你记录物品放在哪里。
        </p>
        <div className="nesio-np-list">
          {places.map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              onSave={handleSave}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
        <button type="button" className="nesio-np-add-place-btn" onClick={addNew}>
          + 添加新地点
        </button>
      </div>
    </div>
  );
}
