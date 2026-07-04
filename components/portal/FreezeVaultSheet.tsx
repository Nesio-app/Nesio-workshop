'use client';

import { useEffect, useState } from 'react';
import {
  addToFreeze,
  getFreezeItems,
  getActiveFreezeItems,
  getThawedItems,
  resolveItem,
  isShoppingUrl,
  type FreezeItem,
} from '@/lib/platform/impulse-guard';
import { IconSnowflake } from './icons';

interface FreezeVaultSheetProps {
  open: boolean;
  onClose: () => void;
  initialUrl?: string;
}

interface ParsedProduct {
  title: string;
  price?: string;
  image?: string;
  store?: string;
  description?: string;
}

export default function FreezeVaultSheet({ open, onClose, initialUrl }: FreezeVaultSheetProps) {
  const [tab, setTab] = useState<'add' | 'list'>('list');
  const [urlInput, setUrlInput] = useState(initialUrl ?? '');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedProduct | null>(null);
  const [parseError, setParseError] = useState('');
  const [freezeHours, setFreezeHours] = useState(24);
  const [items, setItems] = useState<FreezeItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(getFreezeItems());
    if (initialUrl) {
      setTab('add');
      setUrlInput(initialUrl);
      void parseUrl(initialUrl);
    }
  }, [open, initialUrl]);

  async function parseUrl(url: string) {
    if (!url.trim()) return;
    setParsing(true);
    setParsed(null);
    setParseError('');
    try {
      const res = await fetch('/api/portal/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as { ok: boolean; title?: string; price?: string; image?: string; store?: string; description?: string; error?: string };
      if (data.ok && data.title) {
        setParsed({ title: data.title, price: data.price, image: data.image, store: data.store, description: data.description });
      } else {
        setParseError('无法解析该链接，请手动填写商品名称');
        setParsed({ title: url });
      }
    } catch {
      setParseError('网络错误，可以直接填写商品名称');
      setParsed({ title: url });
    } finally {
      setParsing(false);
    }
  }

  async function handleFreeze() {
    if (!parsed || !urlInput.trim()) return;
    setSaving(true);
    addToFreeze({
      url: urlInput.trim(),
      title: parsed.title,
      price: parsed.price,
      image: parsed.image,
      store: parsed.store,
      freezeHours,
    });
    setItems(getFreezeItems());
    setSaved(true);
    setSaving(false);
    setTimeout(() => {
      setSaved(false);
      setParsed(null);
      setUrlInput('');
      setTab('list');
    }, 1200);
  }

  function handleResolve(id: string, decision: 'bought' | 'skipped' | 'extended') {
    resolveItem(id, decision, decision === 'extended' ? 24 : undefined);
    setItems(getFreezeItems());
  }

  function hoursUntilThaw(thawAt: string): string {
    const diff = new Date(thawAt).getTime() - Date.now();
    if (diff <= 0) return '已解冻';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}分钟`;
  }

  if (!open) return null;

  const active = getActiveFreezeItems();
  const thawed = getThawedItems();
  const resolved = items.filter((i) => i.decision !== 'pending');

  return (
    <div className="nesio-freeze-overlay" onClick={onClose}>
      <div className="nesio-freeze-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nesio-freeze-header">
          <span className="nesio-freeze-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconSnowflake size={16} /> 冷冻仓</span>
          <button type="button" className="nesio-freeze-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-freeze-hint">冲动想买？先冻 24 小时，冷静一下再决定</p>

        {/* Tabs */}
        <div className="nesio-freeze-tabs">
          <button type="button" className={`nesio-freeze-tab${tab === 'list' ? ' nesio-freeze-tab--active' : ''}`} onClick={() => setTab('list')}>
            清单 {active.length > 0 && <span className="nesio-freeze-badge">{active.length}</span>}
          </button>
          <button type="button" className={`nesio-freeze-tab${tab === 'add' ? ' nesio-freeze-tab--active' : ''}`} onClick={() => setTab('add')}>
            + 冻住
          </button>
        </div>

        {/* Add tab */}
        {tab === 'add' && (
          <div className="nesio-freeze-add">
            <input
              className="nesio-freeze-url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="粘贴购物链接（淘宝/京东/Amazon…）"
              onBlur={(e) => { if (e.target.value.trim()) void parseUrl(e.target.value.trim()); }}
            />
            <button
              type="button"
              className="nesio-freeze-parse-btn"
              onClick={() => void parseUrl(urlInput)}
              disabled={parsing || !urlInput.trim()}
            >
              {parsing ? '解析中…' : '解析'}
            </button>

            {parseError && <p className="nesio-freeze-error">{parseError}</p>}

            {parsed && (
              <div className="nesio-freeze-preview">
                {parsed.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={parsed.image} alt="" className="nesio-freeze-preview-img" />
                )}
                <div className="nesio-freeze-preview-info">
                  <input
                    className="nesio-freeze-name-input"
                    value={parsed.title}
                    onChange={(e) => setParsed((prev) => prev ? { ...prev, title: e.target.value } : null)}
                    placeholder="商品名称"
                  />
                  {parsed.price && <p className="nesio-freeze-price">{parsed.price}</p>}
                  {parsed.store && <p className="nesio-freeze-store">{parsed.store}</p>}
                </div>
              </div>
            )}

            {parsed && (
              <>
                <div className="nesio-freeze-hours-row">
                  <span className="nesio-freeze-hours-label">冷冻时长</span>
                  {[24, 48, 72].map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`nesio-freeze-hours-chip${freezeHours === h ? ' nesio-freeze-hours-chip--active' : ''}`}
                      onClick={() => setFreezeHours(h)}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="nesio-freeze-commit-btn"
                  onClick={handleFreeze}
                  disabled={saving || !parsed.title.trim()}
                >
                  {saved ? '✓ 已冻住' : saving ? '冻中…' : `冻 ${freezeHours}h`}
                </button>
              </>
            )}
          </div>
        )}

        {/* List tab */}
        {tab === 'list' && (
          <div className="nesio-freeze-list">
            {active.length === 0 && thawed.length === 0 && resolved.length === 0 && (
              <p className="nesio-freeze-empty">冷冻仓是空的。粘贴购物链接或手动输入商品名称来冻住。</p>
            )}

            {thawed.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label">已解冻，可以决定了</p>
                {thawed.map((item) => (
                  <FreezeItemCard key={item.id} item={item} onResolve={handleResolve} hoursUntilThaw={hoursUntilThaw} />
                ))}
              </div>
            )}

            {active.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label">冷冻中</p>
                {active.map((item) => (
                  <FreezeItemCard key={item.id} item={item} onResolve={handleResolve} hoursUntilThaw={hoursUntilThaw} />
                ))}
              </div>
            )}

            {resolved.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label" style={{ opacity: 0.5 }}>已决定</p>
                {resolved.slice(0, 5).map((item) => (
                  <div key={item.id} className="nesio-freeze-item nesio-freeze-item--resolved">
                    <span className="nesio-freeze-item-name">{item.title}</span>
                    <span className="nesio-freeze-decision-badge">
                      {item.decision === 'bought' ? '买了 ✓' : '没买 ✗'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FreezeItemCard({
  item,
  onResolve,
  hoursUntilThaw,
}: {
  item: FreezeItem;
  onResolve: (id: string, d: 'bought' | 'skipped' | 'extended') => void;
  hoursUntilThaw: (t: string) => string;
}) {
  const isFrozen = new Date(item.thawAt).getTime() > Date.now();
  return (
    <div className="nesio-freeze-item">
      {item.image && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={item.image} alt="" className="nesio-freeze-item-img" />
      )}
      <div className="nesio-freeze-item-body">
        <p className="nesio-freeze-item-name">{item.title}</p>
        {item.price && <p className="nesio-freeze-item-price">{item.price}</p>}
        {item.store && <p className="nesio-freeze-item-store">{item.store}</p>}
        <p className="nesio-freeze-item-time">
          {isFrozen ? `还剩 ${hoursUntilThaw(item.thawAt)}` : '解冻了，该决定了'}
        </p>
        <div className="nesio-freeze-item-actions">
          <button type="button" className="nesio-freeze-action-btn nesio-freeze-action-btn--buy" onClick={() => onResolve(item.id, 'bought')}>买了</button>
          <button type="button" className="nesio-freeze-action-btn nesio-freeze-action-btn--skip" onClick={() => onResolve(item.id, 'skipped')}>不买了</button>
          {isFrozen && (
            <button type="button" className="nesio-freeze-action-btn" onClick={() => onResolve(item.id, 'extended')}>再冻24h</button>
          )}
        </div>
      </div>
    </div>
  );
}
