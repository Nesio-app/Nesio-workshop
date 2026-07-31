'use client';

/**
 * FamilySharingSheet — 家务 + 零花钱账本(workshop 域实验 M3)。
 * 一屏三态:① 没家庭 → 建家/入伙;② 家庭板(区块按权限:待审仅 can_approve);
 * ③ 某成员账本(欠多少 + 历史 + 发薪冲账)。**一个 app 所有人一样**,区块由权限显隐,
 * 但真正的门在服务端(核心 fail-closed)。Nesio 永不碰钱。每个异步动作都有显式失败态(红线)。
 */
import { useCallback, useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import LoadingCard from '../ui/LoadingCard';
import { IconCamera } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale, loadProfileSettings } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listFamilies, createFamily, joinFamily, getBoard, getLedger, choreAction, recordPayout, reversePayout, syncMyFamilyProfile,
  setMemberRole, removeMember,
  type FamilySummary, type FamilyMemberView, type BoardView, type LedgerView, type ChoreInstanceView,
} from '@/lib/family/family-client';

type View = { kind: 'board' } | { kind: 'ledger'; person: FamilyMemberView };
type Dict = 'zh' | 'en';

// 货币符号跟随语言:中文 ¥、英文 $。金额纯展示(Nesio 永不碰钱),不做汇率换算。
const money = (n: number, dict: Dict) => `${dict === 'en' ? '$' : '¥'}${n.toFixed(2)}`;

export default function FamilySharingSheet({ open, onClose, onToday }: {
  open: boolean;
  /** 关掉这一层 —— 背后就是洞察(左上「‹ 洞察」走这条)。 */
  onClose: () => void;
  /** 右上「今天」:连洞察一起关掉,回到今天页。没传就退化成只关自己。 */
  onToday?: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [view, setView] = useState<View>({ kind: 'board' });

  // 2026-07-29:这里原本把 familyId 写进 useCallback 依赖,再在函数体里读它 —— 两个后果:
  //   ① 每次选中家庭变化都造一个新函数,下面那个 effect 就跟着重跑一次,白拉一趟;
  //   ② 「退出家庭」那条路会拿**旧闭包**调它(familyId 还是老值),
  //      `!familyId` 判假 → 不重选家庭 → 落进「不 loading、无报错、也没内容」的空屏。
  // 改成用 setFamilyId 的函数式更新拿当前值,回调只依赖空数组 —— 拉一次、选得准。
  const refreshFamilies = useCallback(async () => {
    setLoading(true); setLoadErr('');
    // 打开时把「我」的账号名字/头像同步到成员行(身份自成一套,不匹配 People)。best-effort。
    try { const p = loadProfileSettings(); await syncMyFamilyProfile(p.displayName, p.avatarUrl || ''); } catch { /* 首次未入伙时无行可更,忽略 */ }
    const r = await listFamilies();
    if (!r.ok) { setLoadErr(r.error); setLoading(false); return; }
    const list = r.data.families;
    setFamilies(list);
    // 当前选中的家庭还在列表里就保持,否则(首次进 / 刚退出)落到第一个。
    setFamilyId((cur) => (cur && list.some((f) => f.familyId === cur) ? cur : (list[0]?.familyId ?? '')));
    setLoading(false);
  }, []);

  useEffect(() => { if (open) void refreshFamilies(); }, [open, refreshFamilies]);

  if (!open) return null;

  const me = families.find((f) => f.familyId === familyId)?.me ?? null;

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('家庭分享', 'Family sharing')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        {/* bug3:「家庭分享」这个标题删掉;左边回洞察、右边回今天 —— 与其他页面同一套页头。
            账本子页时左边先回家庭板。 */}
        <Header
          title={view.kind === 'ledger' ? `${view.person.name}${t(' 的账本', "’s ledger")}` : ''}
          backLabel={view.kind === 'ledger' ? t('返回', 'Back') : t('洞察', 'Insights')}
          onBack={view.kind === 'ledger' ? () => setView({ kind: 'board' }) : onClose}
          onToday={onToday ?? onClose}
          t={t}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* 等待态必须看得出「在动」,并且**有尽头** —— 数据层已带 12s 超时,
              这里再挂一道 15s 兜底:再久也不许停在加载态(CLAUDE.md 红线)。 */}
          {loading && (
            <LoadingCard
              label={t('正在打开家里的账本…', 'Opening the family board…')}
              lines={3}
              timeoutMs={15_000}
              onTimeout={() => { setLoading(false); setLoadErr('timeout'); }}
            />
          )}
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
              dict={dict}
              t={t}
            />
          )}

          {!loading && !loadErr && view.kind === 'ledger' && me && (
            <LedgerScreen
              familyId={familyId}
              person={view.person}
              me={me}
              onChanged={refreshFamilies}
              onLeft={() => { setView({ kind: 'board' }); void refreshFamilies(); }}
              dict={dict}
              t={t}
            />
          )}
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 小组件 ────────────────────────────────────────────────────────────────────
function Header({ title, backLabel, onBack, onToday, t }: {
  title: string; backLabel: string; onBack: () => void; onToday: () => void; t: (a: string, b: string) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--portal-line)' }}>
      <button type="button" onClick={onBack} style={backBtn}>‹ {backLabel}</button>
      <h2 style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>{title}</h2>
      <button type="button" onClick={onToday} aria-label={t('回到今天', 'Back to Today')} style={{ ...backBtn, textAlign: 'right' }}>{t('今天', 'Today')}</button>
    </div>
  );
}
const backBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, cursor: 'pointer', minWidth: 44, padding: 'var(--space-1)' };
const cardStyle: React.CSSProperties = { background: 'var(--portal-bg)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderBottom: '1px solid var(--portal-line)' };
const sectLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, margin: '0 0 var(--space-2)' };

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
  const [open, setOpen] = useState(false);   // 图24:默认收起,点「邀请家人」才显码
  if (!inviteCode) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* 复制不了也没关系,码是明文摆着的,可手抄 */ }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', padding: 'var(--space-2) 0 0', cursor: 'pointer',
          color: 'var(--portal-accent)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)' }}>
        {t('+ 邀请家人', '+ Invite family')}
      </button>
    );
  }
  return (
    <div style={{ ...cardStyle, marginTop: 'var(--space-2)', padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('让 TA 各自登录后输入这个码', 'They enter this after signing in')}</div>
        <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-bold)' as unknown as number, letterSpacing: '0.14em', color: 'var(--portal-accent)' }}>{inviteCode}</div>
      </div>
      <button type="button" onClick={copy} style={ghostBtn}>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</button>
    </div>
  );
}

// ── 我的攒钱目标(孩子端动机 · 复用 .nesio-reward-progress)────────────────────────
// ── 家庭板 ────────────────────────────────────────────────────────────────────
function BoardScreen({ familyId, families, onSwitchFamily, onOpenLedger, dict, t }: {
  familyId: string; families: FamilySummary[];
  onSwitchFamily: (id: string) => void;
  onOpenLedger: (member: FamilyMemberView) => void;
  dict: Dict;
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
  if (!board) return <LoadingCard label={t('正在读家庭板…', 'Loading the board…')} lines={3} />;

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
      {/* 攒钱目标(愿望)已按标注搬到奖励模块(components/portal/family/FamilyGoalCard.tsx)——
          「愿望集成到 rewards 板块」。这里不再重复一份。 */}

      {/* 2026-07-28 UI 精修(标注 图24):常驻在顶部的邀请码卡删掉 —— 家庭建好之后极少再用,
          却每次打开都占一整张卡。改成收进下面「大家」小节里的一个链接(见 InviteSection),
          点开才显码。功能没丢,只是不再挡在最前面。 */}

      <section>
        <p style={sectLabel}>{t('你今天的活', 'Your chores today')}</p>
        <div style={cardStyle}>
          {board.myChoresToday.length === 0 && <p style={{ ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{t('今天没有待办 —— 轻松一下。', 'Nothing due today — take it easy.')}</p>}
          {board.myChoresToday.map((c, i) => (
            <div key={c.id} style={{ ...rowStyle, borderBottom: i === board.myChoresToday.length - 1 ? 'none' : rowStyle.borderBottom }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{choreTitle(c, t)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{c.state === 'done' ? t('已提交,等审核', 'Submitted — waiting for review') : t('干完点「完成」', 'Tap Done when finished')} · {money(c.value, dict)}</div>
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
                <div style={{ fontSize: 'var(--text-body)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><MemberAvatar name={displayName(c.assigneeId)} avatar={avatarOf(c.assigneeId)} size={22} /><span>{displayName(c.assigneeId)} · {choreTitle(c, t)} <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>{money(c.value, dict)}</span></span></div>
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
              <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, fontVariantNumeric: 'tabular-nums' }}>{money(e.owed, dict)}</span>
              <span style={{ color: 'var(--portal-muted)' }}>›</span>
            </button>
          ))}
        </div>
        {/* 图24:邀请码收到这儿 —— 要加人的时候才会来看「大家」,入口和场景对上了。 */}
        <InviteSection inviteCode={families.find((f) => f.familyId === familyId)?.inviteCode ?? ''} t={t} />
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

// ── 统计(本周/本月 + 近 8 周柱状图 + 常做的活)· 全部由 approved 客户端算,无新接口 ────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y || 1970, (m || 1) - 1, d || 1); };
const weekStartKey = (s: string) => { const d = parseYmd(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); }; // 周一为一周起点

function StatsSection({ approved, dict, t }: { approved: ChoreInstanceView[]; dict: Dict; t: (a: string, b: string) => string }) {
  if (approved.length === 0) return null;
  const dateOf = (c: ChoreInstanceView) => c.approvedAt?.slice(0, 10) || c.dueDate;
  const now = new Date();
  const todayKey = ymd(now);
  const thisWeekStart = weekStartKey(todayKey);
  const thisMonthPrefix = todayKey.slice(0, 7);

  let weekCount = 0, weekEarned = 0, monthCount = 0, monthEarned = 0;
  const byTitle = new Map<string, { count: number; sum: number }>();
  const byWeek = new Map<string, number>();
  for (const c of approved) {
    const dk = dateOf(c);
    if (weekStartKey(dk) === thisWeekStart) { weekCount += 1; weekEarned += c.value; }
    if (dk.slice(0, 7) === thisMonthPrefix) { monthCount += 1; monthEarned += c.value; }
    const tt = choreTitle(c, t);
    const g = byTitle.get(tt) ?? { count: 0, sum: 0 }; g.count += 1; g.sum += c.value; byTitle.set(tt, g);
    const wk = weekStartKey(dk); byWeek.set(wk, (byWeek.get(wk) ?? 0) + c.value);
  }

  // 近 8 周(含本周)每周攒的
  const weeks: string[] = [];
  const base = parseYmd(thisWeekStart);
  for (let i = 7; i >= 0; i -= 1) { const w = new Date(base); w.setDate(base.getDate() - i * 7); weeks.push(ymd(w)); }
  const bars = weeks.map((w) => ({ week: w, earned: byWeek.get(w) ?? 0 }));
  const maxBar = Math.max(1, ...bars.map((b) => b.earned));

  const top = [...byTitle.entries()].map(([title, g]) => ({ title, ...g })).sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={sectLabel}>{t('统计', 'Stats')}</p>

      {/* 本周 / 本月 */}
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {[{ label: t('本周', 'This week'), n: weekCount, e: weekEarned }, { label: t('本月', 'This month'), n: monthCount, e: monthEarned }].map((s) => (
          <div key={s.label} style={{ ...cardStyle, flex: 1, padding: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{s.label}</div>
            <div style={{ fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)' as unknown as number, lineHeight: 1.1, color: 'var(--portal-ink)', fontVariantNumeric: 'tabular-nums' }}>{money(s.e, dict)}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t(`完成 ${s.n} 件`, `${s.n} done`)}</div>
          </div>
        ))}
      </div>

      {/* 近 8 周柱状图 */}
      <div style={{ ...cardStyle, padding: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginBottom: 'var(--space-2)' }}>{t('近 8 周攒的 · 每根一周', 'Last 8 weeks · one bar per week')}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-1)', height: 64 }}>
          {bars.map((b, i) => {
            const isNow = i === bars.length - 1;
            const h = Math.round((b.earned / maxBar) * 100);
            return (
              <div key={b.week} title={`${b.week} · ${money(b.earned, dict)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${Math.max(b.earned > 0 ? 6 : 2, h)}%`, background: isNow ? 'var(--portal-blue-deep)' : 'var(--portal-accent-soft-md)', borderRadius: 'var(--radius-sm)', transition: 'height .2s' }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* 常做的活 —— 回答「做了哪些活」*/}
      <div style={cardStyle}>
        <div style={{ ...rowStyle, borderBottom: '1px solid var(--portal-line)', paddingBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('都做了哪些活', 'What got done')}</span>
        </div>
        {top.map((row, i) => (
          <div key={row.title} style={{ ...rowStyle, borderBottom: i === top.length - 1 ? 'none' : rowStyle.borderBottom }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>×{row.count}</span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' as unknown as number, color: 'var(--status-go)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(row.sum, dict)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 账本(点某人进来:账本 + 就地管理 TA 的角色/去留)──────────────────────────────
function LedgerScreen({ familyId, person, me, onChanged, onLeft, dict, t }: {
  familyId: string; person: FamilyMemberView; me: FamilyMemberView;
  onChanged: () => void; onLeft: () => void; dict: Dict; t: (a: string, b: string) => string;
}) {
  const personId = person.id;
  const canRecordPayout = me.canRecordPayout;
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [err, setErr] = useState('');
  const [payAmt, setPayAmt] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState('');   // 待确认冲正的 payoutId
  const [revBusy, setRevBusy] = useState('');
  const [revErr, setRevErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    const r = await getLedger(familyId, personId);
    if (!r.ok) { setErr(r.error); return; }
    setLedger(r.data.ledger);

    // ── 家务月度小结 ────────────────────────────────────────────────────────
    // monthly-digest 的开机那一趟**故意**不拉这个:账本在服务端,开机时打一个网络
    // 请求去算一条小结,离线就静默失败 —— 那种「有时有有时没有」的节点比没有更糟。
    // 所以约定是「等家庭板加载完账本时由它来调」,这里就是那个时刻:数据已经在手上,
    // 不额外发一次请求,失败了也只是这一次没折。
    //
    // 只折**我自己**的账本:小结节点的幂等键是 (类型, 月份),没有人的维度。
    // 顺手把看到的每个人都折进去的话,「这个月家务干了多少」会变成
    // 「我最后点开的那个人干了多少」—— 一个看起来对、其实随手一点就变的数字。
    if (personId !== me.id) return;
    try {
      const m = await import('@/lib/portal/monthly-digest');
      const events = r.data.ledger.approved
        .map((c) => ({ date: c.approvedAt?.slice(0, 10) ?? c.dueDate, label: choreTitle(c, t) }))
        .filter((e) => Boolean(e.date));
      // 只重算最近 3 个月 —— 更早的不会再变(账本是只增的)
      for (const d of m.foldEventsToDigests('chore', events, new Date()).slice(0, 3)) {
        m.upsertMonthlyDigest(d);
      }
    } catch { /* 折不出来不影响看账本 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, personId, me.id]);

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

  async function reverse(payoutId: string) {
    setRevBusy(payoutId); setRevErr('');
    const r = await reversePayout(familyId, payoutId);
    setRevBusy('');
    if (!r.ok) { setRevErr(t('没撤成,再试一次。', 'Could not undo — try again.')); return; }
    setConfirmReverse(''); void load();
  }

  if (err && !ledger) return <ErrorRow msg={t('没连上,稍后再试。', 'Could not load — try again.')} onRetry={load} t={t} />;
  if (!ledger) return <LoadingCard label={t('正在读账本…', 'Loading the ledger…')} lines={3} />;

  const history: Array<{ id: string; title: string; date: string; delta: number; payoutId?: string }> = [
    ...ledger.approved.map((c) => ({ id: c.id, title: choreTitle(c, t), date: c.approvedAt?.slice(0, 10) ?? c.dueDate, delta: c.value })),
    ...ledger.payouts.map((p) => ({ id: `p_${p.id}`, title: t('你给了现金 · 从攒的里扣', 'You gave cash · deducted'), date: p.date, delta: -p.amount, payoutId: p.id })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ ...cardStyle, padding: 'var(--space-4)' }}>
        {/* owed<0 = 你给的现金比 TA 挣的还多(多给了),别显示成「欠 -$20」那种迷惑负数。 */}
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{ledger.balance.owed >= 0 ? t('还欠 TA', 'You still owe') : t('已多给 TA', 'You’ve overpaid')}</div>
        <div style={{ fontSize: 'var(--text-display)', fontWeight: 'var(--weight-bold)' as unknown as number, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{money(Math.abs(ledger.balance.owed), dict)}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginTop: 'var(--space-1)' }}>
          {t('审核过的家务往上加 · 你给的现金往下扣', 'Approved chores add up · cash you give deducts')}
        </div>
      </div>

      <StatsSection approved={ledger.approved} dict={dict} t={t} />

      <section>
        <p style={sectLabel}>{t('历史', 'History')}</p>
        <div style={cardStyle}>
          {history.length === 0 && <p style={{ ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{t('还没有记录。', 'Nothing yet.')}</p>}
          {history.map((h, i) => {
            const canUndo = canRecordPayout && !!h.payoutId;   // 只有发薪行、且能记付款的人可撤
            const confirming = confirmReverse === h.payoutId;
            return (
              <div key={h.id} style={{ ...rowStyle, flexWrap: 'wrap', borderBottom: i === history.length - 1 ? 'none' : rowStyle.borderBottom }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-body)' }}>{h.title}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{h.date}</div>
                </div>
                <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, color: h.delta >= 0 ? 'var(--status-go)' : 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {h.delta >= 0 ? '+' : '−'}{money(Math.abs(h.delta), dict)}
                </span>
                {canUndo && !confirming && (
                  <button type="button" onClick={() => { setConfirmReverse(h.payoutId!); setRevErr(''); }}
                    style={{ border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: 'var(--space-1)', whiteSpace: 'nowrap' }}>
                    {t('记错了?撤这笔', 'Undo')}
                  </button>
                )}
                {canUndo && confirming && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', width: '100%', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('撤掉这笔发薪?TA 攒的会加回去。', 'Undo this payout? It goes back to their savings.')}</span>
                    {revErr && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-xs)' }}>{revErr}</span>}
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button type="button" onClick={() => void reverse(h.payoutId!)} disabled={revBusy === h.payoutId}
                        style={{ ...ghostBtn, color: 'var(--status-risk)' }}>{revBusy === h.payoutId ? t('撤销中…', 'Undoing…') : t('撤掉', 'Undo it')}</button>
                      <button type="button" onClick={() => { setConfirmReverse(''); setRevErr(''); }} style={ghostBtn}>{t('先不', 'Not now')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
