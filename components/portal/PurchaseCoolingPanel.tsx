'use client';

/**
 * PurchaseCoolingPanel — 拍一下识别结果里的「购买冷静」面板(批次 7)。
 * 拍到想买的东西 → 三问:买过类似的吗 / 折算几小时工资 / 要不要先冻 24h。
 * 劝住(冻住/不买)与没劝住(还是要买)都计数:遥测 + 冷冻仓账本,
 * 洞察页汇总成「冲动冷静」事实。参考:购物冷静类 App 的时薪换算劝说。
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { addToFreeze } from '@/lib/platform/impulse-guard';
import { track } from '@/lib/portal/telemetry';
import { IconSnowflake } from './icons';

const FreezeVaultSheet = dynamic(() => import('./FreezeVaultSheet'), { ssr: false });

const WAGE_KEY = 'nesio-hourly-wage-v1';

function loadWage(): string {
  try { return localStorage.getItem(WAGE_KEY) || ''; } catch { return ''; }
}

export function PurchaseCoolingPanel({ productName, similarCount, similarExample }: {
  productName: string;
  similarCount: number;
  similarExample?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [price, setPrice] = useState('');
  const [wage, setWage] = useState('');
  const [decided, setDecided] = useState<'frozen' | 'buying' | ''>('');
  const [vaultOpen, setVaultOpen] = useState(false);

  useEffect(() => { setWage(loadWage()); }, []);

  function saveWage(v: string) {
    setWage(v);
    try { localStorage.setItem(WAGE_KEY, v); } catch { /* ignore */ }
  }

  const priceNum = parseFloat(price);
  const wageNum = parseFloat(wage);
  const hours = priceNum > 0 && wageNum > 0 ? priceNum / wageNum : 0;

  // 劝说文案:规则生成,信息都来自真实数据(已有几件 + 时薪换算)
  const persuasion: string[] = [];
  if (similarCount > 0) persuasion.push(`你已经记录过 ${similarCount} 件类似的${similarExample ? `(比如「${similarExample}」)` : ''}。`);
  if (hours > 0) {
    persuasion.push(hours >= 8
      ? `这一件 ≈ 你 ${hours.toFixed(1)} 小时的工资——超过一整个工作日。`
      : `这一件 ≈ 你 ${hours.toFixed(1)} 小时的工资。`);
  }
  persuasion.push('冻 24 小时,明天还想要就买,大多数冲动过一晚就凉了。');

  function freeze() {
    addToFreeze({ url: '', title: productName, price: price ? `¥${price}` : undefined, freezeHours: 24 });
    track('impulse_persuaded', { via: 'camera', frozen: true });
    setDecided('frozen');
  }
  function buyAnyway() {
    track('impulse_not_persuaded', { via: 'camera' });
    setDecided('buying');
  }

  if (decided === 'frozen') {
    return (
      <div className="nesio-cooling-panel">
        <p className="nesio-cooling-done">已冻住「{productName.slice(0, 18)}」24 小时。解冻时 Today 会提醒你做决定。</p>
        <button type="button" className="nesio-cooling-link" onClick={() => setVaultOpen(true)}>查看冷冻清单</button>
        <FreezeVaultSheet open={vaultOpen} onClose={() => setVaultOpen(false)} />
      </div>
    );
  }
  if (decided === 'buying') {
    return (
      <div className="nesio-cooling-panel">
        <p className="nesio-cooling-done">好,买得开心。记得把价格记进来,月底能看到花在哪。</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button type="button" className="nesio-cooling-trigger" onClick={() => setExpanded(true)}>
        <IconSnowflake size={14} /> 想买这个?先算一笔账
      </button>
    );
  }

  return (
    <div className="nesio-cooling-panel">
      <p className="nesio-cooling-title"><IconSnowflake size={14} /> 买之前,三十秒冷静</p>

      <div className="nesio-cooling-row">
        <span className="nesio-cooling-label">价格</span>
        <input
          className="nesio-cooling-input"
          type="number"
          inputMode="decimal"
          placeholder="¥"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <span className="nesio-cooling-label">时薪</span>
        <input
          className="nesio-cooling-input"
          type="number"
          inputMode="decimal"
          placeholder="¥/小时"
          value={wage}
          onChange={(e) => saveWage(e.target.value)}
        />
      </div>

      <div className="nesio-cooling-copy">
        {persuasion.map((line, i) => <p key={i}>{line}</p>)}
      </div>

      <div className="nesio-cooling-actions">
        <button type="button" className="nesio-cooling-freeze-btn" onClick={freeze}>冻 24 小时</button>
        <button type="button" className="nesio-cooling-buy-btn" onClick={buyAnyway}>还是要买</button>
      </div>
      <button type="button" className="nesio-cooling-link" onClick={() => setVaultOpen(true)}>冷冻清单</button>
      <FreezeVaultSheet open={vaultOpen} onClose={() => setVaultOpen(false)} />
    </div>
  );
}
