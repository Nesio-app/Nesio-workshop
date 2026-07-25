'use client';

/**
 * FamilySharingSheet — 家务 + 零花钱账本(workshop 域实验 M3)。
 * 一屏三态:① 没家庭 → 建家/入伙;② 家庭板(区块按权限:待审仅 can_approve);
 * ③ 某成员账本(欠多少 + 历史 + 发薪冲账)。**一个 app 所有人一样**,区块由权限显隐,
 * 但真正的门在服务端(核心 fail-closed)。Nesio 永不碰钱。每个异步动作都有显式失败态(红线)。
 */
import { useCallback, useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { IconTarget, IconStar, IconCamera } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale, loadProfileSettings } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listFamilies, createFamily, joinFamily, getBoard, getLedger, choreAction, recordPayout, syncMyFamilyProfile, setMyGoal,
  setMemberRole, removeMember,
  type FamilySummary, type FamilyMemberView, type BoardView, type LedgerView, type ChoreInstanceView,
} from '@/lib/family/family-client';

type View = { kind: 'board' } | { kind: 'ledger'; person: FamilyMemberView };

const money = (n: number) => `$${n.toFixed(2)}`;

export default function FamilySharingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [view, setView] = useState<View>({ kind: 'board' });

  const refreshFamilies = useCallback(async () => {
    setLoading(true); setLoadErr('');
    // 打开时把「我」的账号名字/头像同步到成员行(身份自成一套,不匹配 People)。best-effort。
    try { const p = loadProfileSettings(); await syncMyFamilyProfile(p.displayName, p.avatarUrl || ''); } catch { /* 首次未入伙时无行可更,忽略 */ }
    const r = await listFamilies();
    if (!r.ok) { setLoadErr(r.error); setLoading(false); return; }
    setFamilies(r.data.families);
    if (r.data.families.length && !familyId) setFamilyId(r.data.families[0].familyId);
    setLoading(false);
  }, [familyId]);

  useEffect(() => { if (open) void refreshFamilies(); }, [open, refreshFamilies]);

  if (!open) return null;

  const me = families.find((f) => f.familyId === familyId)?.me ?? null;

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('家庭分享', 'Family sharing')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <Header
          title={view.kind === 'ledger' ? `${view.person.name}${t(' 的账本', "’s ledger")}` : t('家庭分享', 'Family')}
          onBack={view.kind === 'ledger' ? () => setView({ kind: 'board' }) : undefined}
          onClose={onClose}
          t={t}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {loading && <Muted>{t('加载中…', 'Loading…')}</Muted>}
          {!loading && loadErr && <ErrorRow msg={t('没连上,稍后再试一次。', 'Could not load — try again shortly.')} onRetry={refreshFamilies} t={t} />}

          {!loading && !loadErr && families.length === 0 && (
            <SetupView t={t} onDone={refreshFamilies} />
          )}

          {!loading && !loadErr && families.length > 0 && view.kind === 'board' && familyId && (
            <BoardScreen
              familyId={familyId}
              families={families}
              onSwitchFamily={setFamilyId}
              onOpenLedger={(member) => setView({ kind: 'ledger', person: member })}
              t={t}
            />
          )}

          {!loading && !loadErr && view.kind === 'ledger' && me && (
            <LedgerScreen
              familyId={familyId}
              person={view.person}
              me={me}
              onChanged={refreshFamilies}
              onLeft={() => { setView({ kind: 'board' }); setFamilyId(''); void refreshFamilies(); }}
              t={t}
            />
          )}
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 小组件 ────────────────────────────────────────────────────────────────────
function Header({ title, onBack, onClose, t }: { title: string; onBack?: () => void; onClose: () => void; t: (a: string, b: string) => string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--portal-line)' }}>
      {onBack
        ? <button type="button" onClick={onBack} style={backBtn}>‹ {t('返回', 'Back')}</button>
        : <span style={{ width: 44 }} />}
      <h2 style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>{title}</h2>
      <button type="button" onClick={onClose} aria-label={t('关闭', 'Close')} style={{ ...backBtn, textAlign: 'right' }}>✕</button>
    </div>
  );
}
const backBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, cursor: 'pointer', minWidth: 44, padding: 'var(--space-1)' };
const cardStyle: React.CSSProperties = { background: 'var(--portal-bg)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderBottom: '1px solid var(--portal-line)' };
const sectLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, margin: '0 0 var(--space-2)' };

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-6)' }}>{children}</p>;
}
function ErrorRow({ msg, onRetry, t }: { msg: string; onRetry: () => void; t: (a: string, b: string) => string }) {
  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{msg}</span>
      <button type="button" onClick={onRetry} style={ghostBtn}>{t('重试', 'Retry')}</button>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent)', color: '#fff', fontWeight: 'var(--weight-semibold)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const ghostBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontWeight: 'var(--weight-medium)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const goBtn: React.CSSProperties = { ...primaryBtn, background: 'var(--status-go)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };

// ── 建家 / 入伙 ────────────────────────────────────────────────────────────────
function SetupView({ t, onDone }: { t: (a: string, b: string) => string; onDone: () => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  // 称呼默认取账号资料里的名字(身份自成一套);头像也一起带上,家人看到的是你本人。
  const [displayName, setDisplayName] = useState(() => { try { return loadProfileSettings().displayName || ''; } catch { return ''; } });
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState('');

  async function submit() {
    setStatus('busy'); setErr('');
    const avatar = (() => { try { return loadProfileSettings().avatarUrl || ''; } catch { return ''; } })();
    const r = tab === 'create'
      ? await createFamily(name.trim(), displayName.trim(), avatar)
      : await joinFamily(code.trim(), displayName.trim(), avatar);
    if (!r.ok) { setErr(r.error); setStatus('error'); return; }
    const code2 = (r.data as { inviteCode?: string }).inviteCode;
    if (tab === 'create' && code2) { setInvite(code2); setStatus('idle'); }
    onDone();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', margin: 0, lineHeight: 1.6 }}>
        {t('一本私密的家庭零花钱账本。记清楚你欠孩子多少,你给现金 —— 一切不离开你们的账号。Nesio 不动钱、不订阅。',
          'A private family allowance ledger. It keeps the count straight; you hand over the cash. Nesio never moves money.')}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" onClick={() => setTab('create')} style={tab === 'create' ? primaryBtn : ghostBtn}>{t('创建家庭', 'Create a family')}</button>
        <button type="button" onClick={() => setTab('join')} style={tab === 'join' ? primaryBtn : ghostBtn}>{t('凭邀请码加入', 'Join with a code')}</button>
      </div>

      {invite && (
        <div style={{ ...cardStyle, padding: 'var(--space-4)', background: 'var(--status-go-soft)', borderColor: 'transparent' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-ink)' }}>{t('家庭建好了!把邀请码发给家人,他们各自登录后输入即可入伙:', 'Family created! Share this code — each member enters it after signing in:')}</p>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)' as unknown as number, letterSpacing: '0.12em', color: 'var(--status-go)' }}>{invite}</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {tab === 'create'
          ? <input style={inputStyle} placeholder={t('家庭名字(如「我们家」)', 'Family name')} value={name} onChange={(e) => setName(e.target.value)} />
          : <input style={inputStyle} placeholder={t('邀请码', 'Invite code')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
        <input style={inputStyle} placeholder={t('你在家里的称呼(如「妈妈」「Maya」)', 'Your name in the family')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {status === 'error' && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{t('没成,稍后再试一次。', 'Didn’t go through — try again.')}{err ? ` (${err})` : ''}</span>}
        <button type="button" onClick={submit} disabled={status === 'busy'} style={{ ...primaryBtn, alignSelf: 'flex-start', opacity: status === 'busy' ? 0.6 : 1 }}>
          {status === 'busy' ? t('处理中…', 'Working…') : tab === 'create' ? t('创建', 'Create') : t('加入', 'Join')}
        </button>
      </div>
    </div>
  );
}

// ── 邀请码(常驻家庭板,随时可取 —— 修「创建后邀请码找不到了」)────────────────────
function InviteSection({ inviteCode, t }: { inviteCode: string; t: (a: string, b: string) => string }) {
  const [copied, setCopied] = useState(false);
  if (!inviteCode) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* 复制不了也没关系,码是明文摆着的,可手抄 */ }
  }
  return (
    <div style={{ ...cardStyle, padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('邀请家人 · 让 TA 各自登录后输入这个码', 'Invite family — they enter this after signing in')}</div>
        <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as unknown as number, letterSpacing: '0.14em', color: 'var(--portal-accent)' }}>{inviteCode}</div>
      </div>
      <button type="button" onClick={copy} style={ghostBtn}>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</button>
    </div>
  );
}

// ── 我的攒钱目标(孩子端动机 · 复用 .nesio-reward-progress)────────────────────────
function GoalSection({ familyId, me, owed, onSaved, t }: {
  familyId: string; me: FamilyMemberView; owed: number; onSaved: () => void; t: (a: string, b: string) => string;
}) {
  const goal = me.goalAmount ?? 0;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(goal ? String(goal) : '');
  const [label, setLabel] = useState(me.goalLabel ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const amt = Number(amount);
    setBusy(true); setErr('');
    const r = await setMyGoal(familyId, amt > 0 ? amt : 0, label.trim());
    setBusy(false);
    if (!r.ok) { setErr(t('没存上,再试一次。', 'Could not save — try again.')); return; }
    setOpen(false); onSaved();
  }

  if (open) {
    return (
      <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{t('攒够钱想买什么?', 'Saving up for what?')}</p>
        <input style={inputStyle} placeholder={t('想要的东西(如「乐高」)', 'What you want (e.g. Lego)')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={inputStyle} inputMode="decimal" placeholder={t('目标金额 $', 'Goal amount $')} value={amount} onChange={(e) => setAmount(e.target.value)} />
        {err && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{err}</span>}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" onClick={save} disabled={busy} style={primaryBtn}>{busy ? t('保存中…', 'Saving…') : t('定下目标', 'Set goal')}</button>
          {goal > 0 && <button type="button" onClick={() => { setAmount(''); void setMyGoal(familyId, 0, '').then(onSaved); setOpen(false); }} style={ghostBtn}>{t('取消目标', 'Clear')}</button>}
          <button type="button" onClick={() => { setOpen(false); setErr(''); }} style={ghostBtn}>{t('返回', 'Back')}</button>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...ghostBtn, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <IconTarget size={14} /> {t('设一个攒钱目标', 'Set a savings goal')}
      </button>
    );
  }

  const reached = owed >= goal;
  const pct = Math.max(0, Math.min(100, Math.round((owed / goal) * 100)));
  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', background: reached ? 'var(--status-go-soft)' : 'var(--portal-accent-soft)', borderColor: 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, color: reached ? 'var(--status-go)' : 'var(--portal-ink)' }}>
          {reached ? <IconStar size={15} /> : <IconTarget size={15} />}{me.goalLabel || t('攒钱目标', 'Savings goal')}
        </span>
        <button type="button" onClick={() => setOpen(true)} style={{ border: 'none', background: 'transparent', color: 'var(--portal-accent)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>{t('改', 'Edit')}</button>
      </div>
      <div className="nesio-reward-progress" style={{ marginTop: 'var(--space-2)' }}>
        <div className="nesio-reward-progress-fill" style={{ width: `${pct}%`, background: reached ? 'var(--status-go)' : 'var(--portal-blue-deep)' }} />
      </div>
      <p className="nesio-reward-progress-label" style={{ color: reached ? 'var(--status-go)' : 'var(--portal-muted)' }}>
        {reached
          ? t(`攒够了!可以买 ${me.goalLabel || '它'} 了`, `Goal reached — you can get ${me.goalLabel || 'it'}!`)
          : t(`${money(owed)} / ${money(goal)} · 还差 ${money(Math.max(0, goal - owed))}`, `${money(owed)} / ${money(goal)} · ${money(Math.max(0, goal - owed))} to go`)}
      </p>
    </div>
  );
}

// ── 家庭板 ────────────────────────────────────────────────────────────────────
function BoardScreen({ familyId, families, onSwitchFamily, onOpenLedger, t }: {
  familyId: string; families: FamilySummary[];
  onSwitchFamily: (id: string) => void;
  onOpenLedger: (member: FamilyMemberView) => void;
  t: (a: string, b: string) => string;
}) {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showAssigned, setShowAssigned] = useState(false);   // 已安排默认折叠(周期家务会铺很多条)

  const load = useCallback(async () => {
    setErr('');
    const r = await getBoard(familyId);
    if (!r.ok) { setErr(r.error); return; }
    setBoard(r.data.board);
  }, [familyId]);

  useEffect(() => { void load(); }, [load]);

  async function act(instanceId: string, action: 'done' | 'approve' | 'send_back') {
    setBusyId(instanceId + action); setErr('');
    const r = await choreAction(familyId, instanceId, action);
    setBusyId('');
    if (!r.ok) { setErr(r.error); return; }
    void load();
  }

  if (err && !board) return <ErrorRow msg={t('没连上,稍后再试。', 'Could not load — try again.')} onRetry={load} t={t} />;
  if (!board) return <Muted>{t('加载中…', 'Loading…')}</Muted>;

  // 名字/头像来自成员自己的账号资料(family_members 行),不匹配 People。
  const memberOf = (id: string) => board.everyone.find((e) => e.member.id === id)?.member;
  const displayName = (id: string): string => memberOf(id)?.name || t('家人', 'family');
  const avatarOf = (id: string): string => memberOf(id)?.avatarUrl || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {families.length > 1 && (
        <select value={familyId} onChange={(e) => onSwitchFamily(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          {families.map((f) => <option key={f.familyId} value={f.familyId}>{f.name}</option>)}
        </select>
      )}

      {err && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{t('那一下没成,再试一次。', 'That didn’t go through — try again.')}</span>}

      {/* 我的攒钱目标(孩子端动机):攒够就买 XX。进度 = 现攒 / 目标。 */}
      <GoalSection familyId={familyId} me={board.me} owed={board.everyone.find((e) => e.member.id === board.me.id)?.owed ?? 0} onSaved={load} t={t} />

      <InviteSection inviteCode={families.find((f) => f.familyId === familyId)?.inviteCode ?? ''} t={t} />

      <section>
        <p style={sectLabel}>{t('你今天的活', 'Your chores today')}</p>
        <div style={cardStyle}>
          {board.myChoresToday.length === 0 && <p style={{ ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{t('今天没有待办 —— 轻松一下。', 'Nothing due today — take it easy.')}</p>}
          {board.myChoresToday.map((c, i) => (
            <div key={c.id} style={{ ...rowStyle, borderBottom: i === board.myChoresToday.length - 1 ? 'none' : rowStyle.borderBottom }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{choreTitle(c, t)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{c.state === 'done' ? t('已提交,等审核', 'Submitted — waiting for review') : t('干完点「完成」', 'Tap Done when finished')} · {money(c.value)}</div>
              </div>
              {c.state === 'todo' && (
                <button type="button" onClick={() => act(c.id, 'done')} disabled={busyId === c.id + 'done'} style={primaryBtn}>{t('完成', 'Done')}</button>
              )}
              {c.state === 'done' && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{t('待审', 'In review')}</span>}
            </div>
          ))}
        </div>
      </section>

      {board.me.canApprove && board.toReview.length > 0 && (
        <section>
          <p style={sectLabel}>{t('待审', 'To review')} · <span style={{ textTransform: 'none', color: 'var(--portal-accent)' }}>{t('你可以审核', 'you can approve')}</span></p>
          <div style={cardStyle}>
            {board.toReview.map((c, i) => (
              <div key={c.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-2)', borderBottom: i === board.toReview.length - 1 ? 'none' : rowStyle.borderBottom }}>
                <div style={{ fontSize: 'var(--text-body)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><MemberAvatar name={displayName(c.assigneeId)} avatar={avatarOf(c.assigneeId)} size={22} /><span>{displayName(c.assigneeId)} · {choreTitle(c, t)} <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>{money(c.value)}</span></span></div>
                {c.proofPhotoRef && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}><IconCamera size={12} />{t('附了张存证照 —— 只存在你们家庭里。', 'A photo was added — stays in your family vault.')}</div>}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button type="button" onClick={() => act(c.id, 'approve')} disabled={busyId === c.id + 'approve'} style={{ ...goBtn, flex: 1 }}>{t('看着不错', 'Looks good')}</button>
                  <button type="button" onClick={() => act(c.id, 'send_back')} disabled={busyId === c.id + 'send_back'} style={{ ...ghostBtn, flex: 1 }}>{t('再来一次', 'Try again')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {board.assigned.length > 0 && (() => {
        // 按 标题+被分派人 归并 —— 周期家务(每天铺一条)收成一行,不刷屏。
        const groups = new Map<string, { title: string; assigneeId: string; count: number; earliest: string; done: number }>();
        for (const c of board.assigned) {
          const key = `${choreTitle(c, t)}|${c.assigneeId}`;
          const g = groups.get(key) ?? { title: choreTitle(c, t), assigneeId: c.assigneeId, count: 0, earliest: c.dueDate, done: 0 };
          g.count += 1;
          if (c.state === 'approved' || c.state === 'paid') g.done += 1;
          if (c.dueDate < g.earliest) g.earliest = c.dueDate;
          groups.set(key, g);
        }
        const rows = [...groups.values()].sort((a, b) => (a.earliest < b.earliest ? -1 : a.earliest > b.earliest ? 1 : 0));
        return (
          <section>
            <button type="button" onClick={() => setShowAssigned((v) => !v)}
              style={{ ...sectLabel, display: 'flex', alignItems: 'center', gap: 'var(--space-1)', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
              {t('已安排', 'Assigned')} · {rows.length} {showAssigned ? '▾' : '▸'}
            </button>
            {showAssigned && (
              <div style={cardStyle}>
                {rows.map((g, i) => (
                  <div key={`${g.title}-${g.assigneeId}`} style={{ ...rowStyle, borderBottom: i === rows.length - 1 ? 'none' : rowStyle.borderBottom }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>
                        {g.title}{g.count > 1 ? ` · ×${g.count}` : ''}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                        {t('交给', 'for')} {displayName(g.assigneeId)}
                        {g.count > 1 ? ` · ${t('完成', 'done')} ${g.done}/${g.count} · ${t('自', 'from')} ${g.earliest}` : ` · ${g.earliest}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })()}

      <section>
        <p style={sectLabel}>{t('大家', 'Everyone')}</p>
        <div style={cardStyle}>
          {board.everyone.map((e, i) => (
            <button key={e.member.id} type="button" onClick={() => onOpenLedger(e.member)}
              style={{ ...rowStyle, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === board.everyone.length - 1 ? 'none' : '1px solid var(--portal-line)', cursor: 'pointer' }}>
              <MemberAvatar name={displayName(e.member.id)} avatar={avatarOf(e.member.id)} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{displayName(e.member.id)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('攒了', 'saved up')}</div>
              </div>
              <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, fontVariantNumeric: 'tabular-nums' }}>{money(e.owed)}</span>
              <span style={{ color: 'var(--portal-muted)' }}>›</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
const roleChip: React.CSSProperties = { border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const roleChipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 'var(--weight-semibold)' as unknown as number };

// 成员头像:配到 People 有头像用头像,否则首字母兜底(圆形,主题色)。
function MemberAvatar({ name, avatar, size = 28 }: { name: string; avatar: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} draggable={false} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(size * 0.42)}px`, fontWeight: 'var(--weight-semibold)' as unknown as number, flexShrink: 0 }}>
      {initial}
    </div>
  );
}
function assignedStateLabel(state: ChoreInstanceView['state'], t: (a: string, b: string) => string): string {
  switch (state) {
    case 'todo': return t('待完成', 'To do');
    case 'done': return t('待审', 'In review');
    case 'approved': return t('已完成', 'Done');
    case 'paid': return t('已结清', 'Paid');
    default: return '';
  }
}
function choreTitle(c: ChoreInstanceView, t: (a: string, b: string) => string): string {
  if (c.title && c.title.trim()) return c.title.trim();          // 日历事件分派而来:显示原标题
  return c.templateId ? t('家务', 'Chore') + ` · ${c.dueDate}` : c.dueDate;
}

// ── 账本(点某人进来:账本 + 就地管理 TA 的角色/去留)──────────────────────────────
function LedgerScreen({ familyId, person, me, onChanged, onLeft, t }: {
  familyId: string; person: FamilyMemberView; me: FamilyMemberView;
  onChanged: () => void; onLeft: () => void; t: (a: string, b: string) => string;
}) {
  const personId = person.id;
  const canRecordPayout = me.canRecordPayout;
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [err, setErr] = useState('');
  const [payAmt, setPayAmt] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState('');
  const [showPay, setShowPay] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    const r = await getLedger(familyId, personId);
    if (!r.ok) { setErr(r.error); return; }
    setLedger(r.data.ledger);
  }, [familyId, personId]);

  useEffect(() => { void load(); }, [load]);

  async function pay() {
    const amt = Number(payAmt);
    if (!(amt > 0)) { setPayErr(t('填一个大于 0 的金额。', 'Enter an amount greater than 0.')); return; }
    setPayBusy(true); setPayErr('');
    const r = await recordPayout(familyId, personId, amt);
    setPayBusy(false);
    if (!r.ok) { setPayErr(t('没记上,再试一次。', 'Could not record — try again.')); return; }
    setPayAmt(''); setShowPay(false); void load();
  }

  if (err && !ledger) return <ErrorRow msg={t('没连上,稍后再试。', 'Could not load — try again.')} onRetry={load} t={t} />;
  if (!ledger) return <Muted>{t('加载中…', 'Loading…')}</Muted>;

  const history = [
    ...ledger.approved.map((c) => ({ id: c.id, title: choreTitle(c, t), date: c.approvedAt?.slice(0, 10) ?? c.dueDate, delta: c.value })),
    ...ledger.payouts.map((p) => ({ id: p.id, title: t('你给了现金 · 从攒的里扣', 'You gave cash · deducted'), date: p.date, delta: -p.amount })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ ...cardStyle, padding: 'var(--space-4)' }}>
        {/* owed<0 = 你给的现金比 TA 挣的还多(多给了),别显示成「欠 -$20」那种迷惑负数。 */}
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{ledger.balance.owed >= 0 ? t('还欠 TA', 'You still owe') : t('已多给 TA', 'You’ve overpaid')}</div>
        <div style={{ fontSize: 'var(--text-display)', fontWeight: 'var(--weight-bold)' as unknown as number, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{money(Math.abs(ledger.balance.owed))}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginTop: 'var(--space-1)' }}>
          {t('审核过的家务往上加 · 你给的现金往下扣', 'Approved chores add up · cash you give deducts')}
        </div>
      </div>

      <section>
        <p style={sectLabel}>{t('历史', 'History')}</p>
        <div style={cardStyle}>
          {history.length === 0 && <p style={{ ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{t('还没有记录。', 'Nothing yet.')}</p>}
          {history.map((h, i) => (
            <div key={h.id} style={{ ...rowStyle, borderBottom: i === history.length - 1 ? 'none' : rowStyle.borderBottom }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)' }}>{h.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{h.date}</div>
              </div>
              <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, color: h.delta >= 0 ? 'var(--status-go)' : 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {h.delta >= 0 ? '+' : '−'}{money(Math.abs(h.delta))}
              </span>
            </div>
          ))}
        </div>
      </section>

      {canRecordPayout && (
        showPay ? (
          <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <input style={inputStyle} inputMode="decimal" placeholder={t('给了多少现金?', 'How much cash did you give?')} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
            {payErr && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{payErr}</span>}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" onClick={pay} disabled={payBusy} style={primaryBtn}>{payBusy ? t('记账中…', 'Recording…') : t('记下这笔', 'Record it')}</button>
              <button type="button" onClick={() => { setShowPay(false); setPayErr(''); }} style={ghostBtn}>{t('取消', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setShowPay(true)} style={{ ...primaryBtn, alignSelf: 'stretch' }}>{t('给了现金 → 记一笔', 'Pay out cash → record it')}</button>
        )
      )}

      <MemberAdmin familyId={familyId} person={person} me={me} onChanged={onChanged} onLeft={onLeft} t={t} />

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 0 }}>
        {t('Nesio 永不碰钱。现金你来给,我们只把账记清 —— 审核过的家务往上加,你给的现金往下扣。没有银行、没有卡、没有要打电话取消的订阅。',
          'Nesio never moves money. You give the cash; we just keep the count straight — approved chores add up, cash you give deducts.')}
      </p>
    </div>
  );
}

// ── 成员管理(点某人进账本页里的一块:改 TA 角色 / 移出 / 退出)────────────────────
// 从独立「成员」区挪来:家庭成员就是 People 之外自成一套的登录账号,管理跟着人走。
function MemberAdmin({ familyId, person, me, onChanged, onLeft, t }: {
  familyId: string; person: FamilyMemberView; me: FamilyMemberView;
  onChanged: () => void; onLeft: () => void; t: (a: string, b: string) => string;
}) {
  const isMe = person.id === me.id;
  const canManage = me.canApprove;
  const [isParent, setIsParent] = useState(person.canApprove);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  // 既不能管别人、又不是自己(无「退出」)→ 这块对 TA 没有任何动作,不渲染。
  if (!canManage && !isMe) return null;

  async function setRole(parent: boolean) {
    if (parent === isParent) return;
    setBusy('role'); setErr('');
    const role = parent
      ? { canApprove: true, needsApproval: false, canRecordPayout: true }
      : { canApprove: false, needsApproval: true, canRecordPayout: false };
    const r = await setMemberRole(familyId, person.id, role);
    setBusy('');
    if (!r.ok) { setErr(r.error === 'conflict' ? t('至少要留一位家长。', 'Keep at least one parent.') : t('没改成,再试一次。', 'Could not change — try again.')); return; }
    setIsParent(parent); onChanged();
  }
  async function remove() {
    setBusy('remove'); setErr('');
    const r = await removeMember(familyId, person.id);
    setBusy('');
    if (!r.ok) { setErr(r.error === 'conflict' ? t('先把家长身份交给别人,再退出。', 'Hand the parent role to someone first.') : t('没成,再试一次。', 'Could not do that — try again.')); return; }
    if (isMe) { onLeft(); return; }       // 退出自己 → 回到板并刷新(已不是成员)
    onChanged(); onLeft();                 // 移出别人 → 该账本页无意义了,退回板
  }

  return (
    <section>
      <p style={sectLabel}>{t('这个人', 'This person')}</p>
      <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <MemberAvatar name={person.name} avatar={person.avatarUrl || ''} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{person.name}{isMe ? t(' (我)', ' (me)') : ''}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{isParent ? t('家长 · 能审核·记付款', 'Parent · reviews & pays') : t('孩子 · 做完要家长看一眼', 'Kid · needs review')}</div>
          </div>
        </div>

        {canManage && (
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginBottom: 'var(--space-1)' }}>{t('身份', 'Role')}</div>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              <button type="button" onClick={() => void setRole(true)} disabled={busy === 'role' || isParent}
                style={{ ...roleChip, ...(isParent ? roleChipOn : {}) }}>{t('家长', 'Parent')}</button>
              <button type="button" onClick={() => void setRole(false)} disabled={busy === 'role' || !isParent}
                style={{ ...roleChip, ...(!isParent ? roleChipOn : {}) }}>{t('孩子', 'Kid')}</button>
            </div>
          </div>
        )}

        {err && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{err}</span>}

        {(canManage || isMe) && (
          confirmRemove ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
                {isMe ? t('确定退出这个家庭?你的账本记录会留给家人。', 'Leave this family? Your ledger stays with the family.')
                      : t('把 TA 从家庭移出?TA 的账本记录会保留。', 'Remove them from the family? Their ledger is kept.')}
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" onClick={() => void remove()} disabled={busy === 'remove'}
                  style={{ ...primaryBtn, background: 'var(--status-risk)' }}>{busy === 'remove' ? t('处理中…', 'Working…') : isMe ? t('退出家庭', 'Leave') : t('确认移出', 'Remove')}</button>
                <button type="button" onClick={() => setConfirmRemove(false)} style={ghostBtn}>{t('先不', 'Not now')}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setConfirmRemove(true); setErr(''); }}
              style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--status-risk)', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 'var(--space-1) 0' }}>
              {isMe ? t('退出这个家庭', 'Leave this family') : t('把 TA 移出家庭', 'Remove from family')}
            </button>
          )
        )}
      </div>
    </section>
  );
}
