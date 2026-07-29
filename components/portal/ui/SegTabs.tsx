'use client';

/**
 * SegTabs — 全站唯一的分段控件(2026-07-29,用户标注:
 * 「同一产品里 Tab/分段控件至少四种视觉实现」)。
 *
 * 迁移前的五套(都在做同一件事,长得都不一样):
 *   · 健康  `.nesio-health-subtabs` —— pill 容器 + pill 按钮
 *   · 成长  `.ng-subtabs`           —— 12px 圆角容器 + 9px 圆角按钮
 *   · 美味  CookingSheet 内联 SubTabs —— pill,但内联样式自成一套
 *   · 日程  借用 `.nesio-settings-option`(那是**设置行**的样式,不是 tab)
 *   · 衣橱  裸 chip 按钮,连容器都没有
 *
 * 这里定一套:pill 容器(--portal-accent-soft)+ pill 选中块(--portal-card + 强调色文字)。
 * 取的是已有三套的公约数,所以迁移后视觉变化最小,但从此只有一处可改。
 * 样式在 app/globals.css 的 `.nesio-seg*`,全 token,四套皮肤 + 夜间自动跟随。
 *
 * 键盘:左右方向键在 tab 之间移动(role=tablist 的标准行为,原来五套都没有)。
 */
import { useRef } from 'react';

export interface SegTabItem<K extends string> {
  key: K;
  label: string;
  /** 右上角小计数(日程那套原本把数字拼进 label 里,拆出来才对得齐) */
  badge?: string | number;
}

export default function SegTabs<K extends string>({
  items, active, onSelect, ariaLabel, size = 'md',
}: {
  items: ReadonlyArray<SegTabItem<K>>;
  active: K;
  onSelect: (key: K) => void;
  ariaLabel: string;
  /** sm = 子级(一屏里已经有一层 tab 时用) */
  size?: 'sm' | 'md';
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = items.findIndex((x) => x.key === active);
    if (i < 0) return;
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    e.preventDefault();
    onSelect(next.key);
    // 焦点跟着走,否则连按方向键要先 Tab 回来
    wrapRef.current?.querySelector<HTMLButtonElement>(`[data-seg-key="${next.key}"]`)?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={`nesio-seg${size === 'sm' ? ' nesio-seg--sm' : ''}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-seg-key={it.key}
            className={`nesio-seg-tab${on ? ' is-active' : ''}`}
            onClick={() => onSelect(it.key)}
          >
            {it.label}
            {it.badge !== undefined && it.badge !== '' && (
              <span className="nesio-seg-badge">{it.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
