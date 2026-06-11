'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NOTE_KIND_LABELS,
  addNote,
  deleteNote,
  isUrl,
  loadAllNotes,
  searchNotes,
  type NoteAttachment,
  type NoteKind,
  type TreasureNote,
} from '@/lib/portal/notes';

interface NotePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KINDS: Array<NoteKind | 'all'> = [
  'all',
  'quote',
  'note',
  'link',
  'image',
  'file',
  'chat',
  'misc',
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function NotePanel({ open, onOpenChange }: NotePanelProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<NoteKind | 'all'>('all');
  const [notes, setNotes] = useState<TreasureNote[]>([]);
  const [draftKind, setDraftKind] = useState<NoteKind>('note');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [pendingAttach, setPendingAttach] = useState<NoteAttachment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

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
    const text = draftContent.trim();
    const attach = pendingAttach ? [pendingAttach] : undefined;
    if (!text && !attach?.length) return;

    let saveKind = draftKind;
    if (attach?.[0]?.type === 'image') saveKind = 'image';
    if (attach?.[0]?.type === 'file') saveKind = 'file';
    if (!attach?.length && isUrl(text)) saveKind = 'link';

    addNote(saveKind, text || attach?.[0]?.name || attach?.[0]?.url || '', draftTitle, attach);
    setDraftTitle('');
    setDraftContent('');
    setPendingAttach(null);
    refresh();
  };

  const onDelete = (id: string) => {
    deleteNote(id);
    refresh();
  };

  const onPickFile = async (file: File, type: 'image' | 'file') => {
    if (file.size > 2_800_000) return;
    const url = await readFileAsDataUrl(file);
    setPendingAttach({
      type,
      url,
      name: file.name,
      mime: file.type,
    });
    if (!draftTitle) setDraftTitle(file.name);
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
            placeholder="搜索文字、链接、文件名…"
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
            placeholder="文字、链接，或添加附件…"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="portal-note-textarea"
            rows={3}
          />
          <div className="portal-note-attach-row">
            <button type="button" className="portal-note-attach-btn" onClick={() => imageRef.current?.click()}>
              图片
            </button>
            <button type="button" className="portal-note-attach-btn" onClick={() => fileRef.current?.click()}>
              文件
            </button>
            {pendingAttach ? (
              <span className="portal-note-pending">
                {pendingAttach.name || pendingAttach.type}
                <button type="button" onClick={() => setPendingAttach(null)} aria-label="移除">
                  ×
                </button>
              </span>
            ) : null}
          </div>
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            className="portal-avatar-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f, 'image');
              e.target.value = '';
            }}
          />
          <input
            ref={fileRef}
            type="file"
            className="portal-avatar-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f, 'file');
              e.target.value = '';
            }}
          />
          <button
            type="submit"
            className="portal-note-save"
            disabled={!draftContent.trim() && !pendingAttach}
          >
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
                {note.content ? <p className="portal-note-item-body">{note.content}</p> : null}
                {(note.attachments || []).map((a, i) => (
                  <div key={i} className="portal-note-attachment">
                    {a.type === 'image' ? (
                      <img src={a.url} alt={a.name || ''} className="portal-note-thumb" />
                    ) : a.type === 'link' || isUrl(a.url) ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        {a.name || a.url}
                      </a>
                    ) : (
                      <a href={a.url} download={a.name}>
                        {a.name || '附件'}
                      </a>
                    )}
                  </div>
                ))}
                {note.kind === 'link' && isUrl(note.content) && !note.attachments?.length ? (
                  <a
                    className="portal-note-link"
                    href={note.content}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开链接
                  </a>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
