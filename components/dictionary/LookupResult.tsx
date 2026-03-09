'use client';

import Image from 'next/image';
import PlayAudio from './PlayAudio';
import type { LookupResult as LookupResultType } from '@/lib/dictionary/types';

interface LookupResultProps {
  data: LookupResultType;
  onSaveToNotebook: (entry: LookupResultType) => void;
  saved: boolean;
}

export default function LookupResult({ data, onSaveToNotebook, saved }: LookupResultProps) {
  const { term, definition, imageUrl, examples, usageNote, nativeLang, targetLang } = data;

  return (
    <article className="rounded-2xl bg-white border border-dict-sky/20 shadow-lg overflow-hidden animate-fade-in">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <h2 className="text-2xl font-dict-fun font-bold text-dict-ink break-all">{term}</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PlayAudio text={term} lang={targetLang} label="Pronounce" className="bg-dict-sunny/40 text-dict-ink hover:bg-dict-sunny/60" />
            <button
              type="button"
              onClick={() => onSaveToNotebook(data)}
              disabled={saved}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${saved ? 'bg-dict-mint/40 text-dict-ink cursor-default' : 'bg-dict-mint text-white hover:bg-dict-mint/90'}`}
            >
              {saved ? 'Saved' : 'Save to Notebook'}
            </button>
          </div>
        </div>

        {imageUrl && (
          <div className="relative w-full aspect-square max-w-xs mx-auto rounded-xl overflow-hidden bg-dict-sky/10 mb-4">
            <Image src={imageUrl} alt={term} fill className="object-cover" unoptimized />
          </div>
        )}

        <p className="text-dict-ink leading-relaxed mb-4">{definition}</p>

        <section className="mb-4">
          <h3 className="text-sm font-bold text-dict-coral uppercase tracking-wide mb-2">Examples</h3>
          <ul className="space-y-3">
            {examples.map((ex, i) => (
              <li key={i} className="pl-3 border-l-2 border-dict-lavender/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-dict-ink">{ex.target}</span>
                  <PlayAudio text={ex.target} lang={targetLang} label="Play" className="text-dict-lavender hover:bg-dict-lavender/20" />
                </div>
                <p className="text-dict-ink/70 text-sm mt-0.5">{ex.native}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-bold text-dict-peach uppercase tracking-wide mb-2">Usage note</h3>
          <p className="text-dict-ink/90 text-sm leading-relaxed">{usageNote}</p>
        </section>
      </div>
    </article>
  );
}
