'use client';

/**
 * AssignChoreButton —— 闭环起点。在记忆详情里把一条(日历事件等)记忆「分派给家人」。
 * 选家庭 + 成员 → assignChoreFromEvent(服务端按 can_approve 强制,一事件一实例=可改派)。
 * 分派成功后:被分派人会在 TA 的今天页看到这件家务;做完后你会在今天页收到回响。
 * 每个异步动作都有显式失败态(设计红线)。
 */
import { useCallback, useState } from 'react';
import type { LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listFamilies, listFamilyMembers, assignChoreFromEvent,
  type FamilySummary, type FamilyMemberView,
} from '@/lib/family/family-client';
import type { Cadence } from '@/lib/family/chores-core';
import { autoLinkByEmail } from '@/lib/family/people-link';
import { displayNodeName } from '@/lib/portal/node-display';

/** 事件/承诺记忆的到期日 → YYYY-MM-DD(纯日期不做时区换算);缺失回退本地今天。 */
function dayKeyFromNode(node: LifeNode): string {
  const raw = ['start', 'date', 'datetime', 'dueDate', 'due', 'end'].map((k) => node.attributes[k]).find((v) => v);
  const s = raw ? String(raw) : '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (s) { const d = new Date(s); if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-CA'); }
  return new Date().toLocaleDateString('en-CA');
}

type Phase =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'pick'; families: FamilySummary[]; familyId: string; members: FamilyMemberView[]; linked: Record<string, string> }
  | { s: 'saving'; name: string }
  | { s: 'done'; name: string }
  | { s: 'nofamily' }
  | { s: 'error'; msg: string };

export default function AssignChoreButton({ node }: { node: LifeNode }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [reward, setReward] = useState('');            // 这件家务值多少钱(接回零花钱账本;留空=0,只当待办)
  const [needsApproval, setNeedsApproval] = useState(true); // 要不要家长看一眼再计入
  const [repeat, setRepeat] = useState<'once' | 'daily' | 'weekly'>('once'); // 周期:一次/每天/每周(接 chores-core cadence)

  const loadMembers = useCallback(async (families: FamilySummary[], familyId: string) => {
    const m = await listFamilyMembers(familyId);
    if (!m.ok) { setPhase({ s: 'error', msg: m.error }); return; }
    // 按邮箱把成员配到本机 People 的 person 节点 → 选人时显示你在 People 里认得的名字。
    const linked: Record<string, string> = {};
    try {
      autoLinkByEmail(familyId, m.data.members).forEach((node, memberId) => { linked[memberId] = displayNodeName(node.name, dict); });
    } catch { /* 配不上就用家庭显示名 */ }
    setPhase({ s: 'pick', families, familyId, members: m.data.members, linked });
  }, [dict]);

  const begin = useCallback(async () => {
    setPhase({ s: 'loading' });
    const r = await listFamilies();
    if (!r.ok) { setPhase({ s: 'error', msg: r.error }); return; }
    if (!r.data.families.length) { setPhase({ s: 'nofamily' }); return; }
    await loadMembers(r.data.families, r.data.families[0].familyId);
  }, [loadMembers]);

  const assign = useCallback(async (familyId: string, member: FamilyMemberView) => {
    setPhase({ s: 'saving', name: member.name });
    const v = Number(reward);
    const due = dayKeyFromNode(node);
    const cadence: Cadence = repeat === 'daily'
      ? { kind: 'daily' }
      : repeat === 'weekly'
        ? { kind: 'weekly', weekdays: [new Date(`${due}T00:00:00Z`).getUTCDay()] }  // 每周 = 事件当天那个星期几
        : { kind: 'once' };
    const r = await assignChoreFromEvent({
      familyId,
      sourceEventId: node.id,
      title: node.name || t('家务', 'Chore'),
      dueDate: due,
      assigneeId: member.id,
      value: Number.isFinite(v) && v > 0 ? v : 0,   // 接回账本:>0 才计入攒钱,留空=纯待办
      needsApproval,
      cadence,
    });
    if (!r.ok) {
      setPhase({ s: 'error', msg: t('没分派成,再试一次。', 'Could not assign — try again.') });
      return;
    }
    setPhase({ s: 'done', name: member.name });
    // 通知已挂载的今天页家庭条刷新(被分派人/自己的今天页即时反映)。
    try { window.dispatchEvent(new CustomEvent('nesio-family-updated')); } catch { /* noop */ }
  }, [node, t, reward, needsApproval, repeat]);

  // ── 视图 ──
  if (phase.s === 'idle') {
    return (
      <div className="nesio-nd-photo-add">
        <button type="button" className="nesio-node-action-secondary nesio-nd-photo-btn" onClick={() => void begin()}>
          {t('＋ 分派给家人', '＋ Assign to family')}
        </button>
      </div>
    );
  }

  if (phase.s === 'loading' || phase.s === 'saving') {
    return (
      <div className="nesio-nd-photo-add">
        <button type="button" className="nesio-node-action-secondary nesio-nd-photo-btn" disabled>
          {phase.s === 'saving' ? t('分派中…', 'Assigning…') : t('加载中…', 'Loading…')}
        </button>
      </div>
    );
  }

  if (phase.s === 'done') {
    return (
      <div className="nesio-nd-photo-add">
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--status-go)', lineHeight: 1.6 }}>
          {t(`已交给 ${phase.name} 了。TA 会在自己的今天页看到;做完后你也会在今天页收到提醒。`,
            `Handed to ${phase.name}. They'll see it on their Today; you'll hear back on yours when it's done.`)}
        </p>
        <button type="button" className="nesio-node-action-secondary nesio-nd-photo-btn" onClick={() => void begin()} style={{ marginTop: '0.5rem' }}>
          {t('改派给别人', 'Reassign')}
        </button>
      </div>
    );
  }

  if (phase.s === 'nofamily') {
    return (
      <div className="nesio-nd-photo-add">
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
          {t('还没有家庭。先在洞察里建一个家庭,就能把家务分派给家人。', 'No family yet. Create one in Insights, then you can assign chores.')}
        </p>
        <button type="button" className="nesio-node-action-secondary nesio-nd-photo-btn" style={{ marginTop: '0.5rem' }}
          onClick={() => { try { window.dispatchEvent(new CustomEvent('nesio-open-family')); } catch { /* noop */ } }}>
          {t('去建家庭', 'Open family')}
        </button>
      </div>
    );
  }

  if (phase.s === 'error') {
    return (
      <div className="nesio-nd-photo-add">
        <p className="nesio-nd-photo-err" role="alert">
          {phase.msg}
          <button type="button" className="nesio-nd-photo-retry" onClick={() => void begin()}>{t('重试', 'Retry')}</button>
        </p>
      </div>
    );
  }

  // phase.s === 'pick'
  const fam = phase.families.find((f) => f.familyId === phase.familyId);
  return (
    <div className="nesio-nd-photo-add" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--portal-muted)' }}>{t('分派给谁?', 'Assign to whom?')}</p>
      {phase.families.length > 1 && (
        <select
          value={phase.familyId}
          onChange={(e) => { setPhase({ s: 'loading' }); void loadMembers(phase.families, e.target.value); }}
          style={{ padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: '0.85rem' }}
        >
          {phase.families.map((f) => <option key={f.familyId} value={f.familyId}>{f.name}</option>)}
        </select>
      )}
      {/* 周期:接 chores-core cadence —— 每天/每周会向前铺 14 天,不用天天重派。 */}
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        {([['once', t('一次', 'Once')], ['daily', t('每天', 'Daily')], ['weekly', t('每周', 'Weekly')]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setRepeat(k)}
            style={{
              flex: 1, padding: '0.3rem 0.4rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', cursor: 'pointer',
              border: '1px solid var(--portal-line)', fontFamily: 'var(--font-sans)',
              background: repeat === k ? 'var(--portal-accent-soft-md)' : 'transparent',
              color: repeat === k ? 'var(--portal-accent)' : 'var(--portal-muted)',
              fontWeight: (repeat === k ? 'var(--weight-semibold)' : 'var(--weight-regular)') as unknown as number,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* 金额:接回零花钱账本。留空 = 纯待办(不计钱)。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--portal-muted)' }}>$</span>
        <input
          inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)}
          placeholder={t('给多少(可留空)', 'Reward (optional)')}
          style={{ flex: 1, minWidth: 0, padding: '0.35rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: '0.85rem' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--portal-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} />
          {t('做完我看一眼', 'I review it')}
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {phase.members.map((m) => (
          <button key={m.id} type="button" className="nesio-node-action-secondary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
            onClick={() => fam && void assign(fam.familyId, m)}>
            {phase.linked[m.id] || m.name}
          </button>
        ))}
        {phase.members.length === 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--portal-muted)' }}>{t('这个家庭还没有其他成员。', 'No other members yet.')}</span>
        )}
      </div>
      <button type="button" onClick={() => setPhase({ s: 'idle' })}
        style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--portal-muted)', fontSize: '0.78rem', cursor: 'pointer', padding: '0.2rem 0' }}>
        {t('收起', 'Close')}
      </button>
    </div>
  );
}
