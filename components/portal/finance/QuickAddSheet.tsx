'use client';

/**
 * QuickAddSheet — 财务「资产 / 估值」更新入口(产品改口:不再手记银行流水)。
 * 只保留资产段:选已有记锚点,或新建资产;净值曲线随锚点即时刷新。
 * 每个异步动作有显式失败态;NesioSheet 原语(bottom);全用设计 token。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listManualAssets, addManualAsset, addAssetAnchor, assetCurrentValue, recordNetWorthSnapshot,
  type ManualAssetKind,
} from '@/lib/portal/finance-assets';
import { formatMoney } from '@/lib/portal/bank-tx';

const ASSET_KINDS: Array<[ManualAssetKind, string, string]> = [
  ['property', '房产', 'Property'], ['vehicle', '车', 'Vehicle'], ['cash', '现金渠道', 'Cash'],
  ['crypto', '加密', 'Crypto'], ['collect', '收藏', 'Collectible'], ['loan', '欠款', 'Loan'],
];

const ANCHOR_NOTES: Array<[string, string]> = [
  ['市场参考', 'Market ref'], ['银行评估', 'Bank appraisal'], ['盘点', 'Recount'], ['自己估的', 'My estimate'],
];

export default function QuickAddSheet({ open, onClose, onSaved, initialSeg, initialAssetId }: {
  open: boolean; onClose: () => void; onSaved: () => void;
  /** 仅兼容旧调用方;资产更新是唯一段。 */
  initialSeg?: 'asset';
  /** 从资产行「更新」进入时预选该资产(丢上下文会让锚点记错对象)。 */
  initialAssetId?: string;
  /** @deprecated 手记流水已撤;保留以免旧调用方报错。 */
  currency?: string;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  // 打开时应用入口上下文(不靠 key 重挂 —— 那会杀掉 Vaul 关闭动画)
  useEffect(() => {
    if (!open) return;
    setAssetId(initialAssetId ?? '');
    setSaved(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSeg, initialAssetId]);
  const [amount, setAmount] = useState('');
  const [assetId, setAssetId] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [assetKind, setAssetKind] = useState<ManualAssetKind>('property');
  const [anchorNote, setAnchorNote] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  // 保存成功的一拍:对勾描线 → 短停后再关,不打断关闭动画
  const [saved, setSaved] = useState(false);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimer.current != null) window.clearTimeout(closeTimer.current); }, []);

  const assets = useMemo(() => listManualAssets(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setAmount(''); setAssetId(''); setNewAssetName(''); setAnchorNote(''); setErr(''); };

  function save() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) { setErr(t('金额要大于 0。', 'Amount must be above 0.')); return; }
    setSaving(true); setErr('');
    try {
      if (assetId) {
        const d = new Date(); // 本地日键(UTC 会把晚上记的锚点标成明天)
        const localDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const ok = addAssetAnchor(assetId, { date: localDay, value: v, ...(anchorNote ? { note: anchorNote } : {}) });
        if (!ok) throw new Error('anchor_failed');
      } else {
        const name = newAssetName.trim();
        if (!name) { setErr(t('给资产起个名字。', 'Name the asset first.')); setSaving(false); return; }
        addManualAsset({ name, kind: assetKind, value: v, ...(anchorNote ? { note: anchorNote } : {}) });
      }
      recordNetWorthSnapshot(); // 资产变动即刻反映到净值曲线
      onSaved();
      setSaved(true);
      closeTimer.current = window.setTimeout(() => {
        setSaved(false); reset(); onClose();
      }, 700);
    } catch {
      setErr(t('没存上 —— 再试一次。', 'Could not save — try again.'));
    } finally {
      setSaving(false);
    }
  }

  const chip = (on: boolean): React.CSSProperties => ({
    border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '5px 10px',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', cursor: 'pointer',
    background: on ? 'var(--portal-accent-soft-md)' : 'transparent',
    color: on ? 'var(--portal-accent)' : 'var(--portal-muted)',
    borderColor: on ? 'transparent' : 'var(--portal-line)', fontWeight: on ? 700 : 400,
  });
  const label: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: '0 0 4px' };
  const input: React.CSSProperties = {
    width: '100%', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)',
    padding: '10px 12px', fontSize: 'var(--text-body)', background: 'var(--portal-bg)',
    color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)',
  };

  return (
    <NesioSheet variant="bottom" open={open} onOpenChange={(o) => { if (!o) { if (closeTimer.current != null) window.clearTimeout(closeTimer.current); setSaved(false); reset(); onClose(); } }} ariaLabel={t('更新资产', 'Update asset')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
        <div>
          <p style={label}>{t('估值金额', 'Value')}</p>
          <input style={{ ...input, fontSize: 'var(--text-h2)', fontWeight: 700 }} inputMode="decimal" placeholder="0"
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>

        <div>
          <p style={label}>{t('给谁记(选已有 = 记一条新估值锚点)', 'Which asset (existing = new anchor)')}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {assets.map((a) => (
              <button key={a.id} type="button" style={chip(assetId === a.id)}
                onClick={() => { setAssetId((v) => (v === a.id ? '' : a.id)); setNewAssetName(''); }}>
                {a.name} · {formatMoney(assetCurrentValue(a))}
              </button>
            ))}
            <input style={{ ...input, width: 120, padding: '5px 10px', fontSize: 'var(--text-xs)' }}
              placeholder={t('+ 新资产名', '+ New asset')} value={newAssetName}
              onChange={(e) => { setNewAssetName(e.target.value); setAssetId(''); }} />
          </div>
        </div>
        {!assetId && (
          <div>
            <p style={label}>{t('类型', 'Kind')}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ASSET_KINDS.map(([k, zh, en]) => (
                <button key={k} type="button" style={chip(assetKind === k)} onClick={() => setAssetKind(k)}>{L(dict, zh, en)}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p style={label}>{t('依据(会存进锚点)', 'Basis (saved with the anchor)')}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ANCHOR_NOTES.map(([zh, en]) => (
              <button key={zh} type="button" style={chip(anchorNote === L(dict, zh, en))} onClick={() => { const lbl = L(dict, zh, en); setAnchorNote((v) => (v === lbl ? '' : lbl)); }}>{L(dict, zh, en)}</button>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: 0, lineHeight: 1.6 }}>
          {t('锚点是带日期的事实,随时可再记;净值曲线在锚点之间按直线补齐 —— 只回看,不预测。', 'Anchors are dated facts you can re-record anytime; the curve interpolates between them — retrospective only.')}
        </p>

        {err && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-risk)', margin: 0 }}>{err}</p>}

        <button type="button" onClick={save} disabled={saving || saved}
          style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px', fontSize: 'var(--text-body)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: saved ? 'var(--status-go)' : 'var(--portal-accent)', color: '#fff', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {saved ? (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path className="nesio-check-draw" d="M3 8.5 6.5 12 13 4.5" pathLength={1}
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('记下了', 'Saved')}
            </>
          ) : saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}
        </button>
        <button type="button" onClick={() => { reset(); onClose(); }}
          style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'transparent', color: 'var(--portal-accent)' }}>
          {t('先不记', 'Not now')}
        </button>
      </div>
    </NesioSheet>
  );
}
