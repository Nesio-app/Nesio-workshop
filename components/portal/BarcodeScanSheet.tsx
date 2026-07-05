'use client';

/**
 * BarcodeScanSheet — 扫商品条码 → 名称/图/价格(批次 18)。
 * 解码:@zxing/browser(懒加载,iOS Safari 没有原生 BarcodeDetector);
 * 查库:/api/portal/barcode-lookup(UPCitemdb)。
 * 入口:购买冷静面板「扫条码查价」、冷冻仓。
 */

import { useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { track } from '@/lib/portal/telemetry';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';

export interface BarcodeResult { upc: string; title: string; image?: string; price?: number }

export default function BarcodeScanSheet({ open, onClose, onResult }: {
  open: boolean;
  onClose: () => void;
  onResult: (r: BarcodeResult) => void;
}) {
  useSheetDismiss(onClose, { enabled: open });
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
          const code = result.getText().replace(/\D/g, '');
          if (code.length < 8) return; // 忽略非商品码
          stopped = true;
          controls?.stop();
          setStatus('looking-up');
          track('barcode_scan', { len: code.length });
          try {
            const res = await fetch(`/api/portal/barcode-lookup?upc=${code}`);
            const data = await res.json() as { ok?: boolean; title?: string; image?: string; price?: number; error?: string };
            if (data.ok) {
              onResult({ upc: code, title: data.title || '', image: data.image, price: data.price });
            } else {
              onResult({ upc: code, title: '' }); // 库里没有:码本身也有用,让调用方处理
            }
          } catch {
            onResult({ upc: code, title: '' });
          }
          onClose();
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
    <div className="nesio-barcode-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '扫条码', 'Scan barcode')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-barcode-card">
        <p className="nesio-barcode-title">{L(dict, '对准商品条码', 'Point at the product barcode')}</p>
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
