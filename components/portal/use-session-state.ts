'use client';

/**
 * useSessionState —— 组件侧读「我登录了吗」的唯一入口(2026-07-30,bug #21)。
 *
 * 每个组件自己 fetch 一遍 /api/auth/session、各自定义失败怎么办,就会出现
 * 「已登录 · 云同步已开」和「未登录、未授权」同屏。判据在 lib/portal/session-state,
 * 这里只把它接到 React 上:订阅同一份状态,谁先问过后来者直接拿现成的。
 */

import { useEffect, useState } from 'react';
import { currentSession, readSession, subscribeSession, type SessionInfo } from '@/lib/portal/session-state';

export function useSessionState(active: boolean = true): SessionInfo {
  const [info, setInfo] = useState<SessionInfo>(() => currentSession());

  useEffect(() => {
    if (!active) return;
    const off = subscribeSession(setInfo);
    setInfo(currentSession());
    void readSession().then(setInfo);
    return off;
  }, [active]);

  return info;
}
