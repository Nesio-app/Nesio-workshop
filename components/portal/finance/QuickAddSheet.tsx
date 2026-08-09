'use client';

/**
 * QuickAddSheet — 财务全局「+」记一笔(财务大修 P1;设计=artifact fb540e24 屏 5)。
 * 三段合一:支出 / 收入 / 资产·估值 —— 没有独立「手动账本」,记的东西全部混入统一财务口径:
 * 收支走 finance-sources.addManualEntry(唯一账口),资产/估值走 finance-assets 锚点。
 * 每个异步动作有显式失败态;NesioSheet 原语(bottom);全用设计 token。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { addManualEntry } from '@/lib/portal/finance-sources';
import ReceiptScanRow from './ReceiptScanRow';
import {
  listManualAssets, addManualAsset, addAssetAnchor, assetCurrentValue, recordNetWorthSnapshot,
  type ManualAssetKind,
} from '@/lib/portal/finance-assets';
import { COMMON_EXPENSE_CATEGORIES, categoryLabel } from '@/lib/portal/tx-category';
import {
  formatMoney, loadBankAccounts, addManualBankTx, displayAccountName, loadAccountNames,
  type BankAccount,
} from '@/lib/portal/bank-tx';

type Seg = 'expense' | 'income' | 'asset';

const INCOME_CATS: Array<[string, string, string]> = [
  ['GIFT', '人情往来', 'Gift'], ['SALARY', '工资', 'Salary'], ['BONUS', '奖金', 'Bonus'], ['OTHER', '其他', 'Other'],
];

const ASSET_KINDS: Array<[ManualAssetKind, string, string]> = [
  ['property', '房产', 'Property'], ['vehicle', '车', 'Vehicle'], ['cash', '现金渠道', 'Cash'],
  ['crypto', '加密', 'Crypto'], ['collect', '收藏', 'Collectible'], ['loan', '欠款', 'Loan'],
];

const ANCHOR_NOTES: Array<[string, string]> = [
  ['市场参考', 'Market ref'], ['银行评估', 'Bank appraisal'], ['盘点', 'Recount'], ['自己估的', 'My estimate'],
];

export default function QuickAddSheet({ open, onClose, onSaved, initialSeg, initialAssetId, currency }: {
  open: boolean; onClose: () => void; onSaved: () => void; initialSeg?: Seg;
  /** 从资产行「更新」进入时预选该资产(丢上下文会让锚点记错对象)。 */
  initialAssetId?: string;
  /** 记账币种 —— 必须与银行主币种同源,否则 KPI 聚合会把手动账静默排除(P0 修)。 */
  currency?: string;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [seg, setSeg] = useState<Seg>(initialSeg ?? 'expense');
  // 打开时应用入口上下文(不靠 key 重挂 —— 那会杀掉 Vaul 关闭动画)
  useEffect(() => {
    if (!open) return;
    setSeg(initialSeg ?? 'expense');
    setAssetId(initialAssetId ?? '');
    setSaved(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSeg, initialAssetId]);
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const [channelId, setChannelId] = useState('');
  const [newChannel, setNewChannel] = useState('');
  /** 挂到银行/手工账户 → 写入 BankTx 进交易页;空 = 仍走现金渠道账本。 */
  const [accountId, setAccountId] = useState('');
  // 资产段:选已有资产记锚点,或新建
  const [assetId, setAssetId] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [assetKind, setAssetKind] = useState<ManualAssetKind>('property');
  const [anchorNote, setAnchorNote] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  /** 扫发票时发现银行里已经有对得上的一笔 —— 再记就是双计。空串 = 没有。 */
  const [dupTx, setDupTx] = useState('');
  /** 已经看过重复提示、坚持要记。不做成 confirm() 弹窗:那是打断,这里是让你看着做决定。 */
  const [dupAck, setDupAck] = useState(false);
  // 保存成功的一拍:对勾描线(借形 pqoqubbw/icons,纯 CSS)→ 短停后再关,不打断关闭动画
  const [saved, setSaved] = useState(false);
  const closeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimer.current != null) window.clearTimeout(closeTimer.current); }, []);

  const channels = useMemo(() => listManualAssets().filter((a) => a.isChannel), [open, seg]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(() => listManualAssets(), [open, seg]); // eslint-disable-line react-hooks/exhaustive-deps
  const bankAccounts = useMemo((): BankAccount[] => (open ? loadBankAccounts() : []), [open, seg]); // eslint-disable-line react-hooks/exhaustive-deps
  const acctNames = useMemo(() => loadAccountNames(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // P2 持有成本:支出可关联到房/车等固定资产(税金/维修…),归集到资产名下、照常进月支出
  const costAssets = useMemo(() => assets.filter((a) => !a.isChannel && a.kind !== 'loan'), [assets]);
  const [costAssetId, setCostAssetId] = useState('');
  const [costKind, setCostKind] = useState<'tax' | 'repair' | 'insurance' | 'other'>('other');

  const reset = () => { setAmount(''); setCat(''); setNote(''); setChannelId(''); setNewChannel(''); setAccountId(''); setAssetId(''); setNewAssetName(''); setAnchorNote(''); setCostAssetId(''); setCostKind('other'); setErr(''); setDupTx(''); setDupAck(false); };

  function save() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) { setErr(t('金额要大于 0。', 'Amount must be above 0.')); return; }
    // 银行里已经有这笔了。不硬拦 —— 你可能真的想另记一笔;但要你看一眼再点第二次。
    if (dupTx && !dupAck) { setDupAck(true); return; }
    setSaving(true); setErr('');
    try {
      if (seg === 'asset') {
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
      } else if (accountId) {
        // 挂到账户 → 真正进交易页流水(BankTx),不是只在总览出现的现金账。
        const tx = addManualBankTx({
          accountId, amount: v, kind: seg,
          name: note.trim() || (seg === 'income' ? t('手工收入', 'Manual income') : t('手工支出', 'Manual expense')),
          ...(currency ? { currency } : {}),
          ...(cat ? { category: cat } : {}),
        });
        if (!tx) throw new Error('bank_tx_failed');
      } else {
        let ch = channelId;
        if (!ch && newChannel.trim()) {
          ch = addManualAsset({ name: newChannel.trim(), kind: 'cash', value: 0, isChannel: true }).id;
        }
        const row = addManualEntry({
          amount: v, kind: seg, ...(currency ? { currency } : {}),
          ...(cat ? { category: cat } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(ch ? { channelId: ch } : {}),
          ...(seg === 'expense' && costAssetId ? { assetId: costAssetId, assetCostKind: costKind } : {}),
        });
        if (!row) throw new Error('entry_failed');
      }
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
    <NesioSheet variant="bottom" open={open} onOpenChange={(o) => { if (!o) { if (closeTimer.current != null) window.clearTimeout(closeTimer.current); setSaved(false); reset(); onClose(); } }} ariaLabel={t('记一笔', 'Quick add')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
        {/* bug2:3 个 tab 删除 —— 只留一个「记什么」label 区分支出 / 收入 / 固定资产 */}
        <div>
          <p style={label}>{t('记什么', 'Type')}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['expense', '支出', 'Expense'], ['income', '收入', 'Income'], ['asset', '固定资产', 'Asset']] as Array<[Seg, string, string]>).map(([id, zh, en]) => (
              <button key={id} type="button" style={chip(seg === id)} onClick={() => { setSeg(id); setCat(''); setCostAssetId(''); setErr(''); setDupTx(''); setDupAck(false); }}>
                {L(dict, zh, en)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p style={label}>{seg === 'asset' ? t('估值金额', 'Value') : t('金额', 'Amount')}</p>
          <input style={{ ...input, fontSize: 'var(--text-h2)', fontWeight: 700 }} inputMode="decimal" placeholder="0"
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          {/* 支出才给「拍发票」—— 收入/估值没有发票这回事。
              端上认字,发票不出手机;抽到金额后会顺便查银行里是不是已经有这笔。 */}
          {seg === 'expense' && (
            <ReceiptScanRow dict={dict} onExtracted={(f, dup) => {
              setAmount(String(f.amount));
              if (!note.trim() && f.merchant) setNote(f.merchant);
              setDupTx(dup ? `${dup.name || ''} · ${dup.date} · ${dup.amount.toFixed(2)}` : '');
            }} />
          )}
        </div>

        {seg !== 'asset' && (
          <>
            {bankAccounts.length > 0 && (
              <div>
                <p style={label}>{t('记到哪个账户(选了会进交易页)', 'Account (shows on Transactions)')}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {bankAccounts.map((a) => (
                    <button key={a.id} type="button" style={chip(accountId === a.id)}
                      onClick={() => { setAccountId((v) => (v === a.id ? '' : a.id)); setChannelId(''); setNewChannel(''); }}>
                      {displayAccountName(a, acctNames)}{a.mask ? ` ····${a.mask}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!accountId && (
            <div>
              <p style={label}>{t('渠道(可空:现金 / 红包等银行拍不到的)', 'Channel (optional: cash / red packet…)')}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {channels.map((c) => (
                  <button key={c.id} type="button" style={chip(channelId === c.id)} onClick={() => { setChannelId((v) => (v === c.id ? '' : c.id)); setNewChannel(''); }}>{c.name}</button>
                ))}
                <input style={{ ...input, width: 110, padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                  placeholder={t('+ 新渠道', '+ New channel')} value={newChannel}
                  onChange={(e) => { setNewChannel(e.target.value); setChannelId(''); }} />
              </div>
            </div>
            )}
            <div>
              <p style={label}>{t('分类', 'Category')}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(seg === 'expense'
                  ? COMMON_EXPENSE_CATEGORIES.slice(0, 8).map((c) => [c, categoryLabel(c, 'zh'), categoryLabel(c, 'en')] as [string, string, string])
                  : INCOME_CATS
                ).map(([id, zh, en]) => (
                  <button key={id} type="button" style={chip(cat === id)} onClick={() => setCat((v) => (v === id ? '' : id))}>{L(dict, zh, en)}</button>
                ))}
              </div>
            </div>
            {seg === 'expense' && !accountId && costAssets.length > 0 && (
              <div>
                <p style={label}>{t('关联资产(可空:税金 / 维修记到房、车名下)', 'Tie to asset (optional: tax / repair)')}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {costAssets.map((a) => (
                    <button key={a.id} type="button" style={chip(costAssetId === a.id)} onClick={() => setCostAssetId((v) => (v === a.id ? '' : a.id))}>{a.name}</button>
                  ))}
                </div>
                {costAssetId && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {([['tax', '税金', 'Tax'], ['repair', '维修', 'Repair'], ['insurance', '保险', 'Insurance'], ['other', '其他', 'Other']] as Array<['tax' | 'repair' | 'insurance' | 'other', string, string]>).map(([k, zh, en]) => (
                      <button key={k} type="button" style={chip(costKind === k)} onClick={() => setCostKind(k)}>{L(dict, zh, en)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <p style={label}>{t('备注(可空)', 'Note (optional)')}</p>
              <input style={input} placeholder={t('例:外婆给的红包', 'e.g. red packet from grandma')} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}

        {seg === 'asset' && (
          <>
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
          </>
        )}

        {dupTx && (
          <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', margin: 0 }}>
            {t(`银行里已经有一笔对得上:${dupTx}。再记一笔这钱会被算两次。`,
              `Your bank already has a matching charge: ${dupTx}. Recording it again would count this money twice.`)}
            {dupAck && ' '}{dupAck && t('还是要记的话,再点一次「保存」。', 'Tap Save again if you still want to record it.')}
          </p>
        )}

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
          ) : saving ? t('保存中…', 'Saving…') : (dupTx && dupAck) ? t('还是记一笔', 'Record anyway') : t('保存', 'Save')}
        </button>
        <button type="button" onClick={() => { reset(); onClose(); }}
          style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: 'transparent', color: 'var(--portal-accent)' }}>
          {t('先不记', 'Not now')}
        </button>
      </div>
    </NesioSheet>
  );
}
