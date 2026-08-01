'use client';

/**
 * MentionPicker —— 打 `@` 之后弹出来的候选列表。
 *
 * 只做一件事:把候选摆出来让你选。查询解析和插入都在 `lib/portal/mention.ts`(纯函数)。
 *
 * 键盘要能用:↑↓ 选、Enter 确认、Esc 关掉。手机上是点,但桌面端打字时手不该离开键盘 ——
 * 这个功能的全部价值就是「顺手」,要抬手去点就不顺手了。
 */

import { useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import type { MentionCandidate } from '@/lib/portal/mention';

interface Props {
  items: readonly MentionCandidate[];
  dict: string;
  onPick: (c: MentionCandidate) => void;
  onClose: () => void;
}

export default function MentionPicker({ items, dict, onPick, onClose }: Props) {
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 候选变了就把高亮拉回第一条 —— 不然你继续打字,高亮还停在一个已经不在列表里的位置
  useEffect(() => { setActive(0); }, [items]);

  useEffect(() => {
    if (!items.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((v) => (v + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((v) => (v - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { e.preventDefault(); onPick(items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    // capture:输入框自己也监听 Enter(提交),这里要先拿到 —— 否则选候选会变成直接记下
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, active, onPick, onClose]);

  if (!items.length) return null;

  return (
    <div className="nesio-mention-pop" ref={boxRef} role="listbox"
      aria-label={L(dict, '关联到哪条记忆', 'Link to which memory')}>
      {items.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`nesio-mention-item${i === active ? ' is-active' : ''}`}
          // onMouseDown 而不是 onClick:onClick 之前输入框会先失焦,
          // 失焦会把候选框关掉 —— 那样鼠标永远点不中(踩过同类坑)。
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
