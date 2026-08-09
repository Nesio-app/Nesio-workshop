'use client';

/**
 * DictionaryPanel — 洞察「词典」板块。欧路风格离线查词的整页版(与首页 + 菜单同一套词库)。
 */

import { useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { LEXICON_SIZE } from '@/lib/portal/dictionary/offline-lexicon';
import {
  lookupWord, toggleWordbook, isInWordbook, entriesForWordbook,
} from '@/lib/portal/dictionary/lookup';

export default function DictionaryPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'search' | 'book'>('search');
  const [bookRev, setBookRev] = useState(0);
  const [err, setErr] = useState('');

  const hits = useMemo(() => (q.trim() ? lookupWord(q) : []), [q]);
  const book = useMemo(() => entriesForWordbook(), [bookRev]);

  return (
    <div className="nesio-analytics-tab nesio-dict-panel">
      <div className="nesio-dict-tabs" style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className={tab === 'search' ? 'is-on' : ''} onClick={() => setTab('search')}>
          {t('查词', 'Lookup')}
        </button>
        <button type="button" className={tab === 'book' ? 'is-on' : ''} onClick={() => setTab('book')}>
          {t(`生词本 · ${book.length}`, `Wordbook · ${book.length}`)}
        </button>
      </div>

      {tab === 'search' && (
        <>
          <input className="nesio-dict-search" value={q} placeholder={t('输入英文或中文…', 'English or Chinese…')}
            onChange={(e) => setQ(e.target.value)} />
          <p className="nesio-dict-meta">
            {t(`离线词库 · ${LEXICON_SIZE} 词 · 不联网不花钱`, `Offline · ${LEXICON_SIZE} words · no network`)}
          </p>
          {q.trim() && hits.length === 0 && (
            <p className="nesio-dict-empty">{t('词库里没有这个词。', 'Not in the offline lexicon.')}</p>
          )}
          <div className="nesio-dict-list">
            {hits.map((h, i) => {
              const e = h.entry;
              const inBook = isInWordbook(e.word);
              return (
                <article key={`${e.word}-${i}`} className="nesio-dict-entry">
                  <header className="nesio-dict-entry-head">
                    <div>
                      <h3 className="nesio-dict-headword">{e.headword}</h3>
                      {e.phonetic && <p className="nesio-dict-phonetic">{e.phonetic}</p>}
                    </div>
                    <button type="button" className={`nesio-dict-star${inBook ? ' is-on' : ''}`}
                      onClick={() => {
                        const r = toggleWordbook(e.word);
                        if (!r.ok) setErr(t('生词本没存上。', 'Could not save wordbook.'));
                        else { setErr(''); setBookRev((n) => n + 1); }
                      }}>
                      {inBook ? '★' : '☆'}
                    </button>
                  </header>
                  <ul className="nesio-dict-senses">
                    {e.senses.map((s, j) => (
                      <li key={j}>
                        {s.pos && <span className="nesio-dict-pos">{s.pos}</span>}
                        <span className="nesio-dict-def">{s.zh}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </>
      )}

      {tab === 'book' && (
        book.length === 0
          ? <p className="nesio-dict-empty">{t('生词本还是空的。', 'Wordbook is empty.')}</p>
          : (
            <div className="nesio-dict-list">
              {book.map((e, i) => (
                <article key={`${e.word}-${i}`} className="nesio-dict-entry">
                  <header className="nesio-dict-entry-head">
                    <div>
                      <h3 className="nesio-dict-headword">{e.headword}</h3>
                      {e.phonetic && <p className="nesio-dict-phonetic">{e.phonetic}</p>}
                    </div>
                    <button type="button" className="nesio-dict-star is-on"
                      onClick={() => { toggleWordbook(e.word); setBookRev((n) => n + 1); }}>★</button>
                  </header>
                  <ul className="nesio-dict-senses">
                    {e.senses.map((s, j) => (
                      <li key={j}>
                        {s.pos && <span className="nesio-dict-pos">{s.pos}</span>}
                        <span className="nesio-dict-def">{s.zh}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )
      )}
      {err && <p className="nesio-dict-err" role="alert">{err}</p>}
    </div>
  );
}
