'use client';

/**
 * useFeatureEnabled — 子功能开关的 React 读取。入口组件用它决定要不要渲染入口/内容,
 * 订阅 MODULE_OVERRIDES_EVENT 后随「功能开关中心」的切换实时变(不需刷新)。
 * SSR 期返回 defaultOn,客户端挂载后校正,避免水合不一致。
 */

import { useEffect, useState } from 'react';
import { isFeatureEnabled, MODULE_OVERRIDES_EVENT } from '@/lib/portal/module-overrides';

export function useFeatureEnabled(id: string, defaultOn = true): boolean {
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    const sync = () => setOn(isFeatureEnabled(id, defaultOn));
    sync();
    window.addEventListener(MODULE_OVERRIDES_EVENT, sync);
    return () => window.removeEventListener(MODULE_OVERRIDES_EVENT, sync);
  }, [id, defaultOn]);
  return on;
}
