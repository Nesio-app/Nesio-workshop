'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  addToFreeze,
  getFreezeItems,
  getActiveFreezeItems,
  getThawedItems,
  resolveItem,
  isShoppingUrl,
  type FreezeItem,
} from '@/lib/platform/impulse-guard';
import type { BarcodeResult } from './BarcodeScanSheet';

const BarcodeScanSheet = dynamic(() => import('./BarcodeScanSheet'), { ssr: false });
import { earnPoints, addWishFromFreeze, getPoints, DISCIPLINE_BONUS } from '@/lib/platform/rewards-engine';
import RewardsWarehouse from './RewardsWarehouse';
import { IconSnowflake } from './icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

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
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [tab, setTab] = useState<'add' | 'list' | 'rewards'>('list');
  const [points, setPoints] = useState(0);
  const [flash, setFlash] = useState('');
  const [urlInput, setUrlInput] = useState(initialUrl ?? '');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedProduct | null>(null);
  const [parseError, setParseError] = useState('');
  const [freezeHours, setFreezeHours] = useState(24);
  const [items, setItems] = useState<FreezeItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(getFreezeItems());
    setPoints(getPoints());
    const onPts = () => setPoints(getPoints());
    window.addEventListener('nesio-rewards-updated', onPts);
    if (initialUrl) {
      setTab('add');
      setUrlInput(initialUrl);
      void parseUrl(initialUrl);
    }
    return () => window.removeEventListener('nesio-rewards-updated', onPts);
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
        setParseError(L(dict, '无法解析该链接，请手动填写商品名称', "Couldn't parse the link — enter the item name manually"));
        setParsed({ title: url });
      }
    } catch {
      setParseError(L(dict, '网络错误，可以直接填写商品名称', 'Network error — you can just type the item name'));
      setParsed({ title: url });
    } finally {
      setParsing(false);
    }
  }

  function handleScanResult(r: BarcodeResult) {
    setScanOpen(false);
    if (r.url) setUrlInput(r.url);
    const title = r.title || (r.upc ? L(dict, `条码 ${r.upc}`, `Barcode ${r.upc}`) : '');
    const priceLabel = r.priceLabel || (typeof r.price === 'number' && r.price > 0 ? `¥${r.price}` : undefined);
    setParsed({ title, price: priceLabel, image: r.image, store: r.store });
    setParseError(title ? '' : L(dict, '扫到码了,但商品库没这件。手动填名称,或用「拍一下」拍商品让 AI 认。', 'Scanned, but not in the product db. Type the name, or use the camera to let AI recognise it.'));
    setTab('add');
  }

  async function handleFreeze() {
    // 扫码/手填可能没有 URL,只要有商品名就能冻
    if (!parsed || !parsed.title.trim()) return;
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
    const target = items.find((x) => x.id === id);
    resolveItem(id, decision, decision === 'extended' ? 24 : undefined);
    setItems(getFreezeItems());
    // 忍住没买 → 自律积分 + 落进奖品仓库当愿望(复用 storage-ios「不买了 +PTS」机制)
    if (decision === 'skipped' && target) {
      earnPoints(DISCIPLINE_BONUS, 'freeze_decline', dict === 'en' ? `Resisted: ${target.title}` : `忍住没买:${target.title}`);
      const wish = addWishFromFreeze(target);
      setFlash(
        wish
          ? L(dict, `拦截成功 +${DISCIPLINE_BONUS} 积分 · 已存进奖品仓库`, `Resisted +${DISCIPLINE_BONUS} pts · saved to rewards`)
          : L(dict, `拦截成功 +${DISCIPLINE_BONUS} 积分`, `Resisted +${DISCIPLINE_BONUS} pts`),
      );
      setTimeout(() => setFlash(''), 2400);
    }
  }

  function hoursUntilThaw(thawAt: string): string {
    const diff = new Date(thawAt).getTime() - Date.now();
    if (diff <= 0) return L(dict, '已解冻', 'Thawed');
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return L(dict, `${m}分钟`, `${m} min`);
  }

  if (!open) return null;

  const active = getActiveFreezeItems();
  const thawed = getThawedItems();
  const resolved = items.filter((i) => i.decision !== 'pending');

  return (
    <div className="nesio-freeze-overlay" onClick={onClose}>
      <div className="nesio-freeze-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nesio-freeze-header">
          <span className="nesio-freeze-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconSnowflake size={16} /> {L(dict, '冷冻仓', 'Freeze vault')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="nesio-rewards-pts-badge" onClick={() => setTab('rewards')} title={L(dict, '积分 · 点开奖品仓库', 'Points · open rewards')}>
              ⬡ {points} {L(dict, '积分', 'pts')}
            </button>
            <button type="button" className="nesio-freeze-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <p className="nesio-freeze-hint">{L(dict, '冲动想买？先冻 24 小时，冷静一下再决定', 'Impulse buy? Freeze it 24 hours and decide with a cool head')}</p>

        {flash && <div className="nesio-rewards-flash">{flash}</div>}

        {/* Tabs */}
        <div className="nesio-freeze-tabs">
          <button type="button" className={`nesio-freeze-tab${tab === 'list' ? ' nesio-freeze-tab--active' : ''}`} onClick={() => setTab('list')}>
            {L(dict, '清单', 'List')} {active.length > 0 && <span className="nesio-freeze-badge">{active.length}</span>}
          </button>
          <button type="button" className={`nesio-freeze-tab${tab === 'add' ? ' nesio-freeze-tab--active' : ''}`} onClick={() => setTab('add')}>
            + {L(dict, '冻住', 'Freeze')}
          </button>
          <button type="button" className={`nesio-freeze-tab${tab === 'rewards' ? ' nesio-freeze-tab--active' : ''}`} onClick={() => setTab('rewards')}>
            {L(dict, '奖品仓库', 'Rewards')}
          </button>
        </div>

        {tab === 'rewards' && <RewardsWarehouse />}

        {/* Add tab */}
        {tab === 'add' && (
          <div className="nesio-freeze-add">
            <input
              className="nesio-freeze-url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={L(dict, '粘贴购物链接（淘宝/京东/Amazon…）', 'Paste a shopping link (Amazon, Taobao…)')}
              onBlur={(e) => { if (e.target.value.trim()) void parseUrl(e.target.value.trim()); }}
            />
            <div className="nesio-freeze-add-btns">
              <button
                type="button"
                className="nesio-freeze-parse-btn"
                onClick={() => void parseUrl(urlInput)}
                disabled={parsing || !urlInput.trim()}
              >
                {parsing ? L(dict, '解析中…', 'Parsing…') : L(dict, '解析', 'Parse')}
              </button>
              <button type="button" className="nesio-freeze-scan-btn" onClick={() => setScanOpen(true)}>
                {L(dict, '扫码识别商品', 'Scan a code')}
              </button>
            </div>

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
                    placeholder={L(dict, '商品名称', 'Item name')}
                  />
                  {parsed.price && <p className="nesio-freeze-price">{parsed.price}</p>}
                  {parsed.store && <p className="nesio-freeze-store">{parsed.store}</p>}
                </div>
              </div>
            )}

            {parsed && (
              <>
                <div className="nesio-freeze-hours-row">
                  <span className="nesio-freeze-hours-label">{L(dict, '冷冻时长', 'Freeze for')}</span>
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
                  {saved ? L(dict, '✓ 已冻住', '✓ Frozen') : saving ? L(dict, '冻中…', 'Freezing…') : L(dict, `冻 ${freezeHours}h`, `Freeze ${freezeHours}h`)}
                </button>
              </>
            )}
          </div>
        )}

        {/* List tab */}
        {tab === 'list' && (
          <div className="nesio-freeze-list">
            {active.length === 0 && thawed.length === 0 && resolved.length === 0 && (
              <p className="nesio-freeze-empty">{L(dict, '冷冻仓是空的。粘贴购物链接或手动输入商品名称来冻住。', 'The vault is empty. Paste a shopping link or type an item name to freeze it.')}</p>
            )}

            {thawed.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label">{L(dict, '已解冻，可以决定了', 'Thawed — time to decide')}</p>
                {thawed.map((item) => (
                  <FreezeItemCard key={item.id} item={item} onResolve={handleResolve} hoursUntilThaw={hoursUntilThaw} />
                ))}
              </div>
            )}

            {active.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label">{L(dict, '冷冻中', 'Frozen')}</p>
                {active.map((item) => (
                  <FreezeItemCard key={item.id} item={item} onResolve={handleResolve} hoursUntilThaw={hoursUntilThaw} />
                ))}
              </div>
            )}

            {resolved.length > 0 && (
              <div className="nesio-freeze-section">
                <p className="nesio-freeze-section-label" style={{ opacity: 0.5 }}>{L(dict, '已决定', 'Decided')}</p>
                {resolved.slice(0, 5).map((item) => (
                  <div key={item.id} className="nesio-freeze-item nesio-freeze-item--resolved">
                    <span className="nesio-freeze-item-name">{item.title}</span>
                    <span className="nesio-freeze-decision-badge">
                      {item.decision === 'bought' ? L(dict, '买了 ✓', 'Bought ✓') : L(dict, '没买 ✗', 'Skipped ✗')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {scanOpen && <BarcodeScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScanResult} />}
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
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
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
          {isFrozen ? L(dict, `还剩 ${hoursUntilThaw(item.thawAt)}`, `${hoursUntilThaw(item.thawAt)} left`) : L(dict, '解冻了，该决定了', 'Thawed — decide now')}
        </p>
        <div className="nesio-freeze-item-actions">
          <button type="button" className="nesio-freeze-action-btn nesio-freeze-action-btn--buy" onClick={() => onResolve(item.id, 'bought')}>{L(dict, '买了', 'Bought')}</button>
          <button type="button" className="nesio-freeze-action-btn nesio-freeze-action-btn--skip" onClick={() => onResolve(item.id, 'skipped')}>{L(dict, '不买了', 'Skipped')}</button>
          {isFrozen && (
            <button type="button" className="nesio-freeze-action-btn" onClick={() => onResolve(item.id, 'extended')}>{L(dict, '再冻24h', 'Freeze +24h')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
