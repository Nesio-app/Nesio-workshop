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
import { getLedger, listFamilies, listFamilyMembers, type LedgerView } from '@/lib/family/family-client';

const money = (n: number) => `$${n.toFixed(2)}`;

export default function FamilyPersonSummary({ personNodeId, personEmail }: { personNodeId: string; personEmail?: string }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [link, setLink] = useState<{ memberId: string; familyId: string } | null>(() => memberForPerson(personNodeId));
  const [resolved, setResolved] = useState(() => !!memberForPerson(personNodeId));
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [err, setErr] = useState(false);

  // 解析配对:直接把「这个人的邮箱」和「家庭成员的账号邮箱」比对 —— 不经 person 索引的
  // 首次命中(防重复 Linda 联系人错配到别的节点,导致明明邮箱对得上却不显示)。
  useEffect(() => {
    if (link) return;                          // 已有现成映射,直接用
    const email = (personEmail || '').trim().toLowerCase();
    if (!email) { setResolved(true); return; } // 没邮箱不可能配上,省一次网络
    let alive = true;
    void (async () => {
      const fr = await listFamilies();
      if (alive && fr.ok) {
        for (const fam of fr.data.families) {
          const mr = await listFamilyMembers(fam.familyId);
          if (!alive) return;
          const hit = mr.ok ? mr.data.members.find((m) => (m.email || '').trim().toLowerCase() === email) : undefined;
          if (hit) { setLink({ memberId: hit.id, familyId: fam.familyId }); setResolved(true); return; }
        }
      }
      if (!alive) return;
      setResolved(true);   // 没配到
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
      {!err && ledger && (() => {
        const s = periodStats(ledger.approved);
        const owed = ledger.balance.owed;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* 周 / 月 / 累计 三个小统计 */}
            <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
              <Stat label={t('本周', 'This week')} main={`${s.wC} ${t('件', '')}`.trim()} sub={s.wS > 0 ? `+${money(s.wS)}` : ''} />
              <Stat label={t('本月', 'This month')} main={`${s.mC} ${t('件', '')}`.trim()} sub={s.mS > 0 ? `+${money(s.mS)}` : ''} />
              <Stat label={owed >= 0 ? t('攒了', 'Saved') : t('多给了', 'Overpaid')} main={money(Math.abs(owed))} sub="" />
              <button type="button" onClick={() => { try { window.dispatchEvent(new CustomEvent('nesio-open-family')); } catch { /* noop */ } }}
                style={{ marginLeft: 'auto', alignSelf: 'center', border: 'none', background: 'transparent', color: 'var(--portal-accent)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' as unknown as number }}>
                {t('看账本 ›', 'Ledger ›')}
              </button>
            </div>
            {/* 最近做的活 */}
            {s.recent.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {s.recent.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--portal-ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || t('家务', 'Chore')}</span>
                    <span style={{ color: 'var(--portal-muted)' }}>{r.date}</span>
                    {r.value > 0 && <span style={{ color: 'var(--status-go)', fontVariantNumeric: 'tabular-nums' }}>+{money(r.value)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** 从已完成家务算 本周/本月 件数+金额,并取最近几条。 */
function periodStats(approved: LedgerView['approved']): { wC: number; wS: number; mC: number; mS: number; recent: Array<{ title: string; date: string; value: number }> } {
  const now = new Date();
  const monthPrefix = now.toLocaleDateString('en-CA').slice(0, 7);   // YYYY-MM
  const monday = new Date(now); monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));           // 本周一(周一=0)
  const weekStart = monday.toLocaleDateString('en-CA');
  const rows = approved
    .map((c) => ({ title: (c.title || '').trim(), date: (c.approvedAt || '').slice(0, 10) || c.dueDate, value: Number(c.value) || 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let wC = 0, wS = 0, mC = 0, mS = 0;
  for (const r of rows) {
    if (r.date.slice(0, 7) === monthPrefix) { mC += 1; mS += r.value; }
    if (r.date >= weekStart) { wC += 1; wS += r.value; }
  }
  return { wC, wS, mC, mS, recent: rows.slice(0, 4) };
}

function Stat({ label, main, sub }: { label: string; main: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as unknown as number, color: 'var(--portal-ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {main}{sub ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', fontWeight: 'var(--weight-medium)' as unknown as number, marginLeft: 4 }}>{sub}</span> : null}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{label}</div>
    </div>
  );
}
