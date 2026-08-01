'use client';

/**
 * 首页的每日简报入口(2026-08-01,用户:「每日文字简报在哪里,没有见到」)。
 *
 * 查下来他找不到是对的:简报**唯一**的入口是设置 → 「看每日简报 demo」,
 * 那行文案自己都写着「上线后每天早晨推给你的那张」—— 也就是说它从来没上过首页。
 * 一个叫「每日简报」的东西藏在设置的第二屏里,等于没有。
 *
 * 这里只做入口,不做第二份简报:点开的还是同一张 DailyBriefSheet(nesio-open-brief),
 * 内容、检索、Pro 门全都不动。两份实现会立刻开始漂移。
 *
 * 形态上刻意克制(Calm≠Dead):
 *   · 一行,不是一张自动展开的大卡 —— 简报是「你想看的时候点开」,
 *     不是每天早上强塞你一屏字;
 *   · 今天看过之后**不消失**,只是收成安静的一行。消失的话他明天又要问一次
 *     「在哪里」——而这正是这条 bug 的由来;
 *   · 没有权益的不显示,也不做成一个点了才发现要付钱的钩子 ——
 *     那是把升级引导伪装成功能。
 */

import { useCallback, useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconNote } from '../icons';

/**
 * 今天开过简报没有。**cache 类**:「换台设备从零开始是否正确?」——是的,
 * 这是这台机器上「今天早上我看没看过」的 UI 状态,不是用户数据。
 * 必须在 scripts/storage-key-registry.test.mjs 登记(未登记默认 durable,会悄悄进备份)。
 */
export const BRIEF_SEEN_KEY = 'nesio-daily-brief-seen-v1';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DailyBriefRow() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [allowed, setAllowed] = useState(false);
  const [seenToday, setSeenToday] = useState(true);   // 先当看过,免得权益还没查出来就闪一下

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 和设置里那个入口同一道门(ai_routine)。这里不做「点了才发现要付钱」的钩子。
      const { canUse } = await import('@/lib/portal/entitlement');
      if (!alive) return;
      setAllowed(canUse('ai_routine'));
      try { setSeenToday(localStorage.getItem(BRIEF_SEEN_KEY) === todayKey()); }
      catch { setSeenToday(false); }
    })();
    return () => { alive = false; };
  }, []);

  const open = useCallback(() => {
    try { localStorage.setItem(BRIEF_SEEN_KEY, todayKey()); } catch { /* 记不住就下次再提示一遍,不阻断 */ }
    setSeenToday(true);
    window.dispatchEvent(new CustomEvent('nesio-open-brief'));
  }, []);

  if (!allowed) return null;

  return (
    <button
      type="button"
      className={`nesio-brief-row${seenToday ? ' is-seen' : ''}`}
      onClick={open}
    >
      <span className="nesio-brief-row-icon" aria-hidden><IconNote size={15} /></span>
      <span className="nesio-brief-row-body">
        <span className="nesio-brief-row-title">
          {L(dict, '今天这一段', "Today, in a paragraph")}
        </span>
        <span className="nesio-brief-row-sub">
          {seenToday
            ? L(dict, '今天看过了 · 想再读一遍就点这里', 'Read today · tap to read it again')
            : L(dict, '把今天的安排和提醒写成一段话', 'Your day and reminders, written out')}
        </span>
      </span>
      <span className="nesio-brief-row-chev" aria-hidden>›</span>
    </button>
  );
}

export default DailyBriefRow;
