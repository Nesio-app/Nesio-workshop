'use client';

/**
 * DictionarySheet — 欧路风格查词。
 * 搜框 + 列表点进详情(释义/例句/助记);本地词库优先,可选 AI 兜底。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { type DictEntry } from '@/lib/portal/dictionary/offline-lexicon';
import { ensureEcdictMeta, ecdictPackCount } from '@/lib/portal/dictionary/ecdict-pack';
import {
  lookupWordAsync, toggleWordbook, isInWordbook, entriesForWordbookAsync,
  loadAiEnabled, saveAiEnabled, fetchAiLookup, lexiconSizeLabel, type DictHit,
} from '@/lib/portal/dictionary/lookup';
import DictDetailView from './DictDetailView';

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
  const [aiOn, setAiOn] = useState(false);
  const [aiEntry, setAiEntry] = useState<DictEntry | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [hits, setHits] = useState<DictHit[]>([]);
  const [packLoading, setPackLoading] = useState(false);
  const [lexCount, setLexCount] = useState(0);
  const [book, setBook] = useState<DictEntry[]>([]);
  const [selected, setSelected] = useState<{ entry: DictEntry; fromAi?: boolean } | null>(null);
  const aiSeq = useRef(0);
  const lookSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQ(initialQuery);
    setTab('search');
    setErr('');
    setAiErr('');
    setAiEntry(null);
    setSelected(null);
    setAiOn(loadAiEnabled());
    setPackLoading(true);
    void ensureEcdictMeta()
      .then((m) => setLexCount(m.count))
      .catch(() => setLexCount(lexiconSizeLabel()))
      .finally(() => setPackLoading(false));
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open || !q.trim()) { setHits([]); return; }
    const seq = ++lookSeq.current;
    const timer = window.setTimeout(() => {
      void lookupWordAsync(q).then((r) => {
        if (seq === lookSeq.current) setHits(r);
      });
    }, 120);
    return () => { window.clearTimeout(timer); };
  }, [open, q]);

  useEffect(() => {
    if (!open || tab !== 'book') return;
    void entriesForWordbookAsync().then(setBook);
  }, [open, tab, bookRev]);

  const runAiLookup = useCallback(async (query: string) => {
    const seq = ++aiSeq.current;
    setAiLoading(true);
    setAiErr('');
    setAiEntry(null);
    try {
      const entry = await fetchAiLookup(query, dict);
      if (seq !== aiSeq.current) return;
      setAiEntry(entry);
    } catch (e) {
      if (seq !== aiSeq.current) return;
      const msg = e instanceof Error ? e.message : 'ai_failed';
      setAiErr(msg === 'ai_unavailable'
        ? t('AI 查词暂时不可用 —— 稍后再试。', 'AI lookup is unavailable — try again later.')
        : t('AI 查词没成功 —— 点重试再试一次。', 'AI lookup failed — tap retry.'));
    } finally {
      if (seq === aiSeq.current) setAiLoading(false);
    }
  }, [dict, t]);

  useEffect(() => {
    if (!open || tab !== 'search' || !aiOn || !q.trim() || hits.length > 0 || selected) {
      if (!aiOn || hits.length > 0) {
        setAiEntry(null);
        setAiErr('');
        setAiLoading(false);
      }
      return;
    }
    const timer = window.setTimeout(() => { void runAiLookup(q); }, 400);
    return () => { window.clearTimeout(timer); };
  }, [open, tab, aiOn, q, hits.length, runAiLookup, selected]);

  const onToggleAi = () => {
    const next = !aiOn;
    const r = saveAiEnabled(next);
    if (!r.ok) {
      setErr(t('偏好没存上 —— 本机空间可能满了。', 'Could not save preference — storage may be full.'));
      return;
    }
    setErr('');
    setAiOn(next);
    if (!next) {
      setAiEntry(null);
      setAiErr('');
      setAiLoading(false);
    }
  };

  const onToggle = (word: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const r = toggleWordbook(word);
    if (!r.ok) {
      setErr(t('生词本没存上 —— 本机空间可能满了。', 'Could not save wordbook — storage may be full.'));
      return;
    }
    setErr('');
    setBookRev((n) => n + 1);
  };

  const renderCard = (hit: DictHit | { entry: DictEntry; rank?: string; fromAi?: boolean }, i: number) => {
    const e = hit.entry;
    const inBook = isInWordbook(e.word);
    const fromAi = 'fromAi' in hit && hit.fromAi;
    return (
      <article
        key={`${e.word}-${i}`}
        className="nesio-dict-entry nesio-dict-entry-card"
        role="button"
        tabIndex={0}
        onClick={() => setSelected({ entry: e, fromAi: Boolean(fromAi) })}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setSelected({ entry: e, fromAi: Boolean(fromAi) });
          }
        }}
      >
        <header className="nesio-dict-entry-head">
          <div>
            <h3 className="nesio-dict-headword">{e.headword}</h3>
            {e.phonetic && <p className="nesio-dict-phonetic">{e.phonetic}</p>}
            {fromAi && <p className="nesio-dict-ai-badge">{t('AI 释义', 'AI definition')}</p>}
          </div>
          <button type="button" className={`nesio-dict-star${inBook ? ' is-on' : ''}`}
            aria-label={inBook ? t('移出生词本', 'Remove from wordbook') : t('加入生词本', 'Add to wordbook')}
            onClick={(ev) => onToggle(e.word, ev)}>
            {inBook ? '★' : '☆'}
          </button>
        </header>
        <ul className="nesio-dict-senses">
          {e.senses.slice(0, 2).map((s, j) => (
            <li key={j}>
              {s.pos && <span className="nesio-dict-pos">{s.pos}</span>}
              <span className="nesio-dict-def">{s.zh}</span>
            </li>
          ))}
        </ul>
        <p className="nesio-dict-card-hint">{t('点开看例句与助记', 'Tap for examples & study notes')}</p>
      </article>
    );
  };

  const showLocalMiss = Boolean(q.trim() && hits.length === 0 && !aiLoading && !aiEntry && !aiErr);

  return (
    <NesioSheet variant="bottom" elevated open={open} onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel={t('词典', 'Dictionary')}>
      <div className="nesio-dict-sheet">
        {selected ? (
          <DictDetailView
            entry={selected.entry}
            fromAi={selected.fromAi}
            locale={dict}
            t={t}
            onBack={() => setSelected(null)}
            onBookChange={() => setBookRev((n) => n + 1)}
          />
        ) : (
          <>
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
                <div className="nesio-dict-toolbar">
                  <p className="nesio-dict-meta">
                    {packLoading
                      ? t('正在加载欧路兼容词库…', 'Loading Eudic-compatible lexicon…')
                      : t(
                        `离线词库 · ECDICT ${(lexCount || ecdictPackCount()).toLocaleString('en-US')} 词`,
                        `Offline · ECDICT ${(lexCount || ecdictPackCount()).toLocaleString('en-US')} words`,
                      )}
                    {aiOn ? t(' · AI 已开', ' · AI on') : t(' · 不联网', ' · offline')}
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiOn}
                    className={`nesio-dict-ai-toggle${aiOn ? ' is-on' : ''}`}
                    onClick={onToggleAi}
                  >
                    {t('AI 查词', 'AI lookup')}
                  </button>
                </div>
                {!q.trim() && (
                  <p className="nesio-dict-hint">{t('试试 hello、今天、dictionary', 'Try hello, 今天, or dictionary')}</p>
                )}
                {showLocalMiss && !aiOn && (
                  <p className="nesio-dict-empty" role="status">{t('词库里没有这个词。', 'Not in the offline lexicon.')}</p>
                )}
                {showLocalMiss && aiOn && !aiLoading && !aiEntry && !aiErr && (
                  <p className="nesio-dict-hint" role="status">{t('本地没有,正在准备 AI 查词…', 'Not local — preparing AI lookup…')}</p>
                )}
                {aiLoading && (
                  <p className="nesio-dict-hint" role="status">{t('AI 查词中…', 'Looking up with AI…')}</p>
                )}
                {aiErr && (
                  <div className="nesio-dict-ai-err" role="alert">
                    <p>{aiErr}</p>
                    <button type="button" className="nesio-dict-retry" onClick={() => { void runAiLookup(q); }}>
                      {t('重试', 'Retry')}
                    </button>
                  </div>
                )}
                <div className="nesio-dict-list">
                  {hits.map((h, i) => renderCard(h, i))}
                  {aiEntry && renderCard({ entry: aiEntry, fromAi: true }, 999)}
                </div>
              </>
            )}

            {tab === 'book' && (
              book.length === 0
                ? <p className="nesio-dict-empty">{t('生词本还是空的 —— 查到词点星星收藏。', 'Wordbook is empty — star a word to save it.')}</p>
                : <div className="nesio-dict-list">{book.map((e, i) => renderCard({ entry: e }, i))}</div>
            )}
          </>
        )}

        {err && <p className="nesio-dict-err" role="alert">{err}</p>}
      </div>
    </NesioSheet>
  );
}
