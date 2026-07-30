'use client';

/**
 * FamilyGoalCard — 攒钱目标 / 愿望(bug3:「愿望集成到 rewards 板块」)。
 *
 * 原来这块长在「家庭分享」板的顶部:一个人打开奖励商店看愿望清单,却要跑到家务板
 * 才能看见自己攒钱买乐高攒到哪了 —— 两个愿望被拆在两个页面。现在整块搬进 RewardsStore,
 * 和「忍住没买的东西」并列。
 *
 * 自持数据:listFamilies → getBoard。没入伙 / 没连上就整块不渲染(奖励页不该被家庭报错打断)。
 * 写入仍走 setMyGoal(服务端授权 + RLS),失败必须看得见。
 */

import { useCallback, useEffect, useState } from 'react';
import { listFamilies, getBoard, setMyGoal, type FamilyMemberView } from '@/lib/family/family-client';
import { IconTarget, IconStar } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

/** 与家庭板同一套金额格式(¥/$ 跟界面语言)。 */
function money(n: number, dict: string): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n).toFixed(2);
  return dict === 'en' ? `${sign}$${v}` : `${sign}¥${v}`;
}

export default function FamilyGoalCard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [familyId, setFamilyId] = useState('');
  const [me, setMe] = useState<FamilyMemberView | null>(null);
  const [earned, setEarned] = useState(0);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const fam = await listFamilies();
    if (!fam.ok || fam.data.families.length === 0) { setReady(true); return; }
    const id = fam.data.families[0].familyId;
    const b = await getBoard(id);
    if (!b.ok) { setReady(true); return; }
    setFamilyId(id);
    setMe(b.data.board.me);
    // 进度分母用「累计挣到的」(earned),不是 owed —— owed 发一次工钱就掉一截,
    // 拿它当攒钱进度会倒退甚至显示负数(家庭板踩过)。
    setEarned(b.data.board.everyone.find((e) => e.member.id === b.data.board.me.id)?.earned ?? 0);
    setAmount(b.data.board.me.goalAmount ? String(b.data.board.me.goalAmount) : '');
    setLabel(b.data.board.me.goalLabel ?? '');
    setReady(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 没入伙 / 没连上 → 整块不出现(奖励页照常用,不被家庭的状态拖累)
  if (!ready || !me || !familyId) return null;

  const goal = me.goalAmount ?? 0;

  const save = async () => {
    const amt = Number(amount);
    setBusy(true); setErr('');
    const r = await setMyGoal(familyId, amt > 0 ? amt : 0, label.trim());
    setBusy(false);
    if (!r.ok) { setErr(t('没存上,再试一次。', 'Could not save — try again.')); return; }
    setOpen(false);
    await load();
  };

  if (open) {
    return (
      <div className="nesio-freeze-section">
        <p className="nesio-freeze-section-label">{t('攒够钱想买什么?', 'Saving up for what?')}</p>
        <input className="nesio-freeze-name-input" placeholder={t('想要的东西(如「乐高」)', 'What you want (e.g. Lego)')}
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="nesio-freeze-name-input" inputMode="decimal" placeholder={t('目标金额', 'Goal amount')}
          value={amount} onChange={(e) => setAmount(e.target.value)} style={{ marginTop: 'var(--space-2)' }} />
        {err && <p role="alert" style={{ margin: 'var(--space-2) 0 0', color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <button type="button" className="nesio-freeze-parse-btn" onClick={save} disabled={busy}>
            {busy ? t('保存中…', 'Saving…') : t('定下目标', 'Set goal')}
          </button>
          {goal > 0 && (
            <button type="button" className="nesio-rewards-add-toggle"
              onClick={() => { setAmount(''); void setMyGoal(familyId, 0, '').then(() => load()); setOpen(false); }}>
              {t('取消目标', 'Clear')}
            </button>
          )}
          <button type="button" className="nesio-rewards-add-toggle" onClick={() => { setOpen(false); setErr(''); }}>{t('返回', 'Back')}</button>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="nesio-freeze-section">
        <button type="button" className="nesio-rewards-add-toggle" onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <IconTarget size={14} /> {t('设一个攒钱目标', 'Set a savings goal')}
        </button>
      </div>
    );
  }

  const reached = earned >= goal;
  const pct = goal > 0 ? Math.max(0, Math.min(100, Math.round((earned / goal) * 100))) : 0;
  return (
    <div className="nesio-freeze-section">
      <div className="nesio-rewards-section-head">
        <p className="nesio-freeze-section-label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: reached ? 'var(--status-go)' : 'var(--portal-ink)' }}>
          {reached ? <IconStar size={14} /> : <IconTarget size={14} />}{me.goalLabel || t('攒钱目标', 'Savings goal')}
        </p>
        <button type="button" className="nesio-rewards-add-toggle" onClick={() => setOpen(true)}>{t('改', 'Edit')}</button>
      </div>
      <div className="nesio-reward-progress">
        <div className="nesio-reward-progress-fill" style={{ width: `${pct}%`, background: reached ? 'var(--status-go)' : 'var(--portal-blue-deep)' }} />
      </div>
      <p className="nesio-reward-progress-label" style={{ color: reached ? 'var(--status-go)' : 'var(--portal-muted)' }}>
        {reached
          ? t(`攒够了!可以买 ${me.goalLabel || '它'} 了`, `Goal reached — you can get ${me.goalLabel || 'it'}!`)
          : t(`${money(Math.max(0, earned), dict)} / ${money(goal, dict)} · 还差 ${money(Math.max(0, goal - earned), dict)}`,
            `${money(Math.max(0, earned), dict)} / ${money(goal, dict)} · ${money(Math.max(0, goal - earned), dict)} to go`)}
      </p>
    </div>
  );
}
