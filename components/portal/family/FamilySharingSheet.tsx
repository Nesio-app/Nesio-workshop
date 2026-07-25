'use client';

/**
 * FamilySharingSheet — 家务 + 零花钱账本(workshop 域实验 M3)。
 * 一屏三态:① 没家庭 → 建家/入伙;② 家庭板(区块按权限:待审仅 can_approve);
 * ③ 某成员账本(欠多少 + 历史 + 发薪冲账)。**一个 app 所有人一样**,区块由权限显隐,
 * 但真正的门在服务端(核心 fail-closed)。Nesio 永不碰钱。每个异步动作都有显式失败态(红线)。
 */
import { useCallback, useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listFamilies, createFamily, joinFamily, getBoard, getLedger, choreAction, recordPayout,
  type FamilySummary, type BoardView, type LedgerView, type ChoreInstanceView,
} from '@/lib/family/family-client';

type View = { kind: 'board' } | { kind: 'ledger'; personId: string; personName: string };

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
          title={view.kind === 'ledger' ? `${view.personName}${t(' 的账本', "’s ledger")}` : t('家庭分享', 'Family')}
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
              onOpenLedger={(personId, personName) => setView({ kind: 'ledger', personId, personName })}
              t={t}
            />
          )}

          {!loading && !loadErr && view.kind === 'ledger' && me && (
            <LedgerScreen familyId={familyId} personId={view.personId} canRecordPayout={me.canRecordPayout} t={t} />
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
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState('');

  async function submit() {
    setStatus('busy'); setErr('');
    const r = tab === 'create'
      ? await createFamily(name.trim(), displayName.trim())
      : await joinFamily(code.trim(), displayName.trim());
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

// ── 家庭板 ────────────────────────────────────────────────────────────────────
function BoardScreen({ familyId, families, onSwitchFamily, onOpenLedger, t }: {
  familyId: string; families: FamilySummary[];
  onSwitchFamily: (id: string) => void;
  onOpenLedger: (personId: string, personName: string) => void;
  t: (a: string, b: string) => string;
}) {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {families.length > 1 && (
        <select value={familyId} onChange={(e) => onSwitchFamily(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          {families.map((f) => <option key={f.familyId} value={f.familyId}>{f.name}</option>)}
        </select>
      )}

      {err && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)' }}>{t('那一下没成,再试一次。', 'That didn’t go through — try again.')}</span>}

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
                <div style={{ fontSize: 'var(--text-body)' }}>{nameFor(board, c.assigneeId)} · {choreTitle(c, t)} <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>{money(c.value)}</span></div>
                {c.proofPhotoRef && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>📷 {t('附了张存证照 —— 只存在你们家庭里。', 'A photo was added — stays in your family vault.')}</div>}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button type="button" onClick={() => act(c.id, 'approve')} disabled={busyId === c.id + 'approve'} style={{ ...goBtn, flex: 1 }}>{t('看着不错', 'Looks good')}</button>
                  <button type="button" onClick={() => act(c.id, 'send_back')} disabled={busyId === c.id + 'send_back'} style={{ ...ghostBtn, flex: 1 }}>{t('再来一次', 'Try again')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {board.assigned.length > 0 && (
        <section>
          <p style={sectLabel}>{t('已安排', 'Assigned')}</p>
          <div style={cardStyle}>
            {board.assigned.map((c, i) => (
              <div key={c.id} style={{ ...rowStyle, borderBottom: i === board.assigned.length - 1 ? 'none' : rowStyle.borderBottom }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{choreTitle(c, t)}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                    {t('交给', 'for')} {nameFor(board, c.assigneeId) || t('家人', 'family')} · {assignedStateLabel(c.state, t)} · {c.dueDate}{c.value > 0 ? ` · ${money(c.value)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p style={sectLabel}>{t('大家', 'Everyone')}</p>
        <div style={cardStyle}>
          {board.everyone.map((e, i) => (
            <button key={e.member.id} type="button" onClick={() => onOpenLedger(e.member.id, e.member.name)}
              style={{ ...rowStyle, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === board.everyone.length - 1 ? 'none' : '1px solid var(--portal-line)', cursor: 'pointer' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{e.member.name}</div>
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

function nameFor(board: BoardView, personId: string): string {
  return board.everyone.find((e) => e.member.id === personId)?.member.name ?? '';
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

// ── 账本 ──────────────────────────────────────────────────────────────────────
function LedgerScreen({ familyId, personId, canRecordPayout, t }: {
  familyId: string; personId: string; canRecordPayout: boolean; t: (a: string, b: string) => string;
}) {
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
    ...ledger.payouts.map((p) => ({ id: p.id, title: t('发薪 —— 已付现金', 'Payday — paid in cash'), date: p.date, delta: -p.amount })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ ...cardStyle, padding: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{t('现在欠 TA', 'Owed right now')}</div>
        <div style={{ fontSize: 'var(--text-display)', fontWeight: 'var(--weight-bold)' as unknown as number, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{money(ledger.balance.owed)}</div>
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

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 0 }}>
        {t('Nesio 永不碰钱。现金你来给,我们只把账记清 —— 审核过的家务往上加,发薪把它清零。没有银行、没有卡、没有要打电话取消的订阅。',
          'Nesio never moves money. You give the cash; we just keep the count straight — approved chores add up, a payout zeroes it out.')}
      </p>
    </div>
  );
}
