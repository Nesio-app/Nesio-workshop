'use client';

/**
 * BarcodeScanSheet — 扫码识别商品:二维码(商品页 URL)+ 条码(UPC/EAN)(批次 18,批次 43 加二维码)。
 * 解码:@zxing/browser(懒加载,多格式,iOS Safari 没有原生 BarcodeDetector)。
 *   - 二维码/URL → /api/portal/parse-url 解析商品页拿 名称/价格/图/店铺
 *   - 数字条码(8-14 位)→ /api/portal/barcode-lookup(UPCitemdb)
 *   - 纯文本二维码 → 直接当商品名
 * 入口:购买冷静面板、冷冻仓「冻住」tab。
 */

import { useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { track } from '@/lib/portal/telemetry';
import { parsePriceNumber } from '@/lib/platform/rewards-engine';

export interface BarcodeResult {
  upc: string;
  title: string;
  image?: string;
  price?: number;       // 数字参考价(条码库或从价格串解析)
  priceLabel?: string;  // 展示用价格串,如 "¥399"(来自商品页)
  url?: string;         // 商品页 URL(二维码扫到的)
  store?: string;
}

export default function BarcodeScanSheet({ open, onClose, onResult }: {
  open: boolean;
  onClose: () => void;
  onResult: (r: BarcodeResult) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'looking-up' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        setStatus('scanning');
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, async (result) => {
          if (!result || stopped) return;
          const text = result.getText().trim();
          if (!text) return;

          // ── 二维码扫到商品页 URL → 解析商品信息 ──
          if (/^https?:\/\//i.test(text)) {
            stopped = true;
            controls?.stop();
            setStatus('looking-up');
            track('barcode_scan', { kind: 'url' });
            try {
              const res = await fetch('/api/portal/parse-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: text }),
              });
              const data = await res.json() as { ok?: boolean; title?: string; price?: string; image?: string; store?: string };
              onResult({
                upc: '', url: text, title: data.title || '',
                image: data.image, store: data.store,
                priceLabel: data.price, price: parsePriceNumber(data.price),
              });
            } catch {
              onResult({ upc: '', url: text, title: '' }); // 解析失败:URL 本身也有用
            }
            onClose();
            return;
          }

          // ── 数字条码(UPC/EAN)→ 商品库查价 ──
          const code = text.replace(/\D/g, '');
          if (code.length >= 8 && code.length <= 14) {
            stopped = true;
            controls?.stop();
            setStatus('looking-up');
            track('barcode_scan', { kind: 'upc', len: code.length });
            try {
              const res = await fetch(`/api/portal/barcode-lookup?upc=${code}`);
              const data = await res.json() as { ok?: boolean; title?: string; image?: string; price?: number; error?: string };
              onResult(data.ok
                ? { upc: code, title: data.title || '', image: data.image, price: data.price }
                : { upc: code, title: '' });
            } catch {
              onResult({ upc: code, title: '' });
            }
            onClose();
            return;
          }

          // ── 纯文本二维码(非 URL 非条码)→ 当商品名 ──
          if (text.length >= 3) {
            stopped = true;
            controls?.stop();
            track('barcode_scan', { kind: 'text' });
            onResult({ upc: '', title: text });
            onClose();
          }
        });
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error && err.name === 'NotAllowedError'
          ? L(dict, '相机权限被拒绝,请在系统设置里允许', 'Camera permission denied — allow it in system settings')
          : L(dict, '相机启动失败', "Couldn't start the camera"));
      }
    })();

    return () => { stopped = true; controls?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="nesio-barcode-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '扫码识别商品', 'Scan to identify product')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-barcode-card">
        <p className="nesio-barcode-title">{L(dict, '对准二维码或条码', 'Point at a QR code or barcode')}</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 取景器无音轨 */}
        <video ref={videoRef} className="nesio-barcode-video" playsInline muted />
        <p className="nesio-barcode-status">
          {status === 'starting' && L(dict, '正在启动相机…', 'Starting camera…')}
          {status === 'scanning' && L(dict, '扫描中…', 'Scanning…')}
          {status === 'looking-up' && L(dict, '查询商品信息…', 'Looking up the product…')}
          {status === 'error' && errorMsg}
        </p>
        <button type="button" className="nesio-cooling-link" onClick={onClose}>{L(dict, '取消', 'Cancel')}</button>
      </div>
    </div>
  );
}
