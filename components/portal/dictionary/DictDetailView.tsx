'use client';

/**
 * DictDetailView — 欧路式词条详情:释义 / 例句 / 助记·词根·搭配。
 * 离线释义始终可见;例句/助记在 AI 开关打开时懒加载补全并缓存。
 */

import { useCallback, useEffect, useState } from 'react';
import type { DictEntry } from '@/lib/portal/dictionary/offline-lexicon';
import {
  fetchAiEnrich, isInWordbook, loadAiEnabled, loadEnrichCache, saveEnrichCache, toggleWordbook,
} from '@/lib/portal/dictionary/lookup';

type DetailTab = 'senses' | 'examples' | 'study';

export default function DictDetailView({
  entry, fromAi, locale, t, onBack, onBookChange,
}: {
  entry: DictEntry;
  fromAi?: boolean;
  locale: string;
  t: (zh: string, en: string) => string;
  onBack: () => void;
  onBookChange?: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('senses');
  const [enriched, setEnriched] = useState<DictEntry>(() => loadEnrichCache(entry.word) || entry);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [inBook, setInBook] = useState(() => isInWordbook(entry.word));
  const [aiOn, setAiOn] = useState(() => loadAiEnabled());

  useEffect(() => {
    const cached = loadEnrichCache(entry.word);
    setEnriched(cached ? { ...entry, ...cached, senses: entry.senses } : entry);
    setTab('senses');
    setErr('');
    setInBook(isInWordbook(entry.word));
    setAiOn(loadAiEnabled());
  }, [entry]);

  const merged: DictEntry = {
    ...entry,
    ...enriched,
    senses: entry.senses.length ? entry.senses : enriched.senses,
    examples: (enriched.examples?.length ? enriched.examples : entry.examples) || undefined,
    mnemonic: enriched.mnemonic || entry.mnemonic,
    roots: enriched.roots || entry.roots,
    collocations: enriched.collocations?.length ? enriched.collocations : entry.collocations,
  };

  const needEnrich =
    (!merged.examples?.length && tab === 'examples')
    || ((!merged.mnemonic && !merged.roots && !(merged.collocations?.length)) && tab === 'study');

  const runEnrich = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const next = await fetchAiEnrich(entry.word || entry.headword, locale);
      const mergedNext: DictEntry = {
        ...entry,
        ...next,
        senses: entry.senses.length ? entry.senses : next.senses,
        examples: next.examples?.length ? next.examples : entry.examples,
        mnemonic: next.mnemonic || entry.mnemonic,
        roots: next.roots || entry.roots,
        collocations: next.collocations?.length ? next.collocations : entry.collocations,
      };
      saveEnrichCache(mergedNext);
      setEnriched(mergedNext);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ai_failed';
      setErr(msg === 'ai_unavailable'
        ? t('AI 补全暂时不可用 —— 稍后再试。', 'AI enrich unavailable — try again later.')
        : t('AI 补全没成功 —— 点重试。', 'AI enrich failed — tap retry.'));
    } finally {
      setBusy(false);
    }
  }, [entry, locale, t]);

  useEffect(() => {
    if (!aiOn || !needEnrich || busy) return;
    if (loadEnrichCache(entry.word)) return;
    void runEnrich();
  }, [aiOn, needEnrich, busy, entry.word, runEnrich]);

  const onStar = () => {
    const r = toggleWordbook(entry.word);
    if (!r.ok) {
      setErr(t('生词本没存上 —— 本机空间可能满了。', 'Could not save wordbook — storage may be full.'));
      return;
    }
    setInBook(r.inBook);
    onBookChange?.();
  };

  const emptyHint = !aiOn
    ? t('开「AI 查词」可补例句与助记。', 'Turn on AI lookup to fill examples and study notes.')
    : null;

  return (
    <div className="nesio-dict-detail">
      <div className="nesio-dict-detail-bar">
        <button type="button" className="nesio-dict-back" onClick={onBack}>
          ← {t('返回', 'Back')}
        </button>
        <button type="button" className={`nesio-dict-star${inBook ? ' is-on' : ''}`}
          aria-label={inBook ? t('移出生词本', 'Remove from wordbook') : t('加入生词本', 'Add to wordbook')}
          onClick={onStar}>
          {inBook ? '★' : '☆'}
        </button>
      </div>

      <header className="nesio-dict-entry-head">
        <div>
          <h2 className="nesio-dict-headword">{merged.headword}</h2>
          {merged.phonetic && <p className="nesio-dict-phonetic">{merged.phonetic}</p>}
          {fromAi && <p className="nesio-dict-ai-badge">{t('AI 释义', 'AI definition')}</p>}
        </div>
      </header>

      <div className="nesio-dict-detail-tabs" role="tablist">
        {([
          ['senses', t('释义', 'Senses')],
          ['examples', t('例句', 'Examples')],
          ['study', t('助记·搭配', 'Study')],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'senses' && (
        <ul className="nesio-dict-senses">
          {merged.senses.map((s, j) => (
            <li key={j}>
              {s.pos && <span className="nesio-dict-pos">{s.pos}</span>}
              <span className="nesio-dict-def">{s.zh}</span>
              {s.en && <span className="nesio-dict-def-en">{s.en}</span>}
            </li>
          ))}
        </ul>
      )}

      {tab === 'examples' && (
        <div className="nesio-dict-examples">
          {busy && !merged.examples?.length && (
            <p className="nesio-dict-hint" role="status">{t('正在补例句…', 'Fetching examples…')}</p>
          )}
          {merged.examples?.length ? merged.examples.map((ex, j) => (
            <p key={j} className="nesio-dict-ex">
              <span className="nesio-dict-ex-en">{ex.en}</span>
              <span className="nesio-dict-ex-zh">{ex.zh}</span>
            </p>
          )) : !busy && (
            <>
              <p className="nesio-dict-empty">{emptyHint || t('还没有例句。', 'No examples yet.')}</p>
              {!aiOn && (
                <button type="button" className="nesio-dict-retry" style={{ marginTop: 8 }}
                  onClick={() => { void runEnrich(); }}>
                  {t('仍用 AI 补一次', 'Enrich once with AI')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'study' && (
        <div className="nesio-dict-study">
          {busy && !merged.mnemonic && !merged.roots && !(merged.collocations?.length) && (
            <p className="nesio-dict-hint" role="status">{t('正在补助记与搭配…', 'Fetching study notes…')}</p>
          )}
          {merged.mnemonic && (
            <section>
              <h3 className="nesio-dict-study-h">{t('助记', 'Mnemonic')}</h3>
              <p className="nesio-dict-study-p">{merged.mnemonic}</p>
            </section>
          )}
          {merged.roots && (
            <section>
              <h3 className="nesio-dict-study-h">{t('词根 / 词缀', 'Roots')}</h3>
              <p className="nesio-dict-study-p">{merged.roots}</p>
            </section>
          )}
          {merged.collocations && merged.collocations.length > 0 && (
            <section>
              <h3 className="nesio-dict-study-h">{t('搭配', 'Collocations')}</h3>
              <ul className="nesio-dict-collocations">
                {merged.collocations.map((c, j) => <li key={j}>{c}</li>)}
              </ul>
            </section>
          )}
          {!busy && !merged.mnemonic && !merged.roots && !(merged.collocations?.length) && (
            <>
              <p className="nesio-dict-empty">{emptyHint || t('还没有助记内容。', 'No study notes yet.')}</p>
              {!aiOn && (
                <button type="button" className="nesio-dict-retry" style={{ marginTop: 8 }}
                  onClick={() => { void runEnrich(); }}>
                  {t('仍用 AI 补一次', 'Enrich once with AI')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {err && (
        <div className="nesio-dict-ai-err" role="alert">
          <p>{err}</p>
          <button type="button" className="nesio-dict-retry" onClick={() => { void runEnrich(); }}>
            {t('重试', 'Retry')}
          </button>
        </div>
      )}
    </div>
  );
}
