'use client';

/**
 * TeslaSheet — Tesla 数据独立视图(连接器行点「数据」直接看车)。
 * 只是 bottom-sheet 外壳 + 拖拽;内容全在 TeslaPanel(与洞察「资产 → 车」tab 复用同一份,
 * 不留双实现)。数据的长期沉淀:停车点进足迹、充电花费进财务、行程/充电落 Signal。
 */

import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { useSheetDrag } from './use-sheet-drag';
import TeslaPanel from './TeslaPanel';

export default function TeslaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  if (!open) return null;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, 'Tesla 数据', 'Tesla data')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className={`nesio-settings-sheet-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, 'Tesla', 'Tesla')}</h2>
        </div>
        <div className="nesio-settings-sheet-body">
          <TeslaPanel />
        </div>
      </div>
    </div>
  );
}
