'use client';

/**
 * CookingSheet — 做饭 / 库存(workshop 域实验 · M1 库存确定性核心)。
 * 一屏:① 快过期先用(最省钱/少浪费的主线)② 进货(快速添加)③ 库存清单(用掉一份 / 删)。
 * 数据 = 本地 object 节点(打「食材」标),随生活图谱上你自己的云,不共享。过期提醒由现成
 * guidance-engine 自动接。每个写操作有显式失败态(红线);文案暖教练,不用红色制造焦虑。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { IconUtensils, IconClock, IconBox, IconMapPin } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, consumePantry, removePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';

export default function CookingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [items, setItems] = useState<PantryItem[]>([]);
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => { try { setItems(listPantry()); } catch { setErr(t('读不出库存,刷新看看。', 'Could not read the pantry — refresh.')); } }, [t]);
  useEffect(() => { if (open) reload(); }, [open, reload]);

  const soon = useMemo(() => expiringPantry(items, 4), [items]);

  if (!open) return null;

  async function consume(id: string) {
    setBusyId(id + 'use'); setErr('');
    try { if (!consumePantry(id)) setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    catch { setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    setBusyId(''); reload();
  }
  async function remove(id: string) {
    setBusyId(id + 'del'); setErr('');
    try { if (!removePantry(id)) setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    catch { setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    setBusyId(''); reload();
  }

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('做饭 · 库存', 'Cooking · Pantry')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--portal-line)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <IconUtensils size={20} />
            <h2 style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>{t('做饭 · 库存', 'Cooking · Pantry')}</h2>
          </span>
          <button type="button" onClick={onClose} aria-label={t('关闭', 'Close')} style={{ ...backBtn, textAlign: 'right' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

          {/* 快过期先用 —— 主线:用光你已有的、快过期的 */}
          {soon.length > 0 && (
            <section>
              <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconClock size={12} />{t('快过期先用', 'Use these first')}</p>
              <div style={{ ...cardStyle, background: 'var(--status-gentle-soft)', borderColor: 'transparent' }}>
                {soon.map((it, i) => (
                  <div key={it.id} style={{ ...rowStyle, borderBottom: i === soon.length - 1 ? 'none' : rowStyle.borderBottom }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{qtyName(it, t)}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{freshLabel(it.daysLeft, t)}</div>
                    </div>
                    <button type="button" onClick={() => void consume(it.id)} disabled={busyId === it.id + 'use'} style={primaryBtn}>{t('用掉一份', 'Use one')}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 进货 */}
          {showAdd
            ? <AddForm onAdded={() => { setShowAdd(false); reload(); }} onCancel={() => setShowAdd(false)} onError={setErr} dict={dict} t={t} />
            : <button type="button" onClick={() => { setShowAdd(true); setErr(''); }} style={{ ...primaryBtn, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconBox size={14} />{t('进货 · 加一样', 'Stock up · add')}</button>}

          {/* 库存清单 */}
          <section>
            <p style={sectLabel}>{t('家里有的', 'On hand')} {items.length > 0 ? `· ${items.length}` : ''}</p>
            <div style={cardStyle}>
              {items.length === 0 && (
                <p style={{ ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                  {t('还没记库存。拍一下冰箱、或点上面「进货」加一样 —— 之后就能看到「快过期先用」「手上能做什么」。',
                    'Pantry is empty. Add something above — then you’ll see what’s expiring and what you can cook.')}
                </p>
              )}
              {items.map((it, i) => (
                <div key={it.id} style={{ ...rowStyle, borderBottom: i === items.length - 1 ? 'none' : rowStyle.borderBottom }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{qtyName(it, t)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: it.daysLeft != null && it.daysLeft <= 2 ? 'var(--status-gentle)' : 'var(--portal-muted)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                      {it.category && <span>{it.category}</span>}
                      {it.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconMapPin size={10} />{it.location}</span>}
                      {it.daysLeft != null && <span>{freshLabel(it.daysLeft, t)}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => void consume(it.id)} disabled={busyId === it.id + 'use'} style={ghostBtn}>{t('用掉一份', 'Use one')}</button>
                  <button type="button" onClick={() => void remove(it.id)} disabled={busyId === it.id + 'del'} aria-label={t('删除', 'Remove')} style={{ border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' }}>✕</button>
                </div>
              ))}
            </div>
          </section>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 0 }}>
            {t('库存只在你自己的图谱里,随你的云备份走,不共享给别人。快到期会在今天页轻轻提醒你先用掉。',
              'Your pantry lives in your own graph and syncs to your cloud only. Nesio nudges you to use things before they expire.')}
          </p>
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 进货表单 ──────────────────────────────────────────────────────────────────
function AddForm({ onAdded, onCancel, onError, dict, t }: {
  onAdded: () => void; onCancel: () => void; onError: (m: string) => void; dict: 'zh' | 'en'; t: (a: string, b: string) => string;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [expiry, setExpiry] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  function submit() {
    if (!name.trim()) { onError(t('先给它起个名字。', 'Give it a name first.')); return; }
    setBusy(true);
    try {
      const q = Number(qty);
      addPantry({ name: name.trim(), quantity: qty.trim() && Number.isFinite(q) ? q : undefined, expiry: expiry || undefined, location: location.trim() || undefined, category: category || undefined });
      onAdded();
    } catch { onError(t('没加上,再试一次。', 'Could not add — try again.')); setBusy(false); }
  }

  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <input style={inputStyle} placeholder={t('食材(如「牛奶」「菠菜」)', 'Food (e.g. milk, spinach)')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input style={{ ...inputStyle, flex: 1 }} inputMode="numeric" placeholder={t('数量(可空)', 'Qty (optional)')} value={qty} onChange={(e) => setQty(e.target.value)} />
        <input style={{ ...inputStyle, flex: 1 }} type="date" aria-label={t('有效期', 'Expiry')} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <input style={inputStyle} placeholder={t('放哪(如「冰箱」,可空)', 'Where (e.g. fridge, optional)')} value={location} onChange={(e) => setLocation(e.target.value)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {PANTRY_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory((v) => (v === c ? '' : c))}
            style={{ ...chip, ...(category === c ? chipOn : {}) }}>{c}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>{busy ? t('加入中…', 'Adding…') : t('加进库存', 'Add to pantry')}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}

// ── 小工具 ────────────────────────────────────────────────────────────────────
function qtyName(it: PantryItem, t: (a: string, b: string) => string): string {
  return it.quantity != null && it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name;
}
function freshLabel(daysLeft: number | null, t: (a: string, b: string) => string): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return t('过了保质期 · 看看还能不能用', 'Past date · check if still good');
  if (daysLeft === 0) return t('今天到期 · 今天用掉', 'Due today · use today');
  if (daysLeft === 1) return t('还有 1 天', '1 day left');
  return t(`还有 ${daysLeft} 天`, `${daysLeft} days left`);
}

function ErrorRow({ msg, onRetry, t }: { msg: string; onRetry: () => void; t: (a: string, b: string) => string }) {
  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{msg}</span>
      <button type="button" onClick={onRetry} style={ghostBtn}>{t('重试', 'Retry')}</button>
    </div>
  );
}

const backBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, cursor: 'pointer', minWidth: 44, padding: 'var(--space-1)' };
const cardStyle: React.CSSProperties = { background: 'var(--portal-bg)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderBottom: '1px solid var(--portal-line)' };
const sectLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, margin: '0 0 var(--space-2)' };
const primaryBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent)', color: '#fff', fontWeight: 'var(--weight-semibold)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontWeight: 'var(--weight-medium)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };
const chip: React.CSSProperties = { border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const chipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 'var(--weight-semibold)' as unknown as number };
