'use client';

/**
 * RewardsStore — 奖品仓库(批次 42)。冷冻仓 sheet 的第三个 tab。
 * 忍住没买的东西落这里当愿望;攒够积分兑换,奖励自己。手动也能加愿望。
 */

import { useEffect, useState } from 'react';
import {
  loadRewards, pendingRewards, redeemedRewards, redeemReward, removeReward,
  addManualReward, parsePriceNumber, type RewardItem, type RewardsState,
} from '@/lib/platform/rewards-engine';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import FamilyGoalCard from './family/FamilyGoalCard';

export default function RewardsStore() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [state, setState] = useState<RewardsState>({ points: 0, ledger: [], rewards: [] });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('');
  const [flash, setFlash] = useState('');

  const refresh = () => setState(loadRewards());

  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener('nesio-rewards-updated', on);
    return () => window.removeEventListener('nesio-rewards-updated', on);
  }, []);

  const pending = pendingRewards(state);
  const done = redeemedRewards(state);

  function onRedeem(r: RewardItem) {
    const label = dict === 'en' ? `Redeemed: ${r.title}` : `兑换:${r.title}`;
    const res = redeemReward(r.id, label);
    if (!res.ok && res.reason === 'insufficient') {
      setFlash(L(dict, `还差 ${r.cost - state.points} 积分`, `${r.cost - state.points} pts short`));
      setTimeout(() => setFlash(''), 1800);
      return;
    }
    if (res.ok) {
      setFlash(L(dict, `兑换成功:${r.title}`, `Redeemed: ${r.title}`));
      setTimeout(() => setFlash(''), 2200);
      refresh();
      return;
    }
    // 其它失败(奖励已被删/未找到等):别让"兑换"点了没反应,给通用提示并刷新。
    setFlash(L(dict, '兑换没成功,请刷新后重试', "Redemption failed — refresh and try again"));
    setTimeout(() => setFlash(''), 2200);
    refresh();
  }

  function onAddManual() {
    const n = parseInt(cost, 10);
    if (!title.trim() || !Number.isFinite(n) || n <= 0) return;
    addManualReward({ title: title.trim(), cost: n });
    setTitle(''); setCost(''); setAdding(false);
    refresh();
  }

  return (
    <div className="nesio-rewards">
      {flash && <div className="nesio-rewards-flash">{flash}</div>}

      <p className="nesio-freeze-hint" style={{ marginTop: 0 }}>
        {L(dict, '忍住没买的东西存这儿当愿望。做成事赚积分,攒够就奖励自己。', 'Things you resisted buying wait here as wishes. Earn points by getting things done, then reward yourself.')}
      </p>

      {/* bug3:攒钱目标(愿望)从「家庭分享」板搬到这里 —— 两个愿望不该拆在两个页面。
          没入伙的人看不到这一块。 */}
      <FamilyGoalCard />

      {/* 待兑换 */}
      <div className="nesio-freeze-section">
        <div className="nesio-rewards-section-head">
          <p className="nesio-freeze-section-label" style={{ margin: 0 }}>{L(dict, '愿望清单', 'Wishlist')} {pending.length > 0 && `· ${pending.length}`}</p>
          <button type="button" className="nesio-rewards-add-toggle" onClick={() => setAdding((v) => !v)}>
            {adding ? L(dict, '取消', 'Cancel') : L(dict, '+ 加愿望', '+ Add')}
          </button>
        </div>

        {adding && (
          <div className="nesio-rewards-add-row">
            <input className="nesio-freeze-name-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={L(dict, '奖励是什么', 'What reward?')} />
            <input className="nesio-rewards-cost-input" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ''))} placeholder={L(dict, '积分', 'pts')} inputMode="numeric" />
            <button type="button" className="nesio-freeze-parse-btn" onClick={onAddManual} disabled={!title.trim() || !cost}>{L(dict, '加', 'Add')}</button>
          </div>
        )}

        {pending.length === 0 && !adding && (
          <p className="nesio-freeze-empty" style={{ padding: '0.75rem 0' }}>
            {L(dict, '还没有愿望。到「清单」里对一个冷冻的东西点「不买了」,它就会来这里。', 'No wishes yet. In the List tab, tap "Skipped" on a frozen item and it lands here.')}
          </p>
        )}

        {pending.map((r) => {
          const affordable = state.points >= r.cost;
          const pct = Math.min(100, Math.round((state.points / r.cost) * 100));
          return (
            <div key={r.id} className="nesio-reward-card">
              {r.image && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={r.image} alt="" className="nesio-reward-img" />
              )}
              <div className="nesio-reward-body">
                <p className="nesio-reward-name">{r.title}</p>
                {r.price && <p className="nesio-freeze-item-price">{r.price}</p>}
                <div className="nesio-reward-progress"><div className="nesio-reward-progress-fill" style={{ width: `${pct}%` }} /></div>
                <p className="nesio-reward-progress-label">{state.points} / {r.cost} {L(dict, '积分', 'pts')}</p>
              </div>
              <div className="nesio-reward-actions">
                <button type="button" className={`nesio-reward-redeem${affordable ? '' : ' nesio-reward-redeem--locked'}`} onClick={() => onRedeem(r)}>
                  {affordable ? L(dict, '兑换', 'Redeem') : L(dict, `差 ${r.cost - state.points}`, `${r.cost - state.points} short`)}
                </button>
                <button type="button" className="nesio-reward-remove" onClick={() => { removeReward(r.id); refresh(); }} aria-label={L(dict, '删除', 'Remove')}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 已兑换 */}
      {done.length > 0 && (
        <div className="nesio-freeze-section">
          <p className="nesio-freeze-section-label" style={{ opacity: 0.5 }}>{L(dict, '已兑换', 'Redeemed')}</p>
          {done.slice(0, 6).map((r) => (
            <div key={r.id} className="nesio-freeze-item nesio-freeze-item--resolved">
              <span className="nesio-freeze-item-name">{r.title}</span>
              <span className="nesio-freeze-decision-badge">{L(dict, `−${r.cost} ✓`, `−${r.cost} ✓`)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 积分流水 */}
      {state.ledger.length > 0 && (
        <div className="nesio-freeze-section">
          <p className="nesio-freeze-section-label" style={{ opacity: 0.5 }}>{L(dict, '积分记录', 'Points log')}</p>
          {state.ledger.slice(0, 8).map((e) => (
            <div key={e.id} className="nesio-rewards-ledger-row">
              <span className="nesio-rewards-ledger-label">{e.label}</span>
              <span className={`nesio-rewards-ledger-delta${e.delta >= 0 ? ' pos' : ' neg'}`}>{e.delta >= 0 ? '+' : ''}{e.delta}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
