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
import { memberForPerson, autoLinkByEmail } from '@/lib/family/people-link';
import { getLedger, listFamilies, listFamilyMembers, type LedgerView } from '@/lib/family/family-client';

const money = (n: number) => `$${n.toFixed(2)}`;

export default function FamilyPersonSummary({ personNodeId, personEmail }: { personNodeId: string; personEmail?: string }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [link, setLink] = useState<{ memberId: string; familyId: string } | null>(() => memberForPerson(personNodeId));
  const [resolved, setResolved] = useState(() => !!memberForPerson(personNodeId));
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [err, setErr] = useState(false);

  // 解析配对:没现成映射且这个人有邮箱 → 拉家庭成员按邮箱自动配一次(不依赖先开过分派选人)。
  useEffect(() => {
    if (link) return;                          // 已有映射,不用再拉
    const email = (personEmail || '').trim();
    if (!email) { setResolved(true); return; } // 没邮箱不可能配上,省一次网络
    let alive = true;
    void (async () => {
      const fr = await listFamilies();
      if (alive && fr.ok) {
        for (const fam of fr.data.families) {
          const mr = await listFamilyMembers(fam.familyId);
          if (mr.ok) autoLinkByEmail(fam.familyId, mr.data.members);
        }
      }
      if (!alive) return;
      setLink(memberForPerson(personNodeId));
      setResolved(true);
    })();
    return () => { alive = false; };
  }, [personNodeId, personEmail, link]);

  const load = useCallback(async () => {
    if (!link) return;
    setErr(false);
    const r = await getLedger(link.familyId, link.memberId);
    if (!r.ok) { setErr(true); return; }
    setLedger(r.data.ledger);
  }, [link]);

  useEffect(() => { void load(); }, [load]);

  if (!resolved) return null;   // 配对解析中,先不占地方
  if (!link) return null;       // 确认没配到家庭成员 → 不显示

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
