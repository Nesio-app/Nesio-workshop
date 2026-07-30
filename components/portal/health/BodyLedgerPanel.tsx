'use client';

/**
 * BodyLedgerPanel — 健康页「身体账本」。
 * bug2 批:三个子 tab 删除 —— 今日账本内容直接作为身体账本主体;
 * 餐后血糖 / 稳飙 两块导出给「分析」页渲染;概览的黄卡(补餐提示)与绿卡(念念小结)迁到这里。
 * 美容护理在同页「护理」tab(BeautyCarePanel)。
 */

import { useEffect, useMemo, useState } from 'react';
import type { HealthMetrics } from '@/lib/portal/apple-health';
import {
  buildDayLedger, ledgerPrompt, suggestDinnerForGap, rankFoodReactions,
  goalLabel, setBodyGoalKind, mgDlToDisplay, todayYmd,
  type BodyGoalKind, type BodyLedgerSection, type DinnerSuggestion, type DayLedger,
} from '@/lib/portal/body-ledger';
import { getMeals } from '@/lib/cooking/meals';
import { healthNarrative } from '@/lib/portal/health-narrative';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconPlus } from '../icons';

function ProgressRow({
  label, value, goal, unit,
}: { label: string; value: number; goal: number; unit: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="nesio-bl-prog">
      <div className="nesio-bl-prog-top">
        <span>{label}</span>
        <b>{Math.round(value)} / {goal}{unit}</b>
      </div>
      <div className="nesio-bl-prog-bar" aria-hidden>
        <div className="nesio-bl-prog-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HourlyGlucoseChart({
  hourly, unit, dict,
}: {
  hourly: Array<{ hour: number; avg: number }>;
  unit: string;
  dict: string;
}) {
  if (!hourly.length) {
    return (
      <p className="nesio-trip-footnote">
        {L(dict, '还没有密集血糖曲线 —— 导入 Apple Health 导出后会出现。', 'No dense glucose curve yet — import an Apple Health export.')}
      </p>
    );
  }
  const vals = hourly.map((h) => h.avg);
  const lo = Math.min(...vals) * 0.95;
  const hi = Math.max(...vals) * 1.05;
  const range = hi - lo || 1;
  const W = 100;
  const H = 48;
  const x = (i: number) => (hourly.length > 1 ? (i / (hourly.length - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - lo) / range) * H;
  const pts = hourly.map((h, i) => `${x(i).toFixed(1)},${y(h.avg).toFixed(1)}`);
  const area = `0,${H} ${pts.join(' ')} ${W},${H}`;
  const mealHours = [8, 12, 18];
  return (
    <div className="nesio-bl-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="88" preserveAspectRatio="none">
        <polygon points={area} fill="var(--portal-accent-soft)" opacity="0.9" />
        <polyline points={pts.join(' ')} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {mealHours.map((mh) => {
          const idx = hourly.findIndex((h) => h.hour === mh);
          if (idx < 0) return null;
          return (
            <circle
              key={mh}
              cx={x(idx)}
              cy={y(hourly[idx].avg)}
              r="2.4"
              fill="var(--status-gentle)"
            />
          );
        })}
      </svg>
      <div className="nesio-bl-chart-axis">
        <span>8:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>24:00</span>
      </div>
      <div className="nesio-bl-legend">
        <span><i style={{ background: 'var(--portal-blue-deep)' }} />{L(dict, '血糖(日均)', 'Glucose (avg)')}</span>
        <span><i style={{ background: 'var(--status-gentle)' }} />{L(dict, '常见用餐点', 'Usual meal hours')}</span>
        <span className="nesio-bl-unit">{unit}</span>
      </div>
    </div>
  );
}

function TodayBody({
  ledger, dict, suggestions, suggestErr, onRetrySuggest, onCook, onLogMeal, onGoal,
}: {
  ledger: DayLedger;
  dict: string;
  suggestions: DinnerSuggestion[];
  suggestErr: string | null;
  onRetrySuggest: () => void;
  onCook: (name?: string) => void;
  onLogMeal: () => void;
  onGoal: (g: BodyGoalKind) => void;
}) {
  const zh = dict !== 'en';
  const prompt = ledgerPrompt(ledger, zh);
  return (
    <div className="nesio-bl-section">
      <div className="nesio-bl-goalrow">
        <span>{L(dict, '目标', 'Goal')}</span>
        <div className="nesio-bl-goalchips">
          {(['muscle', 'maintain', 'cut'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`nesio-bl-chip${ledger.goals.goal === g ? ' is-on' : ''}`}
              onClick={() => onGoal(g)}
            >
              {goalLabel(g, zh)}
            </button>
          ))}
        </div>
      </div>

      <div className="nesio-bl-summary">
        <p className="nesio-bl-summary-line">
          {L(dict, '今日', 'Today')} · {goalLabel(ledger.goals.goal, zh)}
          {ledger.trainingMin > 0
            ? L(dict, ` · 已练 ${ledger.trainingMin} 分钟`, ` · trained ${ledger.trainingMin} min`)
            : ''}
        </p>
        <ProgressRow label={L(dict, '蛋白', 'Protein')} value={ledger.protein} goal={ledger.goals.proteinG} unit="g" />
        <ProgressRow label={L(dict, '热量', 'Calories')} value={ledger.energyKCal} goal={ledger.goals.energyKCal} unit=" kcal" />
        {ledger.trainingBonusKCal > 0 && (
          <p className="nesio-trip-footnote">
            {L(dict, `含训练抬高预算 +${ledger.trainingBonusKCal} kcal`, `includes training +${ledger.trainingBonusKCal} kcal`)}
          </p>
        )}
        <ProgressRow label={L(dict, '碳水', 'Carbs')} value={ledger.carbs} goal={ledger.goals.carbsG} unit="g" />
      </div>

      {/* bug3 p38:「蛋白还差约…可从冰箱补一餐」这块琥珀卡挪到「分析」
          (见 BodyLedgerAnalysisCards)—— 账本这一屏只留目标 + 今日进度 + 补餐建议。 */}

      {ledger.proteinGap > 0 && (
        <div className="nesio-bl-dinner">
          <p className="nesio-insights-section-label">{L(dict, '补餐建议 · 补蛋白', 'Dinner idea · refill protein')}</p>
          {suggestErr && (
            <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>
              {L(dict, '菜谱建议没加载上', 'Could not load dinner ideas')}
              <button type="button" className="nesio-trip-link" onClick={onRetrySuggest}>{L(dict, '重试', 'Retry')}</button>
            </p>
          )}
          {!suggestErr && suggestions.length === 0 && (
            <p className="nesio-trip-footnote">
              {L(dict, '库存里暂时对不上能补蛋白的菜 —— 先去美味补库存或记一餐。', 'No matching high-protein dish from pantry — restock or log a meal in Cooking.')}
            </p>
          )}
          <ul className="nesio-bl-dinner-list">
            {suggestions.map((s) => (
              <li key={s.name}>
                <div className="nesio-bl-dinner-card">
                  <div className="nesio-bl-dinner-main">
                    <b>{s.name}</b>
                    <div className="nesio-bl-tags">
                      {s.tags.map((t) => <span key={t} className="nesio-bl-tag">{L(dict, t, t === '库存有' ? 'In stock' : t === '偏蛋白' ? 'Protein-leaning' : '1 missing')}</span>)}
                    </div>
                  </div>
                  <button type="button" className="nesio-bl-go" onClick={() => onCook(s.name)}>
                    {L(dict, '去做', 'Cook')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* bug3 p37:「今日已记」整块删掉(标签 + 去美味记一餐 + 下面那句小字)——
          今日进度那三条已经把「记了多少」说清楚了,再列一遍是重复。 */}
    </div>
  );
}

/**
 * BodyLedgerAnalysisCards — bug3 p38:身体账本顶部那两块小结卡挪来「分析」。
 *   · 念卡(体重/静息心率小结):去掉「念」符号,只留文字
 *   · 琥珀卡(蛋白还差 / 热量预算)
 * 放在分析页顶部:这两块都是「读数解读」,属于分析而不是记账。
 */
export function BodyLedgerAnalysisCards({ health, dict }: { health: HealthMetrics | null; dict: string }) {
  const [ledger, setLedger] = useState<DayLedger>(() => buildDayLedger(todayYmd(), { rings: health?.activityRings }));
  useEffect(() => {
    const reload = () => setLedger(buildDayLedger(todayYmd(), { rings: health?.activityRings }));
    reload();
    window.addEventListener('nesio-life-graph-updated', reload);
    window.addEventListener('nesio-health-updated', reload);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', reload);
      window.removeEventListener('nesio-health-updated', reload);
    };
  }, [health]);

  const lines = health ? healthNarrative(health.metrics, dict).slice(0, 2) : [];
  const prompt = ledgerPrompt(ledger, dict !== 'en');
  if (lines.length === 0 && !prompt) return null;
  return (
    <>
      {lines.length > 0 && (
        // bug3:去掉「念」符号 —— 一句读数小结不需要挂个头像来宣示是谁说的
        <div className="nesio-health-nen">
          <p className="nesio-health-nen-text">{lines.join(' ')}</p>
        </div>
      )}
      {prompt && <div className="nesio-bl-prompt" role="status">{prompt}</div>}
    </>
  );
}

export function PostMealBody({ health, dict }: { health: HealthMetrics | null; dict: string }) {
  const g = health?.glucose;
  const lastMeal = useMemo(() => {
    const meals = getMeals();
    return meals[0] || null;
  }, []);

  return (
    <div className="nesio-bl-section">
      <p className="nesio-bl-lede">
        {L(dict, '餐后血糖 · 模式', 'Post-meal glucose · pattern')}
      </p>
      {lastMeal && (
        <p className="nesio-trip-footnote">
          {L(dict, `最近一餐:${lastMeal.items.map((i) => i.name).filter(Boolean).slice(0, 2).join(' · ') || '一餐'} · ${lastMeal.occurredAt}`,
            `Latest meal: ${lastMeal.items.map((i) => i.name).filter(Boolean).slice(0, 2).join(' · ') || 'meal'} · ${lastMeal.occurredAt}`)}
        </p>
      )}
      {g ? (
        <>
          <div className="nesio-bl-stats">
            <div><small>{L(dict, '平均', 'Avg')}</small><b>{g.avg}</b><span>{g.unit}</span></div>
            <div><small>{L(dict, '90 天最高', '90d high')}</small><b>{g.max}</b><span>{g.unit}</span></div>
            <div><small>TIR</small><b>{g.tirPct}%</b><span /></div>
          </div>
          <HourlyGlucoseChart hourly={g.hourly} unit={g.unit} dict={dict} />
          <div className="nesio-bl-prompt nesio-bl-prompt--calm">
            {L(dict,
              '这是全天各小时的平均曲线,橙色点是常见用餐时段 —— 仍在学习你的身体,先当模式看,别急着下结论。',
              'Hourly averages across days; amber dots mark usual meal hours — still learning; treat as a pattern, not a verdict.')}
          </div>
        </>
      ) : (
        <p className="nesio-trip-footnote">
          {L(dict, '导入含血糖的 Apple Health 导出后,这里会叠上用餐时段。', 'After importing Apple Health with glucose, meal hours overlay here.')}
        </p>
      )}
    </div>
  );
}

// bug3 p40:ReactionBody(「哪些让你稳 / 飙」整块)删除 —— 内容并进了分析页的「健康提示」,
// 用同一种行样式渲染(见 HealthDashboard 的 FindingsCard),不再是单独一屏排行榜。

export default function BodyLedgerPanel({
  health, onRecord, onScan,
}: {
  health: HealthMetrics | null;
  /** bug2:子 tab 已删,保留签名兼容旧调用点。 */
  initialSection?: BodyLedgerSection;
  /** bug3 p41:「记一条」从概览挪来这里 —— 打开手填那张表。 */
  onRecord?: () => void;
  /** bug3 p41:加号 —— 打开拍化验单(里面既能上传 PDF/图片,也能端上智能拍照)。 */
  onScan?: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [ledger, setLedger] = useState<DayLedger>(() => buildDayLedger(todayYmd(), { rings: health?.activityRings }));
  const [suggestions, setSuggestions] = useState<DinnerSuggestion[]>([]);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggestTick, setSuggestTick] = useState(0);

  function reloadLedger(goal?: BodyGoalKind) {
    if (goal) setBodyGoalKind(goal);
    setLedger(buildDayLedger(todayYmd(), { rings: health?.activityRings }));
  }

  useEffect(() => {
    reloadLedger();
    const onLife = () => reloadLedger();
    window.addEventListener('nesio-life-graph-updated', onLife);
    window.addEventListener('nesio-health-updated', onLife);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', onLife);
      window.removeEventListener('nesio-health-updated', onLife);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  useEffect(() => {
    let cancelled = false;
    setSuggestErr(null);
    void suggestDinnerForGap(ledger.proteinGap).then((r) => {
      if (cancelled) return;
      if (r.error) {
        setSuggestErr(r.error);
        setSuggestions([]);
        return;
      }
      setSuggestions(r.suggestions);
    });
    return () => { cancelled = true; };
  }, [ledger.proteinGap, suggestTick]);

  function openCooking() {
    window.dispatchEvent(new CustomEvent('nesio-open-cooking'));
  }

  // bug2 把概览的念卡迁到了身体账本;bug3 p38 又往前挪一层 —— 现在它和琥珀卡
  // 一起由 BodyLedgerAnalysisCards 渲染在「分析」页,这一屏只剩账本本体。
  return (
    <div className="nesio-body-ledger">
      {/* bug3 p41:只留一个「记一条」+ 一个加号(加号里上传或智能拍照都行)——
          原来概览页那行「拍化验单 / ＋记一条」已删。 */}
      {(onRecord || onScan) && (
        <div className="nesio-bl-logrow">
          {onRecord && (
            <button type="button" className="nesio-rel-log-btn" onClick={onRecord}>
              {L(dict, '记一条', 'Log a record')}
            </button>
          )}
          {onScan && (
            <button type="button" className="nesio-bl-logplus" onClick={onScan}
              aria-label={L(dict, '上传或智能拍照', 'Upload or smart capture')}
              title={L(dict, '上传或智能拍照', 'Upload or smart capture')}>
              <IconPlus size={16} />
            </button>
          )}
        </div>
      )}
      <TodayBody
        ledger={ledger}
        dict={dict}
        suggestions={suggestions}
        suggestErr={suggestErr}
        onRetrySuggest={() => setSuggestTick((n) => n + 1)}
        onCook={() => openCooking()}
        onLogMeal={() => openCooking()}
        onGoal={(g) => reloadLedger(g)}
      />
    </div>
  );
}
