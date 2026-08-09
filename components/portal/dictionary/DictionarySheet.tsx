'use client';

/**
 * DictionarySheet — 欧路风格离线查词。
 * 搜框 + 词头/音标/词性释义/例句 + 生词本。数据全在本机词库,不上云、不花钱。
 */

import { useEffect, useMemo, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { LEXICON_SIZE } from '@/lib/portal/dictionary/offline-lexicon';
import {
  lookupWord, toggleWordbook, isInWordbook, entriesForWordbook, type DictHit,
} from '@/lib/portal/dictionary/lookup';

export default function DictionarySheet({
  open, onClose, initialQuery = '',
}: {
  open: boolean; onClose: () => void; initialQuery?: string;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [q, setQ] = useState(initialQuery);
  const [tab, setTab] = useState<'search' | 'book'>('search');
  const [bookRev, setBookRev] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setQ(initialQuery);
    setTab('search');
    setErr('');
  }, [open, initialQuery]);

  const hits = useMemo(() => (q.trim() ? lookupWord(q) : []), [q]);
  const book = useMemo(() => entriesForWordbook(), [bookRev, open]);

  const onToggle = (word: string) => {
    const r = toggleWordbook(word);
    if (!r.ok) {
      setErr(t('生词本没存上 —— 本机空间可能满了。', 'Could not save wordbook — storage may be full.'));
      return;
    }
    setErr('');
    setBookRev((n) => n + 1);
  };

  const renderEntry = (hit: DictHit | { entry: (typeof book)[number]; rank?: string }, i: number) => {
    const e = hit.entry;
    const inBook = isInWordbook(e.word);
    return (
      <article key={`${e.word}-${i}`} className="nesio-dict-entry">
        <header className="nesio-dict-entry-head">
          <div>
            <h3 className="nesio-dict-headword">{e.headword}</h3>
            {e.phonetic && <p className="nesio-dict-phonetic">{e.phonetic}</p>}
          </div>
          <button type="button" className={`nesio-dict-star${inBook ? ' is-on' : ''}`}
            aria-label={inBook ? t('移出生词本', 'Remove from wordbook') : t('加入生词本', 'Add to wordbook')}
            onClick={() => onToggle(e.word)}>
            {inBook ? '★' : '☆'}
          </button>
        </header>
        <ul className="nesio-dict-senses">
          {e.senses.map((s, j) => (
            <li key={j}>
              {s.pos && <span className="nesio-dict-pos">{s.pos}</span>}
              <span className="nesio-dict-def">{s.zh}</span>
              {s.en && <span className="nesio-dict-def-en">{s.en}</span>}
            </li>
          ))}
        </ul>
        {e.examples && e.examples.length > 0 && (
          <div className="nesio-dict-examples">
            {e.examples.map((ex, j) => (
              <p key={j} className="nesio-dict-ex">
                <span className="nesio-dict-ex-en">{ex.en}</span>
                <span className="nesio-dict-ex-zh">{ex.zh}</span>
              </p>
            ))}
          </div>
        )}
      </article>
    );
  };

  return (
    <NesioSheet variant="bottom" elevated open={open} onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel={t('词典', 'Dictionary')}>
      <div className="nesio-dict-sheet">
        <div className="nesio-dict-tabs">
          <button type="button" className={tab === 'search' ? 'is-on' : ''} onClick={() => setTab('search')}>
            {t('查词', 'Lookup')}
          </button>
          <button type="button" className={tab === 'book' ? 'is-on' : ''} onClick={() => setTab('book')}>
            {t(`生词本 · ${book.length}`, `Wordbook · ${book.length}`)}
          </button>
          <button type="button" className="nesio-dict-close" onClick={onClose} aria-label={t('关闭', 'Close')}>✕</button>
        </div>

        {tab === 'search' && (
          <>
            <input
              className="nesio-dict-search"
              value={q}
              autoFocus
              placeholder={t('输入英文或中文…', 'English or Chinese…')}
              onChange={(e) => setQ(e.target.value)}
            />
            <p className="nesio-dict-meta">
              {t(`离线词库 · ${LEXICON_SIZE} 词 · 不联网`, `Offline lexicon · ${LEXICON_SIZE} words · no network`)}
            </p>
            {!q.trim() && (
              <p className="nesio-dict-hint">{t('试试 hello、今天、dictionary', 'Try hello, 今天, or dictionary')}</p>
            )}
            {q.trim() && hits.length === 0 && (
              <p className="nesio-dict-empty" role="status">{t('词库里没有这个词。', 'Not in the offline lexicon.')}</p>
            )}
            <div className="nesio-dict-list">{hits.map((h, i) => renderEntry(h, i))}</div>
          </>
        )}

        {tab === 'book' && (
          book.length === 0
            ? <p className="nesio-dict-empty">{t('生词本还是空的 —— 查到词点星星收藏。', 'Wordbook is empty — star a word to save it.')}</p>
            : <div className="nesio-dict-list">{book.map((e, i) => renderEntry({ entry: e }, i))}</div>
        )}

        {err && <p className="nesio-dict-err" role="alert">{err}</p>}
      </div>
    </NesioSheet>
  );
}
