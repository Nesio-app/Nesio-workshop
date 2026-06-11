export type NoteKind = 'quote' | 'chat' | 'note' | 'misc';

export interface TreasureNote {
  id: string;
  kind: NoteKind;
  title: string;
  content: string;
  createdAt: string;
  readonly?: boolean;
}

const NOTES_KEY = 'treasurebox-notes';
const FAV_QUOTES_KEY = 'treasurebox-favorite-quotes';

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  quote: '语录',
  chat: '聊天',
  note: '随笔',
  misc: '其他',
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadStoredNotes(): TreasureNote[] {
  const list = readJson<TreasureNote[]>(NOTES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveStoredNotes(notes: TreasureNote[]): void {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes.slice(0, 200)));
}

export function loadFavoriteQuotes(): string[] {
  const list = readJson<string[]>(FAV_QUOTES_KEY, []);
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export function loadAllNotes(): TreasureNote[] {
  const stored = loadStoredNotes();
  const favQuotes = loadFavoriteQuotes();
  const favNotes: TreasureNote[] = favQuotes.map((content, index) => ({
    id: `fav-quote-${index}`,
    kind: 'quote',
    title: '首页收藏',
    content,
    createdAt: '',
    readonly: true,
  }));

  const seen = new Set<string>();
  const merged: TreasureNote[] = [];

  for (const note of [...favNotes, ...stored]) {
    const key = `${note.kind}|${note.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(note);
  }

  return merged.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function addNote(
  kind: NoteKind,
  content: string,
  title = '',
): TreasureNote {
  const note: TreasureNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: title.trim() || NOTE_KIND_LABELS[kind],
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
  const next = [note, ...loadStoredNotes()];
  saveStoredNotes(next);
  return note;
}

export function deleteNote(id: string): void {
  if (id.startsWith('fav-quote-')) return;
  saveStoredNotes(loadStoredNotes().filter((n) => n.id !== id));
}

export function searchNotes(notes: TreasureNote[], query: string): TreasureNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => {
    const hay = `${n.title} ${n.content} ${NOTE_KIND_LABELS[n.kind]}`.toLowerCase();
    return hay.includes(q);
  });
}
