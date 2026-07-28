'use client';

/**
 * useAutoGrow — 文本框随字数长高。CSS `field-sizing:content` 已在 .ng-ta 上生效,
 * 但 iOS Safari 目前不支持 → 这里做等价兜底:监听 input 按 scrollHeight 调 height。
 * 用户标注(成长页):「文本框应该随着字数扩大」。自持,不需要把 value 传进来。
 */
import { useCallback, useRef } from 'react';

const MAX_PX = 18 * 16;

export function useAutoGrow() {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_PX)}px`;
  }, []);

  // callback ref:挂上就先量一次(带初值的框也对),之后每次 input 再量。
  return useCallback((el: HTMLTextAreaElement | null) => {
    ref.current = el;
    if (!el) return;
    // 原生支持 field-sizing 就别插手,免得和 CSS 打架。
    if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')) return;
    fit(el);
    el.addEventListener('input', () => fit(el));
  }, [fit]);
}
