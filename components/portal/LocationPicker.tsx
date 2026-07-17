'use client';

import { useEffect, useState } from 'react';
import { getNamedPlaces, upsertNamedPlace, type NamedPlace } from '@/lib/portal/named-places';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// 批次192(存放位置闭环):除了显示串,再把稳定 placeId + room/subRoom 抛出来 ——
// 存的一方据此存 placeId(命名地点改名后自动传导);自由文本时 meta=undefined(清掉 placeId)。
export interface LocationMeta { placeId?: string; room?: string; subRoom?: string }

interface LocationPickerProps {
  value: string;
  onChange: (value: string, meta?: LocationMeta) => void;
  className?: string;
}

function buildDisplayValue(place: NamedPlace | null, room: string, subRoom: string): string {
  if (!place) return '';
  const parts = [`${place.emoji} ${place.name}`];
  if (room) parts.push(room);
  if (subRoom) parts.push(subRoom);
  return parts.join(' · ');
}

function parseValue(value: string, places: NamedPlace[]): { place: NamedPlace | null; room: string; subRoom: string } {
  if (!value) return { place: null, room: '', subRoom: '' };
  const parts = value.split(' · ');
  // Find place by matching "emoji name" prefix
  let place: NamedPlace | null = null;
  let roomStart = 0;
  for (const p of places) {
    const prefix = `${p.emoji} ${p.name}`;
    if (parts[0] === prefix) {
      place = p;
      roomStart = 1;
      break;
    }
  }
  const room = parts[roomStart] ?? '';
  const subRoom = parts[roomStart + 1] ?? '';
  return { place, room, subRoom };
}

export default function LocationPicker({ value, onChange, className }: LocationPickerProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [places, setPlaces] = useState<NamedPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<NamedPlace | null>(null);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [selectedSubRoom, setSelectedSubRoom] = useState('');
  const [freeText, setFreeText] = useState('');
  const [mode, setMode] = useState<'named' | 'free'>('named');
  const [customRoom, setCustomRoom] = useState('');
  const [customSubRoom, setCustomSubRoom] = useState('');
  const [roomMode, setRoomMode] = useState<'select' | 'custom'>('select');
  const [subRoomMode, setSubRoomMode] = useState<'select' | 'custom'>('select');

  useEffect(() => {
    const ps = getNamedPlaces();
    setPlaces(ps);
    if (value) {
      const parsed = parseValue(value, ps);
      if (parsed.place) {
        setMode('named');
        setSelectedPlace(parsed.place);
        setSelectedRoom(parsed.room);
        setSelectedSubRoom(parsed.subRoom);
      } else {
        setMode('free');
        setFreeText(value);
      }
    }
  }, [value]);

  function emitChange(place: NamedPlace | null, room: string, subRoom: string) {
    onChange(
      buildDisplayValue(place, room, subRoom),
      place ? { placeId: place.id, room: room || undefined, subRoom: subRoom || undefined } : undefined,
    );
  }

  // 批次192:把当前自由文本「存为新地点」—— 变成可复用的命名地点(拿到稳定 placeId)。
  function saveAsPlace() {
    const name = freeText.trim();
    if (!name) return;
    const np: NamedPlace = {
      id: `place-${Date.now().toString(36)}`,
      name, emoji: '📍', lat: 0, lon: 0, radiusMeters: 150, rooms: [], subRooms: {},
    };
    upsertNamedPlace(np);
    setPlaces(getNamedPlaces());
    setMode('named');
    setSelectedPlace(np);
    setSelectedRoom('');
    setSelectedSubRoom('');
    emitChange(np, '', '');
  }

  function handlePlaceChange(id: string) {
    if (id === '__free__') {
      setMode('free');
      setSelectedPlace(null);
      setSelectedRoom('');
      setSelectedSubRoom('');
      onChange(freeText);
      return;
    }
    const p = places.find((pl) => pl.id === id) ?? null;
    setSelectedPlace(p);
    setSelectedRoom('');
    setSelectedSubRoom('');
    emitChange(p, '', '');
  }

  function handleRoomChange(room: string) {
    if (room === '__custom__') {
      setRoomMode('custom');
      setCustomRoom('');
      setSelectedRoom('');
      setSelectedSubRoom('');
      setSubRoomMode('select');
      return;
    }
    setRoomMode('select');
    setSelectedRoom(room);
    setSelectedSubRoom('');
    setSubRoomMode('select');
    emitChange(selectedPlace, room, '');
  }

  function handleCustomRoomChange(room: string) {
    setCustomRoom(room);
    setSelectedRoom(room);
    setSelectedSubRoom('');
    emitChange(selectedPlace, room, '');
  }

  function handleSubRoomChange(sub: string) {
    if (sub === '__custom__') {
      setSubRoomMode('custom');
      setCustomSubRoom('');
      setSelectedSubRoom('');
      return;
    }
    setSubRoomMode('select');
    setSelectedSubRoom(sub);
    emitChange(selectedPlace, selectedRoom, sub);
  }

  function handleCustomSubRoomChange(sub: string) {
    setCustomSubRoom(sub);
    setSelectedSubRoom(sub);
    emitChange(selectedPlace, selectedRoom, sub);
  }

  const subRooms = selectedPlace?.subRooms?.[selectedRoom] ?? [];

  if (mode === 'free') {
    return (
      <div className={`nesio-loc-picker ${className ?? ''}`}>
        <input
          className="nesio-loc-free-input"
          value={freeText}
          placeholder={L(dict, '输入位置…', 'Enter a place…')}
          onChange={(e) => { setFreeText(e.target.value); onChange(e.target.value); }}
        />
        {/* 批次192:自由文本 → 存为可复用命名地点(下次直接选,改名自动传导到所有物品) */}
        {freeText.trim() && (
          <button type="button" className="nesio-loc-switch-btn" onClick={saveAsPlace}>
            ➕ {L(dict, '存为新地点', 'Save as place')}
          </button>
        )}
        {places.length > 0 && (
          <button type="button" className="nesio-loc-switch-btn" onClick={() => setMode('named')}>
            📍 {L(dict, '选命名地点', 'Pick a place')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`nesio-loc-picker ${className ?? ''}`}>
      {/* Level 1 — named place */}
      <select
        className="nesio-loc-select"
        value={selectedPlace?.id ?? ''}
        onChange={(e) => handlePlaceChange(e.target.value)}
      >
        <option value="">{L(dict, '选择地点…', 'Pick a place…')}</option>
        {places.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
        <option value="__free__">{L(dict, '自定义输入', 'Custom entry')}</option>
      </select>

      {/* Level 2 — room */}
      {selectedPlace && (selectedPlace.rooms.length > 0 || roomMode === 'custom') && (
        roomMode === 'custom' ? (
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              className="nesio-loc-free-input"
              value={customRoom}
              placeholder={L(dict, '输入区域名称…', 'Enter an area…')}
              onChange={(e) => handleCustomRoomChange(e.target.value)}
              autoFocus
            />
            <button type="button" className="nesio-loc-switch-btn" onClick={() => { setRoomMode('select'); setCustomRoom(''); setSelectedRoom(''); }}>
              ×
            </button>
          </div>
        ) : (
          <select
            className="nesio-loc-select"
            value={selectedRoom}
            onChange={(e) => handleRoomChange(e.target.value)}
          >
            <option value="">{L(dict, '区域…', 'Area…')}</option>
            {selectedPlace.rooms.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="__custom__">{L(dict, '自定义…', 'Custom…')}</option>
          </select>
        )
      )}

      {/* Level 3 — sub-room */}
      {selectedRoom && (subRooms.length > 0 || subRoomMode === 'custom') && (
        subRoomMode === 'custom' ? (
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              className="nesio-loc-free-input"
              value={customSubRoom}
              placeholder={L(dict, '输入具体位置…', 'Enter a spot…')}
              onChange={(e) => handleCustomSubRoomChange(e.target.value)}
              autoFocus
            />
            <button type="button" className="nesio-loc-switch-btn" onClick={() => { setSubRoomMode('select'); setCustomSubRoom(''); setSelectedSubRoom(''); }}>
              ×
            </button>
          </div>
        ) : (
          <select
            className="nesio-loc-select"
            value={selectedSubRoom}
            onChange={(e) => handleSubRoomChange(e.target.value)}
          >
            <option value="">{L(dict, '具体位置…', 'Spot…')}</option>
            {subRooms.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="__custom__">{L(dict, '自定义…', 'Custom…')}</option>
          </select>
        )
      )}
    </div>
  );
}
