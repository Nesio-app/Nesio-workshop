'use client';

/**
 * SchedulePanel — 洞察「日程」tab(原「会议」扩展)。两个子 tab:
 *   ① 日历项:所有日历日程(source=calendar)+ 未挂到日历的独立会议记录(meeting-notes),
 *      按时间排;挂了会议记录的日程标「有记录」,点进对应记忆。保留原会议记录闭环。
 *   ② 邮件:source=email 的节点(广告在 gmail 抽取阶段已排除 —— CATEGORY_PROMOTIONS 不进 AI);
 *      这里再加一层关键词兜底,过滤明显促销。
 * 只读 life-graph。2026-07-28 按标注 图29 收紧:日历项由近到远、只留有具体时间的真事、
 * 点条目直接开这条记忆的详情(不再跳到记忆页让你自己找)。随同步/记录事件自动刷新。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLifeGraph, deleteLifeNode, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';

const MemoryNodeDetail = dynamic(() => import('../MemoryNodeDetail'), { ssr: false });
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type SubTab = 'calendar' | 'email';

interface Row {
  id: string;
  title: string;
  dateIso: string;
  meta: string;       // 副行(地点/来源/收件人等)
  badge?: string;     // 「有记录」/「会议记录」
  query: string;      // 兜底:详情打不开时按原话去记忆页搜
  node: LifeNode;     // 图29:点一下直接开这条记忆的详情
}

const AD_RE = /退订|unsubscribe|优惠|促销|限时|折扣|秒杀|大促|% ?off|sale\b|coupon|deal[s]?\b/i;

/**
 * 邮件子 tab 的取舍(2026-07-28,用户标注 图1)。原话:
 *「只显示重要邮件,个人邮箱发送的有具体内容的、不是商业广告的,学校的通知,
 *  订购旅行信息机票酒店景点订单;不显示于银行交易信息,不显示开会通知信息。」
 *
 * 做法是**两级白名单**,不是一条黑名单:
 *   ① 先毙掉明确不要的:银行流水提醒 / 会议邀请回执 / 广告;
 *   ② 剩下的里,活人发来的(发件地址不像机器人)默认留;
 *      机器发的只留「有具体内容」的那几类:订单物流、机票行程、酒店预订、票务、学校通知。
 * 纯本地正则,零 AI。误杀了往 KEEP_RE 里加词即可。
 */
const BANK_TX_RE = new RegExp([
  '交易提醒|入账|出账|扣款|消费提醒|余额变动|尾号\\s*\\d{4}|信用卡账单',
  'you made a .{0,12}(transaction|transfer)|debit card|credit card (was|has been)',
  'transaction alert|payment (posted|received|sent)|deposit (of|posted)|withdraw(al)?',
  'alerts?@|no\\.?reply\\.alerts',
].join('|'), 'i');

const MEETING_INVITE_RE = new RegExp([
  '会议邀请|邀请你参加|已接受邀请|已拒绝邀请|日程邀请|更新的邀请',
  'invitation:|invited you to|has (accepted|declined)|updated invitation',
  'calendar-notification|zoom\\.us/j/|teams\\.microsoft\\.com/l/meetup',
].join('|'), 'i');

/** 机器发的也值得留的「有具体内容」类目:订单物流 / 旅行 / 票务 / 学校。 */
const KEEP_RE = new RegExp([
  '订单|已发货|发货|快递|物流|运单|签收|退款|订购',
  'order(ed)?|shipped|shipment|tracking|delivered|package|refund',
  '机票|航班|值机|登机|行程单|行程|改签',
  'flight|itinerary|boarding|check-?in|e-?ticket|reservation|booking|confirmation',
  '酒店|入住|退房|民宿|景点|门票|演出|展览',
  'hotel|check-?out|attraction|admission|ticket',
  '学校|老师|班级|家长|家长会|作业|课表|开学|放假|校车',
  'school|teacher|classroom|principal|district|parent|homework|semester|pta\\b',
].join('|'), 'i');

/** 发件地址像不像机器人(no-reply / 通知 / 自动确认)。 */
const ROBOT_FROM_RE = /no-?reply|donot-?reply|auto-?(confirm|reply|notif)|notification|mailer|bounce|postmaster|alerts?@|newsletter/i;

/** 星标 = 节点上的一个标签(复用全 app 的标签体系,不另起存储)。 */
const STAR_TAG = '星标';

/**
 * 日程里不该出现的「不是具体事情」的条目(2026-07-28,用户标注 图29:
 *「应该只出现有具体事情的,周期提醒、还款、缴费、课程、家务项目不显示」)。
 *
 * 这些多半是从待办 App(滴答清单等)当日历同步进来的循环任务 —— 它们是 checklist,
 * 不是「几点要去哪儿见谁」。日历项里混着它们,真正要赴的约会就被淹掉了。
 * 启发式关键词,宁可漏放几条也别误杀真日程;发现漏网的往这里加。
 */
const CHORE_RE = new RegExp([
  // 还款 / 缴费 / 账单
  '还款|缴费|账单|信用卡|房租|水电|燃气|物业|保险|续费|自动扣款|订阅',
  'bill|payment|due|autopay|rent|invoice|insurance|renew(al)?|subscription',
  // 家务
  '家务|打扫|清洁|洗碗|洗衣|倒垃圾|换床单|拖地|吸尘|除螨|浇花|遛狗|喂猫',
  'clean|laundry|wash|vacuum|trash|garbage|dishes|chore|tidy|declutter',
  // 课程 / 周期提醒
  '课程|上课|打卡|每日|每周|每月|定期|周期|提醒',
  'class\\b|lesson|course|daily|weekly|monthly|recurring|reminder|routine|habit',
].join('|'), 'i');

function stripPrefix(name: string): string {
  return name.replace(/^(会议记录|Meeting notes)\s*·\s*/, '').trim() || name;
}

/**
 * SwipeRow — 一条日程/邮件。2026-07-28 按标注 图1 加左右滑:
 *   右滑(往右拖)= 星标,左滑 = 删除。跟手位移,松手过阈值才执行,没过就弹回去。
 * 只认横向手势:纵向位移更大时立刻放手,免得把页面滚动吃掉。
 */
function SwipeRow({ row, dict, starred, dateLabel, onOpen, onStar, onDelete }: {
  row: Row; dict: 'zh' | 'en'; starred: boolean; dateLabel: string;
  onOpen: () => void; onStar: () => void; onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; lock: 'none' | 'x' | 'y' } | null>(null);
  const THRESHOLD = 72;

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, lock: 'none' };
  };
  const onMove = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const mx = e.clientX - st.x;
    const my = e.clientY - st.y;
    if (st.lock === 'none') {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      st.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (st.lock === 'y') { start.current = null; setDx(0); return; }  // 纵向:让页面滚
    }
    setDx(Math.max(-140, Math.min(140, mx)));
  };
  const onUp = () => {
    const moved = dx;
    start.current = null;
    setDx(0);
    if (moved <= -THRESHOLD) onDelete();
    else if (moved >= THRESHOLD) onStar();
    else if (Math.abs(moved) < 6) onOpen();
  };

  const revealing = dx > 0
    ? { side: 'star' as const, label: starred ? L(dict, '取消星标', 'Unstar') : L(dict, '★ 星标', '★ Star'), bg: 'var(--status-gentle-soft)', fg: 'var(--status-gentle)' }
    : { side: 'del' as const, label: L(dict, '删除', 'Delete'), bg: 'var(--status-risk-soft)', fg: 'var(--status-risk)' };

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', touchAction: 'pan-y' }}>
      {dx !== 0 && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: revealing.side === 'star' ? 'flex-start' : 'flex-end',
          padding: '0 var(--space-4)', background: revealing.bg, color: revealing.fg,
          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
        }}>{revealing.label}</div>
      )}
      <button type="button"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: 'relative', display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
          border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
          background: 'var(--glass-bg-solid, var(--portal-bg))', padding: 'var(--space-3) var(--space-4)',
          transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform .18s var(--ease-out, ease)' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {starred && <span style={{ color: 'var(--status-gentle)', marginRight: 4 }}>★</span>}{row.title}
          </span>
          <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{dateLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {row.meta && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{row.meta}</span>}
          {row.badge && (
            <span style={{ fontSize: 'var(--text-xs)', padding: '0.05rem 0.45rem', borderRadius: 'var(--radius-pill)', background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{row.badge}</span>
          )}
        </div>
      </button>
    </div>
  );
}

// 图29 之后不再需要 onOpenMemory —— 点条目就地开详情,不跳记忆页。
export default function SchedulePanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [sub, setSub] = useState<SubTab>('calendar');
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  // 图29「点击应该直接进入对应记忆,而不是记忆页」:就地开这条记忆的详情。
  const [openNode, setOpenNode] = useState<LifeNode | null>(null);
  // 图1「增加左滑右滑动作,删除和星标」:右滑加星、左滑删掉这条。
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());

  useEffect(() => {
    setStarred(new Set(nodes.filter((n) => (n.tags || []).includes(STAR_TAG)).map((n) => n.id)));
  }, [nodes]);

  /** 星标落在节点标签上(和全 app 的标签同一套),不另起一份存储。 */
  const toggleStar = (r: Row) => {
    const on = starred.has(r.id);
    const tags = (r.node.tags || []).filter((t) => t !== STAR_TAG);
    updateLifeNode(r.id, { tags: on ? tags : [...tags, STAR_TAG] });
    setStarred((prev) => { const next = new Set(prev); if (on) next.delete(r.id); else next.add(r.id); return next; });
  };

  /** 删除是真删这条记忆节点 —— 先本地隐藏,写失败(返回 false)就放回来,不假装成功。 */
  const removeRow = (r: Row) => {
    setGone((prev) => new Set(prev).add(r.id));
    if (!deleteLifeNode(r.id)) {
      setGone((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
    }
  };

  useEffect(() => {
    const load = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    window.addEventListener('nesio-calendar-updated', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
      window.removeEventListener('nesio-calendar-updated', load);
    };
  }, []);

  const calendarRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    // 图29「排序应该由近到远」:今天 0 点以后的先按时间正序排;更早的(已经过去的)排在后面、倒序。
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    for (const n of nodes) {
      const a = n.attributes || {};
      if (n.source === 'calendar') {
        const start = typeof a.start === 'string' ? a.start : n.createdAt;
        // 图29「全天日历不显示」:allDay 标记,或 start 只有日期没有时刻(YYYY-MM-DD)。
        const allDay = a.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(start.trim());
        if (allDay) continue;
        // 图29「只出现有具体事情的」:循环提醒 / 还款缴费 / 课程 / 家务不进日程。
        if (CHORE_RE.test(n.name)) continue;
        out.push({
          id: n.id,
          title: n.name,
          dateIso: start,
          meta: typeof a.location === 'string' && a.location ? a.location : (typeof a.calendarName === 'string' ? a.calendarName : ''),
          badge: a.meetingRecordId ? L(dict, '有记录', 'notes') : undefined,
          query: n.name,
          node: n,
        });
      } else if ((n.tags || []).includes('meeting-notes') && !a.calendarNodeId) {
        // 未挂到日历的独立会议记录(Granola/录音)也留在日程里
        out.push({
          id: n.id,
          title: stripPrefix(n.name),
          dateIso: typeof a.recordedAt === 'string' ? a.recordedAt : n.createdAt,
          meta: (n.tags || []).includes('Granola') ? 'Granola' : L(dict, '录音', 'Recording'),
          badge: L(dict, '会议记录', 'meeting'),
          query: stripPrefix(n.name),
          node: n,
        });
      }
    }
    const t0 = todayStart.getTime();
    const ms = (r: Row) => { const v = new Date(r.dateIso).getTime(); return Number.isNaN(v) ? 0 : v; };
    const upcoming = out.filter((r) => ms(r) >= t0).sort((x, y) => ms(x) - ms(y));   // 近 → 远
    const past = out.filter((r) => ms(r) < t0).sort((x, y) => ms(y) - ms(x));        // 刚过去的先
    return [...upcoming, ...past];
  }, [nodes, dict]);

  const emailRows = useMemo<Row[]>(() => {
    return nodes
      .filter((n) => n.source === 'email')
      .filter((n) => {
        const a = n.attributes || {};
        const from = `${typeof a.from === 'string' ? a.from : ''} ${typeof a.sender === 'string' ? a.sender : ''}`;
        const body = typeof n.rawInput === 'string' ? n.rawInput : '';
        const hay = `${n.name} ${from} ${body}`;
        if (AD_RE.test(hay)) return false;              // ① 广告
        if (BANK_TX_RE.test(hay)) return false;          // ① 银行流水提醒
        if (MEETING_INVITE_RE.test(hay)) return false;   // ① 开会通知/邀请回执
        if (!ROBOT_FROM_RE.test(from)) return true;      // ② 活人发的,留
        return KEEP_RE.test(hay);                        // ② 机器发的,只留订单/旅行/票务/学校
      })
      .map((n) => {
        const a = n.attributes || {};
        return {
          id: n.id,
          title: n.name,
          dateIso: typeof a.date === 'string' ? a.date : n.createdAt,
          meta: typeof a.from === 'string' ? a.from : (typeof a.sender === 'string' ? a.sender : ''),
          query: n.name,
          node: n,
        } as Row;
      })
      .sort((x, y) => (x.dateIso < y.dateIso ? 1 : x.dateIso > y.dateIso ? -1 : 0));
  }, [nodes]);

  const rows = (sub === 'calendar' ? calendarRows : emailRows).filter((r) => !gone.has(r.id));

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const chip = (id: SubTab, label: string) => (
    <button type="button"
      className={`nesio-settings-option${sub === id ? ' nesio-settings-option--active' : ''}`}
      style={{ flex: 1, justifyContent: 'center' }}
      onClick={() => setSub(id)}>
      <span className="nesio-settings-option-label">{label}</span>
    </button>
  );

  return (
    <div className="nesio-analytics-tab">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 'var(--space-3)' }}>
        {chip('calendar', L(dict, `日历项 ${calendarRows.length}`, `Calendar ${calendarRows.length}`))}
        {chip('email', L(dict, `邮件 ${emailRows.length}`, `Mail ${emailRows.length}`))}
      </div>

      {rows.length === 0 ? (
        <p className="nesio-insights-empty">
          {sub === 'calendar'
            ? L(dict, '还没有日程 —— 到「设置 → 数据接入」连 Google 日历,或连 Granola 同步会议。', 'No schedule yet — connect Google Calendar or Granola in Data sources.')
            : L(dict, '还没有邮件 —— 到「设置 → 数据接入」连 Gmail 同步(广告已自动过滤)。', 'No mail yet — connect Gmail in Data sources (ads auto-filtered).')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rows.slice(0, 60).map((r) => (
            <SwipeRow key={r.id} row={r} dict={dict} starred={starred.has(r.id)} dateLabel={fmtDay(r.dateIso)}
              onOpen={() => setOpenNode(r.node)} onStar={() => toggleStar(r)} onDelete={() => removeRow(r)} />
          ))}
        </div>
      )}

      {/* elevated:日程在洞察(fullscreen,z-930)里,详情是 bottom 卡 —— 不抬层会被整个盖住。 */}
      {openNode && <MemoryNodeDetail node={openNode} elevated onClose={() => setOpenNode(null)} />}
    </div>
  );
}
