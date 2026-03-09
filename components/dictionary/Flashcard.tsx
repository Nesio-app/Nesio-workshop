'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import type { LookupResult } from '@/lib/dictionary/types';

interface FlashcardProps {
  data: LookupResult;
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
}

export default function Flashcard({ data, index, total, onNext, onPrev }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => setFlipped(false), [index]);
  const { term, definition, imageUrl, examples } = data;
  const example = examples[0];

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="aspect-[3/4]" style={{ perspective: '1000px' }}>
        <motion.div
          className="relative w-full h-full cursor-pointer"
          onClick={() => setFlipped((f) => !f)}
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 120, damping: 20 }}
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 rounded-2xl bg-white border-2 border-dict-sky/30 shadow-xl overflow-hidden flex flex-col"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="flex-1 relative bg-dict-sunny/20 flex items-center justify-center p-4">
              {imageUrl ? (
                <div className="relative w-full h-full min-h-[180px]">
                  <Image src={imageUrl} alt={term} fill className="object-contain" unoptimized />
                </div>
              ) : (
                <span className="text-6xl opacity-30">📖</span>
              )}
            </div>
            <div className="p-4 bg-white border-t border-dict-sky/20">
              <p className="text-xl font-dict-fun font-bold text-dict-ink text-center">{term}</p>
              <p className="text-xs text-dict-ink/50 text-center mt-1">Tap to flip</p>
            </div>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-2xl bg-dict-mint/10 border-2 border-dict-mint/40 shadow-xl overflow-hidden flex flex-col p-4"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xl font-dict-fun font-bold text-dict-ink mb-2">{term}</p>
            <p className="text-sm text-dict-ink leading-relaxed flex-1 overflow-auto">{definition}</p>
            {example && (
              <div className="mt-3 pt-3 border-t border-dict-mint/30">
                <p className="text-xs text-dict-ink/70 italic">&quot;{example.target}&quot;</p>
                <p className="text-xs text-dict-ink/60 mt-0.5">{example.native}</p>
              </div>
            )}
            <p className="text-xs text-dict-ink/50 text-center mt-2">Tap to flip back</p>
          </div>
        </motion.div>
      </div>

      <div className="flex items-center justify-between mt-4 px-2">
        <button
          type="button"
          onClick={() => { setFlipped(false); onPrev(); }}
          disabled={index <= 0}
          className="rounded-full bg-dict-sky/30 text-dict-ink px-4 py-2 font-medium disabled:opacity-40 transition"
        >
          ← Prev
        </button>
        <span className="text-sm text-dict-ink/70">{index + 1} / {total}</span>
        <button
          type="button"
          onClick={() => { setFlipped(false); onNext(); }}
          disabled={index >= total - 1}
          className="rounded-full bg-dict-sky/30 text-dict-ink px-4 py-2 font-medium disabled:opacity-40 transition"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
