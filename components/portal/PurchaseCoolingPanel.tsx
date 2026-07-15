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
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { canOpenFreeze } from '@/lib/portal/entitlement';

// 冷冻仓:未上线 → 免费/Pro 都不上(升级引导);上线后 Pro 专属。与全站同一道门。
function openFreezeVault(setOpen: (v: boolean) => void): void {
  if (!canOpenFreeze()) {
    window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'freeze' } }));
    return;
  }
  setOpen(true);
}

const FreezeVaultSheet = dynamic(() => import('./FreezeVaultSheet'), { ssr: false });
const BarcodeScanSheet = dynamic(() => import('./BarcodeScanSheet'), { ssr: false });

const WAGE_KEY = 'nesio-hourly-wage-v1';

function loadWage(): string {
  try { return localStorage.getItem(WAGE_KEY) || ''; } catch { return ''; }
}

export function PurchaseCoolingPanel({ productName, similarCount, similarExample }: {
  productName: string;
  similarCount: number;
  similarExample?: string;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [expanded, setExpanded] = useState(false);
  const [price, setPrice] = useState('');
  const [wage, setWage] = useState('');
  // 批次 16:时薪填一次就记住(WAGE_KEY),已有值时默认收起,点「改」才展开
  const [editingWage, setEditingWage] = useState(false);
  const [decided, setDecided] = useState<'frozen' | 'buying' | ''>('');
  const [vaultOpen, setVaultOpen] = useState(false);
  // 批次 18:扫条码 → UPC 库自动填价格(价格联动第一步)
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [scanImage, setScanImage] = useState('');
  const [scanTitle, setScanTitle] = useState('');

  useEffect(() => {
    const saved = loadWage();
    setWage(saved);
    setEditingWage(!saved); // 没填过才默认展开时薪输入
  }, []);

  function saveWage(v: string) {
    setWage(v);
    try { localStorage.setItem(WAGE_KEY, v); } catch { /* ignore */ }
  }

  const priceNum = parseFloat(price);
  const wageNum = parseFloat(wage);
  const hours = priceNum > 0 && wageNum > 0 ? priceNum / wageNum : 0;

  // 劝说文案:规则生成,信息都来自真实数据(已有几件 + 时薪换算)
  const persuasion: string[] = [];
  if (similarCount > 0) persuasion.push(L(dict, `你已经记录过 ${similarCount} 件类似的${similarExample ? `(比如「${similarExample}」)` : ''}。`, `You already logged ${similarCount} similar item${similarCount > 1 ? 's' : ''}${similarExample ? ` (e.g. "${similarExample}")` : ''}.`));
  if (hours > 0) {
    persuasion.push(hours >= 8
      ? L(dict, `这一件 ≈ 你 ${hours.toFixed(1)} 小时的工资——超过一整个工作日。`, `This ≈ ${hours.toFixed(1)} hours of your pay — more than a full workday.`)
      : L(dict, `这一件 ≈ 你 ${hours.toFixed(1)} 小时的工资。`, `This ≈ ${hours.toFixed(1)} hours of your pay.`));
  }
  persuasion.push(L(dict, '冻 24 小时,明天还想要就买,大多数冲动过一晚就凉了。', 'Freeze it 24 hours. If you still want it tomorrow, buy it — most impulses cool overnight.'));

  function freeze() {
    // 「冻 24 小时」= 冷冻仓写入:未上线 → 免费/Pro 都不上(升级引导);上线后 Pro 专属。
    if (!canOpenFreeze()) {
      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'freeze' } }));
      return;
    }
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
        <p className="nesio-cooling-done">{L(dict, `已冻住「${productName.slice(0, 18)}」24 小时。解冻时 Today 会提醒你做决定。`, `"${productName.slice(0, 18)}" frozen for 24h. Today will remind you when it thaws.`)}</p>
        <button type="button" className="nesio-cooling-link" onClick={() => openFreezeVault(setVaultOpen)}>{L(dict, '查看冷冻清单', 'View freeze list')}</button>
        <FreezeVaultSheet open={vaultOpen} onClose={() => setVaultOpen(false)} />
      </div>
    );
  }
  if (decided === 'buying') {
    return (
      <div className="nesio-cooling-panel">
        <p className="nesio-cooling-done">{L(dict, '好,买得开心。记得把价格记进来,月底能看到花在哪。', 'OK, enjoy it. Log the price so your month-end view shows where the money went.')}</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button type="button" className="nesio-cooling-trigger" onClick={() => setExpanded(true)}>
        <IconSnowflake size={14} /> {L(dict, '想买这个?先算一笔账', 'Want this? Run the numbers first')}
      </button>
    );
  }

  return (
    <div className="nesio-cooling-panel">
      <p className="nesio-cooling-title"><IconSnowflake size={14} /> {L(dict, '买之前,三十秒冷静', '30 seconds of calm before buying')}</p>

      <div className="nesio-cooling-row">
        <span className="nesio-cooling-label">{L(dict, '价格', 'Price')}</span>
        <input
          className="nesio-cooling-input"
          type="number"
          inputMode="decimal"
          placeholder="¥"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        {editingWage ? (
          <>
            <span className="nesio-cooling-label">{L(dict, '时薪', 'Hourly pay')}</span>
            <input
              className="nesio-cooling-input"
              type="number"
              inputMode="decimal"
              placeholder={L(dict, '¥/小时', '$/hr')}
              value={wage}
              onChange={(e) => saveWage(e.target.value)}
              onBlur={() => { if (wage) setEditingWage(false); }}
              autoFocus={Boolean(loadWage())}
            />
          </>
        ) : (
          <button
            type="button"
            className="nesio-cooling-link"
            style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
            onClick={() => setEditingWage(true)}
          >
            {L(dict, `时薪 ¥${wage} · 改`, `Pay $${wage}/hr · edit`)}
          </button>
        )}
      </div>

      <button type="button" className="nesio-cooling-link" onClick={() => { setScanNote(''); setScanImage(''); setScanTitle(''); setScanOpen(true); }}>
        {L(dict, '扫码识别商品(二维码/条码)', 'Scan a code (QR / barcode)')}
      </button>
      {(scanImage || scanTitle) && (
        <div className="nesio-cooling-scan-result">
          {scanImage && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={scanImage} alt="" className="nesio-cooling-scan-img" />
          )}
          {scanTitle && <span className="nesio-cooling-scan-title">{scanTitle}</span>}
        </div>
      )}
      {scanNote && <p style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', margin: '0.2rem 0 0' }}>{scanNote}</p>}

      <div className="nesio-cooling-copy">
        {persuasion.map((line, i) => <p key={i}>{line}</p>)}
      </div>

      <div className="nesio-cooling-actions">
        <button type="button" className="nesio-cooling-freeze-btn" onClick={freeze}>{L(dict, '冻 24 小时', 'Freeze 24h')}</button>
        <button type="button" className="nesio-cooling-buy-btn" onClick={buyAnyway}>{L(dict, '还是要买', 'Buying anyway')}</button>
      </div>
      <button type="button" className="nesio-cooling-link" onClick={() => openFreezeVault(setVaultOpen)}>{L(dict, '冷冻清单', 'Freeze list')}</button>
      <FreezeVaultSheet open={vaultOpen} onClose={() => setVaultOpen(false)} />
      <BarcodeScanSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(r) => {
          if (r.price) setPrice(String(r.price));
          setScanImage(r.image || '');
          setScanTitle(r.title || '');
          setScanNote(r.title
            ? L(dict, `识别到:${r.title}${r.price ? `(参考价 ¥${r.price})` : ''}`, `Found: ${r.title}${r.price ? ` (ref ¥${r.price})` : ''}`)
            : L(dict, `${r.upc ? `条码 ${r.upc}:` : ''}没查到商品。可换「拍一下」拍商品让 AI 认,或手动填。`, `${r.upc ? `Barcode ${r.upc}: ` : ''}not found. Try snapping a photo (AI recognizes it) or enter it manually.`));
        }}
      />
    </div>
  );
}
