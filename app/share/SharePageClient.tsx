'use client';

/**
 * SharePageClient — 分享进来的内容落地(批次 18)。
 * 有链接:调 /api/portal/parse-url 抓标题/价格/图片 → 冻 24 小时 或 存入记忆。
 * 纯文本:直接存为一条记忆。
 */

import { useEffect, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { addToFreeze } from '@/lib/platform/impulse-guard';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '@/components/portal/use-portal-locale';

interface Parsed { title: string; price?: string; image?: string; store?: string }

function firstUrl(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c.match(/https?:\/\/[^\s"'<>]+/);
    if (m) return m[0];
  }
  return '';
}

export default function SharePageClient() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [{ title, text, url }] = useState(() => {
    if (typeof window === 'undefined') return { title: '', text: '', url: '' };
    const p = new URLSearchParams(window.location.search);
    return { title: p.get('title') || '', text: p.get('text') || '', url: p.get('url') || '' };
  });
  const sharedUrl = firstUrl(url, text, title);
  const sharedText = [title, text].filter(Boolean).join(' ').trim();

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parsing, setParsing] = useState(Boolean(sharedUrl));
  const [done, setDone] = useState('');

  useEffect(() => {
    track('share_receive', { hasUrl: Boolean(sharedUrl) });
    if (!sharedUrl) return;
    fetch('/api/portal/parse-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sharedUrl }),
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; title?: string; price?: string; image?: string; store?: string }>)
      .then((d) => setParsed({ title: (d.ok && d.title) || sharedText || sharedUrl, price: d.price, image: d.image, store: d.store }))
      .catch(() => setParsed({ title: sharedText || sharedUrl }))
      .finally(() => setParsing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayTitle = parsed?.title || sharedText || sharedUrl;

  function saveToMemory() {
    ingestLifeNode({
      name: (displayTitle || L(dict, '分享内容', 'Shared item')).slice(0, 60),
      type: sharedUrl ? 'object' : 'preference',
      source: 'manual',
      confidence: 0.9,
      rawInput: sharedText || sharedUrl,
      tags: ['分享'],
      attributes: {
        ...(sharedUrl ? { url: sharedUrl } : {}),
        ...(parsed?.price ? { price: parsed.price } : {}),
        ...(parsed?.store ? { store: parsed.store } : {}),
      },
      relations: [],
    });
    track('share_save', { frozen: false });
    setDone(L(dict, '已存入 Memory', 'Saved to Memory'));
    setTimeout(() => { window.location.href = '/'; }, 900);
  }

  function freeze24h() {
    addToFreeze({ url: sharedUrl, title: displayTitle.slice(0, 60), price: parsed?.price, freezeHours: 24 });
    track('share_save', { frozen: true });
    setDone(L(dict, '已冻 24 小时,解冻时 Today 会提醒你', 'Frozen for 24h — Today will remind you when it thaws'));
    setTimeout(() => { window.location.href = '/'; }, 1200);
  }

  return (
    <div className="nesio-share-receive">
      <h1 className="nesio-share-receive-title">{L(dict, '分享给 Nesio', 'Shared to Nesio')}</h1>

      {parsing && <p className="nesio-share-receive-hint">{L(dict, '正在解析链接…', 'Parsing the link…')}</p>}

      {!parsing && !done && (
        <div className="nesio-share-receive-card">
          {parsed?.image && (
            // eslint-disable-next-line @next/next/no-img-element -- 外站商品图,运行时 URL
            <img src={parsed.image} alt="" className="nesio-share-receive-img" />
          )}
          <p className="nesio-share-receive-name">{displayTitle || L(dict, '(空内容)', '(empty)')}</p>
          {parsed?.price && <p className="nesio-share-receive-price">{parsed.price}</p>}

          <div className="nesio-share-receive-actions">
            {sharedUrl && (
              <button type="button" className="nesio-cooling-freeze-btn" onClick={freeze24h}>
                {L(dict, '冻 24 小时', 'Freeze 24h')}
              </button>
            )}
            <button type="button" className="nesio-ob-primary-btn" onClick={saveToMemory} disabled={!displayTitle}>
              {L(dict, '存入 Memory', 'Save to Memory')}
            </button>
          </div>
          <a href="/" className="nesio-share-receive-cancel">{L(dict, '取消,回到 Nesio', 'Cancel — back to Nesio')}</a>
        </div>
      )}

      {done && <p className="nesio-share-receive-done">{done}</p>}
    </div>
  );
}
