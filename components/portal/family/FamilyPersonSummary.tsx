'use client';

/**
 * FamilyPersonSummary —— People 一端的回落(item 6)。若这个 person 节点已按邮箱配到某家庭成员,
 * 就在 TA 的记忆详情里显示「攒了多少 + 完成了几件家务」,并可跳到 TA 的账本。没配到 → 不渲染。
 * 每个异步动作都有显式失败态(红线)。数据经服务端授权拉取(getLedger)。
 */
import { useCallback, useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { memberForPerson } from '@/lib/family/people-link';
import { getLedger, type LedgerView } from '@/lib/family/family-client';

const money = (n: number) => `$${n.toFixed(2)}`;

export default function FamilyPersonSummary({ personNodeId }: { personNodeId: string }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [link] = useState(() => memberForPerson(personNodeId));
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    if (!link) return;
    setErr(false);
    const r = await getLedger(link.familyId, link.memberId);
    if (!r.ok) { setErr(true); return; }
    setLedger(r.data.ledger);
  }, [link]);

  useEffect(() => { void load(); }, [load]);

  if (!link) return null;  // 没配到家庭成员 → 不占地方

  return (
    <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', background: 'var(--portal-accent-soft)' }}>
      <div style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, marginBottom: 'var(--space-2)' }}>
        {t('家庭家务', 'Family chores')}
      </div>
      {err && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
          {t('没连上,稍后再看。', 'Could not load — check later.')}
          <button type="button" onClick={() => void load()} style={{ border: 'none', background: 'transparent', color: 'var(--portal-accent)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>{t('重试', 'Retry')}</button>
        </div>
      )}
      {!err && !ledger && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{t('加载中…', 'Loading…')}</span>}
      {!err && ledger && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as unknown as number, color: 'var(--portal-ink)', fontVariantNumeric: 'tabular-nums' }}>{money(ledger.balance.owed)}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('攒了', 'saved up')}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as unknown as number, color: 'var(--portal-ink)', fontVariantNumeric: 'tabular-nums' }}>{ledger.approved.length}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('件已完成', 'chores done')}</div>
          </div>
          <button type="button" onClick={() => { try { window.dispatchEvent(new CustomEvent('nesio-open-family')); } catch { /* noop */ } }}
            style={{ marginLeft: 'auto', alignSelf: 'center', border: 'none', background: 'transparent', color: 'var(--portal-accent)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' as unknown as number }}>
            {t('看账本 ›', 'Ledger ›')}
          </button>
        </div>
      )}
    </div>
  );
}
