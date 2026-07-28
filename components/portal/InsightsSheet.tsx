'use client';

/**
 * InsightsSheet — v1 规格 §2:洞察页(个人数据 = 编辑过的刊物,不是监控台)。
 *
 * 免费层四件套(全本地统计、无 AI、批量导入不计入):
 *   ① 你在想什么(主题门)  ② 没接上的线头  ③ 走走看  ④ 一行节律
 * 生命版图 = 唯一保留的图(≥90 天数据才出现,绝不以示例地形冒充)。
 * 认知 tab = Pro 多面镜月度信(只回看不预测);旧 7 层模型 + 节点图移 Lab。
 * 健康/足迹/财务/关系 tab 走功能开关(提审构建不可达)。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeatureEnabled } from '@/components/portal/use-feature-flag';
import { computeTerritory } from '@/lib/portal/life-territory';
import { getLifeGraph, isBulkImported } from '@/lib/portal/life-graph';
import type { LifeNode } from '@/lib/portal/life-graph';
import { markFeatureUsed } from '@/lib/portal/feature-usage';
import { isLabModeOn, LAB_MODE_EVENT } from '@/lib/portal/module-overrides';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { InfoTip } from './InfoTip';
import {
  IconRefresh, IconTrendingUp, IconMail, IconCalendar, IconCamera, IconMic, IconNote, IconDownload, IconAlertTriangle, IconBookmark,
  IconBulb, IconTarget, IconPlay, IconHeartPulse, IconActivity, IconMapPin, IconCard, IconBox, IconUser, IconCar, IconMirror,
  IconGear, IconPeople, IconUtensils,
} from './icons';
import TimelineTab from './insights/TimelineTab';
import GrowthTab from './insights/GrowthTab';
import MontageTab from './insights/MontageTab';
import MirrorLetterTab from './insights/MirrorLetterTab';
import FinanceTab from './finance/FinanceTab';
import HealthDashboard from './health/HealthDashboard';
import TrainingPlan from './health/TrainingPlan';
import RelationshipsPanel from './relationships/RelationshipsPanel';
import SchedulePanel from './insights/SchedulePanel';
import InventoryStatsPanel from './insights/InventoryStatsPanel';
import WardrobePanel from './insights/WardrobePanel';
import AdminOpsPanel from './insights/AdminOpsPanel';
import TeslaPanel from './TeslaPanel';
import TabErrorBoundary from './TabErrorBoundary';
import LearningStatusPanel from './LearningStatusPanel';
import { mineCrossDomain } from '@/lib/portal/cross-domain-correlations';
import { readFactJournal, ensureFactJournal } from '@/lib/platform/fact-journal';

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = 'reflection' | 'growth' | 'montage' | 'health' | 'fitness' | 'timeline' | 'schedule' | 'finance' | 'inventory' | 'wardrobe' | 'relationships' | 'tesla' | 'living' | 'admin';

const DAY_MS = 86_400_000;

/** 系统标记(normalizer 系统标 / 导入标),不是主题,永不成门。 */
const SYSTEM_TAGS = new Set(['联系人', '手动记录', '月报', 'Voice', '手写']);


// ── Widget: 节律热力图(周×星期,记录密度)────────────────────────────────

function RhythmHeatmap({ nodes, compact = false }: { nodes: LifeNode[]; compact?: boolean }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const WEEKS = 10;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const thisWeekStart = new Date(now.getTime() - now.getDay() * DAY_MS); // 本周日 0 点
  const gridStart = new Date(thisWeekStart.getTime() - (WEEKS - 1) * 7 * DAY_MS);
  // grid[dow][week]
  const grid: number[][] = Array.from({ length: 7 }, () => Array(WEEKS).fill(0));
  for (const n of nodes) {
    const t = new Date(n.createdAt).getTime();
    if (Number.isNaN(t) || t < gridStart.getTime()) continue;
    const col = Math.floor((t - gridStart.getTime()) / (7 * DAY_MS));
    if (col < 0 || col >= WEEKS) continue;
    grid[new Date(t).getDay()][col] += 1;
  }
  const max = Math.max(1, ...grid.flat());
  const dowLabels = dict === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['日', '一', '二', '三', '四', '五', '六'];
  const cellColor = (c: number) => (c === 0 ? 'var(--portal-surface-2, rgba(127,127,127,0.08))' : `color-mix(in srgb, var(--portal-blue-deep) ${Math.round(22 + 68 * (c / max))}%, transparent)`);
  return (
    <div className={`nesio-rhythm-heat${compact ? ' nesio-rhythm-heat--compact' : ''}`} role="img" aria-label={L(dict, '记录节律热力图', 'Capture rhythm heatmap')}>
      {grid.map((row, dow) => (
        <div key={dow} className="nesio-rhythm-heat-row">
          {!compact && <span className="nesio-rhythm-heat-dow">{dowLabels[dow]}</span>}
          {row.map((c, wi) => (
            <span key={wi} className="nesio-rhythm-heat-cell" style={{ background: cellColor(c) }}
              title={c > 0 ? L(dict, `${c} 条`, `${c}`) : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}

// 图5:「反复在想」的类别占比 —— 可交互甜甜圈(对齐足迹地点饼图形态)。
// 无标题/无图例;每片扇形内嵌来源符号 + 次数,点扇形高亮 + 中心出详情可进记忆。
const MIND_PIE_COLORS = ['var(--portal-blue-deep)', 'var(--status-gentle)', 'var(--status-go)', 'var(--status-calm)', 'var(--portal-cool-accent)', 'var(--status-risk)'];
// 门标签 → 记忆来源符号(与记忆卡来源图标一致);非来源标签回落书签图标
function mindIcon(label: string): ReactNode {
  const sz = 14;
  switch (label) {
    case '邮件': return <IconMail size={sz} />;
    case '日历': return <IconCalendar size={sz} />;
    case '照片': return <IconCamera size={sz} />;
    case '语音': return <IconMic size={sz} />;
    case '手记': return <IconNote size={sz} />;
    case '通知': return <IconAlertTriangle size={sz} />;
    case '导入': return <IconDownload size={sz} />;
    default: return <IconBookmark size={sz} />;
  }
}
function mindPolar(cx: number, cy: number, r: number, angDeg: number): [number, number] {
  const a = ((angDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function mindSeg(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = mindPolar(cx, cy, rO, a0);
  const [x1, y1] = mindPolar(cx, cy, rO, a1);
  const [x2, y2] = mindPolar(cx, cy, rI, a1);
  const [x3, y3] = mindPolar(cx, cy, rI, a0);
  return `M${x0} ${y0} A${rO} ${rO} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rI} ${rI} 0 ${large} 0 ${x3} ${y3} Z`;
}
function MindPie({ items, onPick, dict }: { items: Array<[string, number]>; onPick: (tag: string) => void; dict: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const top = items.slice(0, 6);
  const total = top.reduce((s, [, c]) => s + c, 0) || 1;
  let acc = 0;
  const arcs = top.map(([tag, c], i) => {
    const a0 = (acc / total) * 360;
    acc += c;
    const a1 = (acc / total) * 360;
    return { tag, c, i, a0, a1, mid: (a0 + a1) / 2 };
  });
  const selArc = sel ? arcs.find((a) => a.tag === sel) ?? null : null;
  return (
    <div className="nesio-mindpie2wrap" onClick={() => setSel(null)}>
      <div className="nesio-mindpie2">
        <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={L(dict, '反复在想的类别占比(点扇形看详情)', 'What is on your mind, by share (tap a slice)')}>
          {arcs.map(({ tag, i, a0, a1 }) => {
            const dim = sel != null && sel !== tag;
            return (
              <path key={tag} d={mindSeg(50, 50, 44, 27, a0, Math.max(a0 + 0.5, a1))}
                fill={MIND_PIE_COLORS[i % MIND_PIE_COLORS.length]} opacity={dim ? 0.32 : 1}
                stroke="var(--sheet-opaque, #fff)" strokeWidth="0.8"
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setSel(sel === tag ? null : tag); }} />
            );
          })}
        </svg>
        {/* 符号 + 次数嵌在扇形里(占比≥7% 才放得下);HTML 叠层,不吃点击 */}
        {arcs.filter(({ c }) => c / total >= 0.07).map(({ tag, c, mid }) => {
          const [lx, ly] = mindPolar(50, 50, 35.5, mid);
          const dim = sel != null && sel !== tag;
          return (
            <div key={tag} className="nesio-mindpie2-slice" style={{ left: `${lx}%`, top: `${ly}%`, opacity: dim ? 0.35 : 1 }}>
              {mindIcon(tag)}<span className="nesio-mindpie2-cnt">{c}</span>
            </div>
          );
        })}
        <div className="nesio-mindpie2-ctr" aria-live="polite">
          {selArc ? (
            <button type="button" className="nesio-mindpie2-open" onClick={(e) => { e.stopPropagation(); onPick(selArc.tag); }}>
              <b>{selArc.c}</b>
              <small className="nesio-mindpie2-ctr-name">{selArc.tag}</small>
              <small className="nesio-mindpie2-go">{L(dict, '查看记忆 ›', 'View ›')}</small>
            </button>
          ) : (
            <>
              <b>{total}</b>
              <small>{L(dict, '次', 'times')}</small>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InsightsSheet({ onClose, canUsePrivateData = false, initialTab }: { onClose: () => void; canUsePrivateData?: boolean; initialTab?: MainTab }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [mainTab, setMainTab] = useState<MainTab>(initialTab ?? 'reflection');
  // 洞察改版:首页是入口宫格(showHub),点卡进板块;有 initialTab(深链)时直达板块。
  const [showHub, setShowHub] = useState(!initialTab);
  const tabLabel = (t: MainTab): string =>
    t === 'reflection' ? L(dict, '洞察', 'Insights')
      : t === 'growth' ? L(dict, '成长', 'Growth')
      : t === 'montage' ? L(dict, '剧场', 'Films')
      : t === 'health' ? L(dict, '健康', 'Health')
      : t === 'fitness' ? L(dict, '健身', 'Fitness')
      : t === 'timeline' ? L(dict, '足迹', 'Places')
      : t === 'finance' ? L(dict, '财务', 'Finance')
      : t === 'relationships' ? L(dict, '关系', 'People')
      : t === 'schedule' ? L(dict, '日程', 'Schedule')
      : t === 'inventory' ? L(dict, '物品', 'Items')
      : t === 'wardrobe' ? L(dict, '衣橱', 'Wardrobe')
      : t === 'tesla' ? L(dict, '车', 'Car')
      : t === 'admin' ? L(dict, '运营', 'Ops')
      : L(dict, '镜子', 'Mirror');
  const tabIcon = (t: MainTab): ReactNode => {
    switch (t) {
      case 'reflection': return <IconBulb />;
      case 'growth': return <IconTarget />;
      case 'montage': return <IconPlay />;
      case 'health': return <IconHeartPulse />;
      case 'fitness': return <IconActivity />;
      case 'timeline': return <IconMapPin />;
      case 'schedule': return <IconCalendar />;
      case 'finance': return <IconCard />;
      case 'inventory': return <IconBox />;
      case 'wardrobe': return <IconBookmark />;
      case 'relationships': return <IconUser />;
      case 'tesla': return <IconCar />;
      case 'living': return <IconMirror />;
      case 'admin': return <IconGear />;
      default: return <IconNote />;
    }
  };
  const showPlaces = useFeatureEnabled('places');
  const showExperiment = useFeatureEnabled('experiment');
  const showHealth = useFeatureEnabled('health');
  const showFinance = useFeatureEnabled('finance');
  const showPeople = useFeatureEnabled('people');
  // 此前这几张 tile 恒 true(无开关),用户「功能开关中心全关了还看得到」的真因 —— 现逐个接开关。
  const showInventory = useFeatureEnabled('inventory');
  const showSchedule = useFeatureEnabled('plan');
  const showGrowth = useFeatureEnabled('growth');
  const showMontage = useFeatureEnabled('montage');
  const showWardrobe = useFeatureEnabled('wardrobe');
  const showTesla = useFeatureEnabled('tesla');
  const showLiving = useFeatureEnabled('living');
  const showCooking = useFeatureEnabled('cooking');
  const tabEnabled = (t: MainTab): boolean =>
    t === 'timeline' ? showPlaces
      : t === 'health' ? showHealth
      : t === 'fitness' ? showHealth
      : t === 'finance' ? showFinance
      : t === 'relationships' ? showPeople
      : t === 'admin' ? showExperiment // 运营后台:仅 Lab(owner)可见,数据再由管理密钥二次门控
      : t === 'inventory' ? showInventory
      : t === 'schedule' ? showSchedule
      : t === 'growth' ? showGrowth
      : t === 'montage' ? showMontage
      : t === 'wardrobe' ? showWardrobe
      : t === 'tesla' ? showTesla
      : t === 'living' ? showLiving
      : true; // 'reflection'(洞察)= 核心,永远在
  useEffect(() => { if (!tabEnabled(mainTab)) setMainTab('reflection'); }, [showPlaces, showHealth, showFinance, showPeople, showInventory, showSchedule, showGrowth, showMontage, showWardrobe, showTesla, showLiving, mainTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const [allNodes, setAllNodes] = useState<LifeNode[]>([]);
  const [labOn, setLabOn] = useState(false);
  const [wanderSeed, setWanderSeed] = useState(() => Math.floor(Math.random() * 100_000));

  // 打开洞察即视为「用过洞察」,回访再触达提醒不再叨扰这一项(仅登录态记)
  useEffect(() => { if (canUsePrivateData) markFeatureUsed('insights'); }, [canUsePrivateData]);

  useEffect(() => {
    // 私据门:非私有运行态不把私人记录读进内存(纵深防御,配合下方 fail-closed 渲染门)
    if (!canUsePrivateData) { setAllNodes([]); return; }
    setAllNodes(getLifeGraph());
  }, [canUsePrivateData]);

  useEffect(() => {
    const sync = () => setLabOn(isLabModeOn());
    sync();
    window.addEventListener(LAB_MODE_EVENT, sync);
    return () => window.removeEventListener(LAB_MODE_EVENT, sync);
  }, []);

  // 免费四件套 + 生命版图的口径:剔除批量导入(通讯录/系统报告),只统计亲手记的
  const realNodes = useMemo(() => allNodes.filter((n) => !isBulkImported(n)), [allNodes]);

  // ① 主题门:近 30 天同标签 ≥3 条 → 一扇门(与详情页 L3 门同判据;真聚类挂账)
  const doors = useMemo(() => {
    const since = Date.now() - 30 * DAY_MS;
    // 批次 80(用户实锤「邮件64/Gmail64 重复计数,分类不全」):
    // ① 标签规范化(Gmail=邮件,Google Calendar=日历),同一节点同类只计一次;
    // ② 来源补全:manual/voice/photo 等每个节点必有 source,类别天然全覆盖。
    const CANON: Record<string, string> = {
      'gmail': '邮件', '邮件': '邮件', 'email': '邮件',
      'google calendar': '日历', 'calendar': '日历', '日历': '日历',
      '通知': '通知', 'notification': '通知',
    };
    const SOURCE_LABEL: Record<string, string> = {
      manual: '手记', voice: '语音', photo: '照片', email: '邮件',
      calendar: '日历', notification: '通知', import: '导入',
    };
    const freq = new Map<string, number>();
    for (const n of realNodes) {
      if (new Date(n.createdAt).getTime() < since) continue;
      const seen = new Set<string>();
      const srcLabel = SOURCE_LABEL[n.source] || '';
      if (srcLabel) seen.add(srcLabel);
      for (const t of n.tags ?? []) {
        if (!t || SYSTEM_TAGS.has(t)) continue;
        seen.add(CANON[t.toLowerCase()] || t);
      }
      for (const k of seen) freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [realNodes]);

  // ② 没接上的线头:>30 天没再碰、没完成的想法/承诺(person/place/健康是实体,不算线头)
  const threads = useMemo(() => {
    const now = Date.now();
    return realNodes
      .filter((n) => {
        if (n.type === 'person' || n.type === 'place' || n.type === 'health_state') return false;
        if (n.attributes?.done === true) return false;
        if (n.lastConfirmedAt && n.lastConfirmedAt !== n.createdAt) return false;
        return (now - new Date(n.createdAt).getTime()) > 30 * DAY_MS;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [realNodes]);

  // ③ 走走看:随机翻一条 + 去年今天
  const wanderNode = useMemo(() => {
    if (!realNodes.length) return null;
    return realNodes[(wanderSeed * 31 + 17) % realNodes.length];
  }, [realNodes, wanderSeed]);
  const yearAgoNode = useMemo(() => {
    const target = Date.now() - 365 * DAY_MS;
    return realNodes.find((n) => Math.abs(new Date(n.createdAt).getTime() - target) <= 3 * DAY_MS) ?? null;
  }, [realNodes]);

  // ④ 一行节律:本月 N 条 · 多在晚上 · 说的比打的多
  const rhythm = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const monthNodes = realNodes.filter((n) => new Date(n.createdAt) >= start);
    const buckets = [
      { key: 'morning', label: '早上', labelEn: 'mornings', count: 0 },
      { key: 'afternoon', label: '下午', labelEn: 'afternoons', count: 0 },
      { key: 'evening', label: '晚上', labelEn: 'evenings', count: 0 },
      { key: 'night', label: '深夜', labelEn: 'late nights', count: 0 },
    ];
    const src = { voice: 0, manual: 0, photo: 0 };
    for (const n of monthNodes) {
      const h = new Date(n.createdAt).getHours();
      if (h >= 5 && h < 12) buckets[0].count++;
      else if (h >= 12 && h < 18) buckets[1].count++;
      else if (h >= 18) buckets[2].count++;
      else buckets[3].count++;
      if (n.source === 'voice') src.voice++;
      else if (n.source === 'photo') src.photo++;
      else if (n.source === 'manual') src.manual++;
    }
    const peak = [...buckets].sort((a, b) => b.count - a.count)[0];
    const parts: string[] = [L(dict, `本月 ${monthNodes.length} 条`, `${monthNodes.length} this month`)];
    if (monthNodes.length >= 5 && peak.count > monthNodes.length / 3) {
      parts.push(L(dict, `多在${peak.label}`, `mostly ${peak.labelEn}`));
    }
    if (src.voice + src.manual >= 5) {
      if (src.voice > src.manual) parts.push(L(dict, '说的比打的多', 'more spoken than typed'));
      else if (src.manual > src.voice) parts.push(L(dict, '打的比说的多', 'more typed than spoken'));
    }
    return { line: parts.join(' · '), count: monthNodes.length };
  }, [realNodes, dict]);

  // 生命版图门槛:≥90 天 + ≥6 条真实记录才出现;绝不以示例地形冒充
  const mapDays = useMemo(() => {
    if (!realNodes.length) return 0;
    const oldest = Math.min(...realNodes.map((n) => new Date(n.createdAt).getTime()));
    return Math.floor((Date.now() - oldest) / DAY_MS);
  }, [realNodes]);
  // 批次 32 用户拍板:门槛 90 → 21 天(与 21 天试用同节奏,试用结束刚好看到自己的版图)
  const mapEligible = realNodes.length >= 6 && mapDays >= 21;
  // 生命版图 = 轻量领土条(设计稿 §2:唯一保留的图,少即是多)——纯本地统计,无 d3
  const territory = useMemo(() => computeTerritory(realNodes), [realNodes]);
  // 批次190:跨域关联 —— 真皮尔逊 r(mood×spend / steps×mood …),固定假设+证据门,非因果。
  const crossDomain = useMemo(() => { try { ensureFactJournal(); return mineCrossDomain(readFactJournal(120)); } catch { return []; } }, []);

  // 门/线头/走走看点进记忆页:关掉本 sheet 再广播(Portal 负责切到记忆面)
  const openInMemory = useCallback((query: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query } }));
  }, [onClose]);

  // 私据门(fail-closed):洞察全部内容都来自你的私人记录(关系/健康/足迹/财务/多面镜/reflection)。
  // 非私有运行态(未登录 / 账户未确认)一律不渲染任何私据 —— 与 TodayFeed/DailyReportCard 同一契约,
  // 补上此前 InsightsSheet 收了 canUsePrivateData 却没用的门(哪怕 Lab 功能,也只给本人看本人)。
  if (!canUsePrivateData) {
    return (
      <div className="nesio-insights-sheet">
        <div className="nesio-insights-header">
          <div className="nesio-insights-title-row">
            <h2 className="nesio-insights-title">{L(dict, '洞察', 'Insights')}</h2>
          </div>
          <button type="button" className="nesio-insights-close" onClick={onClose} aria-label={L(dict, '回到今天', 'Back to Today')}>{L(dict, '今天', 'Today')}</button>
        </div>
        <div className="nesio-insights-body">
          <p className="nesio-insights-empty" style={{ marginTop: '2.5rem' }}>
            {L(dict,
              '登录后,这里只对你显示你自己的洞察 —— 关系、健康、足迹、财务、多面镜都来自你的私人记录,只给本人看。',
              'Sign in to see your own insights here — relationships, health, places, finance and mirror all come from your private records, visible only to you.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="nesio-insights-sheet">
      {/* Header:首页显「洞察」,板块内显返回 + 板块名 */}
      <div className="nesio-insights-header">
        {!showHub && (
          <button type="button" className="nesio-insights-back" onClick={() => setShowHub(true)} aria-label={L(dict, '返回', 'Back')}>‹</button>
        )}
        <div className="nesio-insights-title-row">
          <h2 className="nesio-insights-title">{showHub ? L(dict, '洞察', 'Insights') : tabLabel(mainTab)}</h2>
        </div>
        <button type="button" className="nesio-insights-close" onClick={onClose} aria-label={L(dict, '回到今天', 'Back to Today')}>{L(dict, '今天', 'Today')}</button>
      </div>

      <div className="nesio-insights-body">
        {showHub ? (
          <>
          <div className="nesio-insights-hub">
            {(['reflection', 'growth', 'montage', 'health', 'fitness', 'timeline', 'schedule', 'finance', 'inventory', 'wardrobe', 'relationships', 'tesla', 'living', 'admin'] as MainTab[])
              .filter(tabEnabled)
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  className="nesio-insights-hub-tile"
                  onClick={() => { setMainTab(t); setShowHub(false); }}
                >
                  <span className="nesio-insights-hub-icon" aria-hidden>{tabIcon(t)}</span>
                  <span className="nesio-insights-hub-label">{tabLabel(t)}</span>
                </button>
              ))}
            {/* 家务 / 美味:与宫格同款(图标上、文字下),不再用下方长条卡 */}
            <button
              type="button"
              className="nesio-insights-hub-tile"
              onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-family'))}
            >
              <span className="nesio-insights-hub-icon" aria-hidden><IconPeople /></span>
              <span className="nesio-insights-hub-label">{L(dict, '家务', 'Chores')}</span>
            </button>
            {showCooking && (
              <button
                type="button"
                className="nesio-insights-hub-tile"
                onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-cooking'))}
              >
                <span className="nesio-insights-hub-icon" aria-hidden><IconUtensils /></span>
                <span className="nesio-insights-hub-label">{L(dict, '美味', 'Cooking')}</span>
              </button>
            )}
          </div>
          </>
        ) : (
        <>

        {/* ── Tab 1: 免费四件套(v1 规格 §2.1)── */}
        {mainTab === 'reflection' && (
          <div className="nesio-reflection-tab">
            {/* 2026-07-28 UI 精修(标注 图11「走走看放到最上面」):这块原本排在线头之后,
                现在提到反思页最顶 —— 一进来先撞见一条旧记录,再看统计。 */}
            {/* ③ 走走看:衬线引原话「去年今天,你写下 ——」+ 再翻一条(偶遇感) */}
            {(yearAgoNode || wanderNode) && (() => {
              const node = yearAgoNode ?? wanderNode!;
              const isYearAgo = !!yearAgoNode;
              return (
                <div className="nesio-insights-section">
                  <p className="nesio-insights-section-label">{L(dict, '走走看', 'Wander')}</p>
                  <div className="nesio-wander-card" style={{ padding: '0.9rem', borderRadius: 'var(--radius-md, 16px)', background: 'var(--portal-bg)', border: '1px solid var(--portal-line)' }}>
                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--portal-muted)' }}>
                      {isYearAgo ? L(dict, '去年今天,你写下 ——', 'A year ago today, you wrote —') : L(dict, '翻到一条 ——', 'Turned up —')}
                    </p>
                    <button type="button" onClick={() => openInMemory(node.name)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, margin: '0.45rem 0', cursor: 'pointer' }}>
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: '0.98rem', lineHeight: 1.6, color: 'var(--portal-ink)' }}>「{node.name.slice(0, 60)}」</span>
                    </button>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>
                        {new Date(node.createdAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                      <button type="button" onClick={() => setWanderSeed((s) => s + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--portal-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        <IconRefresh size={13} />{L(dict, '再翻一条', 'Another')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 节律热力图(缩小、无侧栏文字,置顶) */}
            {realNodes.length > 0 && <RhythmHeatmap nodes={realNodes} compact />}

            {/* ① 主题门:反复在想的类别占比(可交互饼图,无标题/图例;点扇形选中,中心可进记忆) */}
            {doors.length > 0 && (
              <div className="nesio-insights-section">
                <MindPie items={doors} onPick={openInMemory} dict={dict} />
              </div>
            )}

            {/* ② 没接上的线头:书名号原话 + 右侧「拾起」轻动作(不催、只递) */}
            {threads.length > 0 && (
              <div className="nesio-insights-section">
                <div className="nesio-insights-section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <p className="nesio-insights-section-label" style={{ margin: 0 }}>{L(dict, '几个没接上的线头', 'A few loose threads')}</p>
                  <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{L(dict, '> 30 天', '> 30 days')}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginTop: '0.55rem' }}>
                  {threads.slice(0, 3).map((t) => {
                    const days = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / DAY_MS);
                    return (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.7rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--portal-ink)', fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>「{t.name.slice(0, 22)}」</p>
                          <p style={{ margin: '0.12rem 0 0', fontSize: '0.7rem', color: 'var(--portal-muted)' }}>{L(dict, `${days} 天前提过,没再碰`, `mentioned ${days}d ago, not since`)}</p>
                        </div>
                        <button type="button" onClick={() => openInMemory(t.name)}
                          style={{ flex: 'none', fontSize: '0.74rem', fontWeight: 600, padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm, 12px)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', cursor: 'pointer' }}>
                          {L(dict, '拾起', 'Pick up')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ④ 节律:一句话 + 迷你周柱(不做大图表) */}
            <div className="nesio-insights-section">
              <div className="nesio-insights-section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p className="nesio-insights-section-label" style={{ margin: 0 }}>{L(dict, '节律', 'Rhythm')}</p>
                <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{L(dict, '本月', 'this month')}</span>
              </div>
              <p className="nesio-rhythm-line" style={{ margin: '0.45rem 0 0' }}>{rhythm.line}</p>
            </div>

            {/* 生命版图:唯一保留的图,移到底部(≥21 天才出现,不满门槛只说实话,不放示例) */}
            <div className="nesio-insights-section">
              <div className="nesio-insights-section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p className="nesio-insights-section-label" style={{ margin: 0 }}>{L(dict, '生命版图', 'Life map')}<InfoTip text={L(dict, '五个领域(关系/事业/成长/健康/自我)按记录的意义密度(置信度+关联数+标签,不是数量)切分领土宽度;下方标出近来占比涨得最多的一域。', 'Five domains (ties/work/growth/health/self) split by meaning density (confidence + connections + tags, not count); below flags the domain whose share grew the most lately.')} /></p>
                <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{L(dict, '意义密度 · 非数量', 'Meaning density · not counts')}</span>
              </div>
              {mapEligible && territory.slices.length ? (
                <>
                  <div className="nesio-territory-bar">
                    {territory.slices.map((s) => (
                      <div
                        key={s.id}
                        className="nesio-territory-terr"
                        style={{ width: `${s.pct}%`, background: `var(${s.cssVar})` }}
                        title={`${L(dict, s.label, s.labelEn)} ${s.pct}%`}
                      >
                        <small>{L(dict, s.label, s.labelEn)}</small>
                        <b>{s.pct}%</b>
                      </div>
                    ))}
                  </div>
                  {territory.shift && (
                    <p className="nesio-territory-note">
                      <IconTrendingUp size={13} />
                      {L(dict, `最近,「${territory.shift.label}」在扩张`, `Lately, "${territory.shift.labelEn}" is expanding`)}
                    </p>
                  )}
                </>
              ) : (
                <p className="nesio-insights-empty">
                  {L(dict, `需要 21 天的记录才能成形 · 已积累 ${mapDays} 天`, `Takes shape after 21 days of notes · ${mapDays} days so far`)}
                </p>
              )}
            </div>

            {/* 批次190:跨域关联 —— 真统计(皮尔逊 r),非 LLM 叙事。数据不足自动不显示,绝不编数字。 */}
            {crossDomain.length > 0 && (
              <div className="nesio-insights-section">
                <div className="nesio-insights-section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <p className="nesio-insights-section-label" style={{ margin: 0 }}>{L(dict, '跨域关联', 'Cross-domain links')}<InfoTip text={L(dict, '在你每日对齐的记录(情绪/花费/步数/睡眠/外出/日程/天气)上算皮尔逊相关,只跑一小组有生活意义的固定假设对,样本≥14 天、|r|≥0.3 才显示。统计相关,非因果。', 'Pearson correlation on your day-aligned records (mood/spend/steps/sleep/outings/schedule/weather); only a small fixed set of meaningful hypotheses, shown when n≥14 and |r|≥0.3. Correlation, not causation.')} /></p>
                  <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{L(dict, '统计相关 · 非因果', 'Correlation · not causation')}</span>
                </div>
                <ul className="nesio-xdom-list">
                  {crossDomain.map((c) => (
                    <li key={c.key} className={`nesio-xdom-item${c.strength === 'strong' ? ' is-strong' : ''}`}>
                      <span className="nesio-xdom-text">{dict === 'en' ? c.insight[1] : c.insight[0]}</span>
                      <span className="nesio-xdom-meta">{L(dict, `样本 ${c.n} 天`, `${c.n} days`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 2026-07-28 UI 精修(标注 图10):「我的实验」整块划掉 —— 常年空态 + 一个没人点的
                「+新建实验」,占了页底一屏。同批划掉页脚那句「全部来自本地统计…」声明。
                实验入口仍在 Lab 里,没删功能,只是不再占洞察页版面。 */}

            {/* NESIO 学到了什么(信任资产,§2.1 移页底) */}
            <LearningStatusPanel />
          </div>
        )}

        {/* ── Tab: Timeline ── */}
        {mainTab === 'timeline' && showPlaces && (
          <div className="nesio-analytics-tab">
            <TimelineTab />
          </div>
        )}

        {/* ── Tab: 成长(引导卡 + 回看流 + 框架书架,v0 规则版零 AI 成本)── */}
        {mainTab === 'growth' && (
          <div className="nesio-analytics-tab">
            <GrowthTab />
          </div>
        )}

        {/* ── Tab: 小剧场(记忆 → 厚涂动漫短片,呈现层;生成在 Lab 端)── */}
        {mainTab === 'montage' && (
          <div className="nesio-analytics-tab">
            <MontageTab />
          </div>
        )}

        {/* ── Tab: Finance ── */}
        {mainTab === 'finance' && showFinance && <FinanceTab />}

        {/* ── Tab: 健康 Dashboard ── */}
        {mainTab === 'health' && showHealth && <HealthDashboard />}
        {mainTab === 'fitness' && showHealth && (
          <TabErrorBoundary label="fitness"><div className="nesio-analytics-tab"><TrainingPlan /></div></TabErrorBoundary>
        )}

        {/* ── Tab: 关系管理 ── */}
        {mainTab === 'relationships' && showPeople && <RelationshipsPanel />}

        {/* ── Tab: 会议(只看会议记录 + 挂没挂到日程,解决「混在一堆里找不着」)── */}
        {mainTab === 'schedule' && <TabErrorBoundary label="schedule"><SchedulePanel /></TabErrorBoundary>}

        {/* ── Tab: 物品(只读统计 dashboard;管理去物品页)── */}
        {mainTab === 'inventory' && <TabErrorBoundary label="inventory"><InventoryStatsPanel /></TabErrorBoundary>}

        {mainTab === 'wardrobe' && <TabErrorBoundary label="wardrobe"><WardrobePanel /></TabErrorBoundary>}

        {mainTab === 'admin' && <TabErrorBoundary label="admin"><AdminOpsPanel /></TabErrorBoundary>}

        {/* ── Tab: 车 · Tesla(常驻入口,便于长期观察数据到没到、去了哪)── */}
        {mainTab === 'tesla' && <div className="nesio-analytics-tab"><TeslaPanel /></div>}

        {/* ── Tab: 认知 = 多面镜月度信(Pro);旧 7 层模型 + 节点图移 Lab ── */}
        {mainTab === 'living' && (
          <>
            <MirrorLetterTab />
            {/* 2026-07-28 UI 精修(标注 图23):「Lab · 旧认知模型(已退役)」整块删掉 ——
                一块只用来公告「这块已经没了」的墓碑,还占着镜子页底部一屏。退役这件事
                在 STATE.md 里记着就够,不必在用户面前立牌子。 */}
          </>
        )}
        </>
        )}

      </div>
    </div>
  );
}
