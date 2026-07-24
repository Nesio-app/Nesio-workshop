/**
 * Tesla 充电花费进财务 —— 兑现连接器承诺「充电花费自动进财务」。
 *
 * 「不知道数据在哪」的根因:带花费的充电以 vehicle.charge signal 持久化
 * (normalizers.ts,打了 财务/finance 标签 + financial 敏感度),但财务页只读
 * Plaid 银行流水(loadBankTx),从不读 Tesla signal —— 花费卡在信号层、永远
 * 不出现在财务页。
 *
 * 这里把带真实花费的充电 signal 映射成 BankTx,由 FinanceTab 在**显示层**并进
 * 流水。刻意不写 bank-tx 存储:① Plaid 权威同步 replace 会冲掉合成账户,
 * ② filterToKnownAccounts 会把非 Plaid 账户的交易当孤儿隐藏。显示层合并
 * 两个坑都绕开,且数据始终以 signal 为单一真源(可回溯、可删)。
 */
import { getSignals } from '@/lib/life-domain/signal';
import type { BankTx, BankAccount } from '@/lib/portal/bank-tx';

/** 合成「Tesla 充电」账户 id —— 供按账户筛选 + 账户表识别;不进 Plaid 存储。 */
export const TESLA_FIN_ACCOUNT_ID = 'tesla-charging';

export function teslaFinAccount(): BankAccount {
  return { id: TESLA_FIN_ACCOUNT_ID, name: 'Tesla 充电', currency: 'USD', type: 'other' };
}

/**
 * 带真实花费的充电 signal → BankTx(正数=支出,交通·加油类)。
 * 无花费(Supercharger 常不回费用 / 家充无费用)的不进财务 —— 只把「真花了钱」的算进消费。
 * id 用 externalId 同式(tesla-charge-<vid>-<occurredAt>),与信号天然去重。
 */
export function loadTeslaChargeTx(): BankTx[] {
  let sigs: ReturnType<typeof getSignals>;
  try {
    sigs = getSignals({ sources: ['tesla'], types: ['vehicle.charge'] });
  } catch {
    return [];
  }
  const out: BankTx[] = [];
  const seen = new Set<string>();
  for (const s of sigs) {
    const p = (s.payload || {}) as { costUsd?: unknown; energyAddedKwh?: unknown; location?: unknown; vehicleId?: unknown };
    const cost = typeof p.costUsd === 'number' ? p.costUsd : Number(p.costUsd);
    if (!Number.isFinite(cost) || cost <= 0) continue; // 只有真花费进财务
    const at = s.occurredAt || s.capturedAt || '';
    const date = typeof at === 'string' ? at.slice(0, 10) : '';
    if (!date) continue;
    const vid = typeof p.vehicleId === 'string' ? p.vehicleId : '';
    const id = `tesla-charge-${vid}-${at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const loc = typeof p.location === 'string' && p.location.trim() ? p.location.trim() : '';
    const kwh = typeof p.energyAddedKwh === 'number' ? p.energyAddedKwh : null;
    out.push({
      id,
      accountId: TESLA_FIN_ACCOUNT_ID,
      date,
      name: loc ? `Tesla 充电 · ${loc}` : 'Tesla 充电',
      amount: cost, // 正数 = 支出(与 Plaid 口径一致)
      currency: 'USD',
      category: 'TRANSPORTATION',
      categoryDetail: 'TRANSPORTATION_GAS',
      ...(kwh ? { origDesc: `+${kwh} kWh` } : {}),
    });
  }
  return out;
}
