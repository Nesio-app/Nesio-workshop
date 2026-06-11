'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NOTE_KIND_LABELS,
  addNote,
  deleteNote,
  loadAllNotes,
  searchNotes,
  type NoteKind,
  type TreasureNote,
} from '@/lib/portal/notes';

interface NotePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KINDS: Array<NoteKind | 'all'> = ['all', 'quote', 'chat', 'note', 'misc'];

export default function NotePanel({ open, onOpenChange }: NotePanelProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<NoteKind | 'all'>('all');
  const [notes, setNotes] = useState<TreasureNote[]>([]);
  const [draftKind, setDraftKind] = useState<NoteKind>('note');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setNotes(loadAllNotes());

  useEffect(() => {
    if (open) {
      refresh();
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    let list = searchNotes(notes, query);
    if (kind !== 'all') list = list.filter((n) => n.kind === kind);
    return list;
  }, [notes, query, kind]);

  const onSave = () => {
    if (!draftContent.trim()) return;
    addNote(draftKind, draftContent, draftTitle);
    setDraftTitle('');
    setDraftContent('');
    refresh();
  };

  const onDelete = (id: string) => {
    deleteNote(id);
    refresh();
  };

  if (!open) return null;

  return (
    <div className="portal-note-overlay" role="presentation" onClick={() => onOpenChange(false)}>
      <div
        className="portal-note-panel"
        role="dialog"
        aria-label="Note"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="portal-note-head">
          <h2 className="portal-note-title">Note</h2>
          <button
            type="button"
            className="portal-note-close"
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="portal-note-search">
          <input
            ref={inputRef}
            type="search"
            placeholder="搜索语录、聊天、随笔…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="portal-note-input"
          />
        </div>

        <div className="portal-note-filters" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              className={'portal-note-filter' + (kind === k ? ' portal-note-filter--on' : '')}
              onClick={() => setKind(k)}
            >
              {k === 'all' ? '全部' : NOTE_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <form
          className="portal-note-compose"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <div className="portal-note-compose-row">
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as NoteKind)}
              className="portal-note-select"
              aria-label="类型"
            >
              {(Object.keys(NOTE_KIND_LABELS) as NoteKind[]).map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="标题（可选）"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="portal-note-input portal-note-input--title"
            />
          </div>
          <textarea
            placeholder="写下内容…"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="portal-note-textarea"
            rows={3}
          />
          <button type="submit" className="portal-note-save" disabled={!draftContent.trim()}>
            保存
          </button>
        </form>

        <ul className="portal-note-list">
          {filtered.length === 0 ? (
            <li className="portal-note-empty">还没有内容，先写一条吧。</li>
          ) : (
            filtered.map((note) => (
              <li key={note.id} className="portal-note-item">
                <div className="portal-note-item-head">
                  <span className="portal-note-badge">{NOTE_KIND_LABELS[note.kind]}</span>
                  <span className="portal-note-item-title">{note.title}</span>
                  {!note.readonly ? (
                    <button
                      type="button"
                      className="portal-note-delete"
                      onClick={() => onDelete(note.id)}
                      aria-label="删除"
                    >
                      删
                    </button>
                  ) : null}
                </div>
                <p className="portal-note-item-body">{note.content}</p>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
