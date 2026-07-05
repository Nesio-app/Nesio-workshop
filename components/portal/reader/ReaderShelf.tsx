'use client';

/**
 * ReaderShelf — 书架(批次 26)。
 *
 * 导入的书(文件/粘贴)存 IndexedDB,网格展示;点开进瀑布流阅读器 ReaderView。
 * 复用 reading-ios 的 ADHD 脱水引擎:任意 TXT/MD/HTML/EPUB/PDF/粘贴 → 神经友好短行。
 */

import { useEffect, useRef, useState } from 'react';
import {
  parseFile,
  parsePastedText,
  lineCount,
  SUPPORTED_FORMATS,
  MAX_IMPORT_MB,
  type ReaderBook,
} from '@/lib/portal/adhd-reader';
import { deleteReaderBook, loadReaderBooks, saveReaderBook } from '@/lib/portal/reader-store-idb';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import ReaderView from './ReaderView';

type Status = { msg: string; kind: 'busy' | 'ok' | 'err' } | null;

export default function ReaderShelf({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [books, setBooks] = useState<ReaderBook[]>([]);
  const [reading, setReading] = useState<ReaderBook | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setBooks(await loadReaderBooks());

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  async function afterImport(book: ReaderBook) {
    const n = lineCount(book);
    if (n < 1) throw new Error(L(dict, '没有生成可阅读的行', 'No readable lines produced'));
    await saveReaderBook(book);
    await refresh();
    setStatus({ msg: L(dict, `已导入「${book.title}」· ${n} 行`, `Imported “${book.title}” · ${n} lines`), kind: 'ok' });
    setShowImport(false);
    setPasteText('');
    setImportTitle('');
    setReading(book);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus({ msg: L(dict, '正在解析并脱水拆行…', 'Parsing and splitting…'), kind: 'busy' });
    try {
      const book = await parseFile(file, { title: importTitle.trim() || undefined });
      await afterImport(book);
    } catch (err) {
      setStatus({ msg: (err as Error).message || L(dict, '导入失败', 'Import failed'), kind: 'err' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handlePaste() {
    const text = pasteText.trim();
    if (!text) { setStatus({ msg: L(dict, '请先粘贴正文', 'Paste some text first'), kind: 'err' }); return; }
    setBusy(true);
    setStatus({ msg: L(dict, '正在脱水拆行…', 'Splitting…'), kind: 'busy' });
    try {
      const book = parsePastedText(text, { title: importTitle.trim() || L(dict, '粘贴导入', 'Pasted') });
      await afterImport(book);
    } catch (err) {
      setStatus({ msg: (err as Error).message || L(dict, '导入失败', 'Import failed'), kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(L(dict, `删除「${title}」?`, `Delete “${title}”?`))) return;
    await deleteReaderBook(id);
    await refresh();
  }

  return (
    <>
      <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '书架', 'Bookshelf')}>
        <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
        <div className="nesio-settings-sheet-card">
          <div className="nesio-sheet-handle" aria-hidden />
          <div className="nesio-settings-sheet-header">
            <h2 className="nesio-settings-sheet-title">{L(dict, '书架', 'Bookshelf')}</h2>
            <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
          </div>
          <div className="nesio-settings-sheet-body">
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
              {L(dict, `任意 ${SUPPORTED_FORMATS} · 脱水成神经友好短行`, `Any of ${SUPPORTED_FORMATS} · split into ADHD-friendly lines`)}
            </p>

            <div className="nesio-shelf-grid">
              <button type="button" className="nesio-shelf-card nesio-shelf-card--add" onClick={() => { setShowImport((v) => !v); setStatus(null); }}>
                <span className="nesio-shelf-add-plus">＋</span>
                <span className="nesio-shelf-card-title">{L(dict, '导入书籍', 'Import')}</span>
                <span className="nesio-shelf-card-sub">{L(dict, `文件/粘贴 · 最大 ${MAX_IMPORT_MB}MB`, `File/paste · max ${MAX_IMPORT_MB}MB`)}</span>
              </button>

              {books.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="nesio-shelf-card"
                  onClick={() => setReading(b)}
                  onContextMenu={(e) => { e.preventDefault(); handleDelete(b.id, b.title); }}
                >
                  <span className="nesio-shelf-spine" style={{ background: b.spine.gradient }}>{b.spine.label}</span>
                  <span className="nesio-shelf-card-title">{b.title}</span>
                  <span className="nesio-shelf-card-sub">{(b.format || 'text').toUpperCase()} · {lineCount(b)} {L(dict, '行', 'lines')}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="nesio-shelf-del"
                    aria-label={L(dict, '删除', 'Delete')}
                    onClick={(e) => { e.stopPropagation(); handleDelete(b.id, b.title); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleDelete(b.id, b.title); } }}
                  >✕</span>
                </button>
              ))}
            </div>

            {showImport && (
              <div className="nesio-shelf-import">
                <input
                  className="nesio-routine-input"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder={L(dict, '书名(可选)', 'Title (optional)')}
                  maxLength={60}
                />
                <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%' }} disabled={busy} onClick={() => fileRef.current?.click()}>
                  {L(dict, '选择文件', 'Choose file')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.text,.md,.markdown,.html,.htm,.epub,.pdf,.json,.csv,.log,.xml,.srt,.vtt"
                  className="nesio-visually-hidden"
                  onChange={(e) => handleFile(e.currentTarget.files?.[0])}
                />
                <p className="nesio-settings-option-hint" style={{ textAlign: 'center', margin: '0.4rem 0' }}>{L(dict, '或粘贴正文', 'or paste text')}</p>
                <textarea
                  className="nesio-routine-input"
                  style={{ minHeight: '6rem', resize: 'vertical' }}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={L(dict, '把文章正文粘到这里…', 'Paste article text here…')}
                />
                <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy || !pasteText.trim()} onClick={handlePaste}>
                  {L(dict, '脱水导入', 'Import & split')}
                </button>
              </div>
            )}

            {status && (
              <p className={`nesio-shelf-status nesio-shelf-status--${status.kind}`}>{status.msg}</p>
            )}

            {books.length === 0 && !showImport && (
              <p className="nesio-settings-option-hint">{L(dict, '还没有导入的书。点「导入书籍」开始。', 'No books yet. Tap Import to start.')}</p>
            )}
          </div>
        </div>
      </div>

      {reading && <ReaderView book={reading} onClose={() => setReading(null)} />}
    </>
  );
}
