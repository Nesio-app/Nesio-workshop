'use client';

/**
 * BodyLedgerPanel — 健康页「身体账本」:今日账本 / 餐后模式 / 稳飙探索。
 * 美容护理在同页「护理」tab(BeautyCarePanel)。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HealthMetrics } from '@/lib/portal/apple-health';
import {
  buildDayLedger, ledgerPrompt, suggestDinnerForGap, rankFoodReactions,
  goalLabel, setBodyGoalKind, mgDlToDisplay, todayYmd,
  type BodyGoalKind, type BodyLedgerSection, type DinnerSuggestion, type DayLedger,
} from '@/lib/portal/body-ledger';
import { getMeals } from '@/lib/cooking/meals';
import { L } from '@/lib/portal/i18n';
import SegTabs from '../ui/SegTabs';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconUtensils, IconZap, IconChevronRight, IconCheckCircle } from '../icons';

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

      {prompt && (
        <div className="nesio-bl-prompt" role="status">{prompt}</div>
      )}

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

      <div className="nesio-bl-meals">
        <p className="nesio-insights-section-label">{L(dict, '今日已记', 'Logged today')}</p>
        {ledger.meals.length === 0 ? (
          <button type="button" className="nesio-bl-emptycta" onClick={onLogMeal}>
            <IconUtensils size={18} />
            {L(dict, '去美味记一餐', 'Log a meal in Cooking')}
            <IconChevronRight size={16} />
          </button>
        ) : (
          <ul className="nesio-bl-meal-list">
            {ledger.meals.map((m) => (
              <li key={m.id}>
                <span className="nesio-bl-meal-ico"><IconUtensils size={14} /></span>
                <span className="nesio-bl-meal-main">
                  <b>{m.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(' · ') || L(dict, '一餐', 'Meal')}</b>
                  <small>{m.source} · {Math.round(m.energyKCal)} kcal · P{Math.round(m.protein)}g</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="nesio-trip-footnote">
        {L(dict, '蛋白目标会随今日锻炼分钟轻轻上调;数据来自美味「记一餐」+ Apple Health 活动三环。', 'Protein goal eases up with today’s exercise minutes; data from Cooking meals + Apple Health rings.')}
      </p>
    </div>
  );
}

function PostMealBody({ health, dict }: { health: HealthMetrics | null; dict: string }) {
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

function ReactionBody({ health, dict }: { health: HealthMetrics | null; dict: string }) {
  const rows = useMemo(
    () => rankFoodReactions(getMeals(), health?.daily, { minN: 2, limit: 10 }),
    [health],
  );
  const unit = health?.glucose?.unit || 'mg/dL';
  const nMeals = getMeals().length;

  return (
    <div className="nesio-bl-section">
      <p className="nesio-bl-lede">{L(dict, '哪些让你稳 / 飙', 'What keeps you steady / spikes')}</p>
      <p className="nesio-trip-footnote">
        {L(dict, `近 ${nMeals} 餐 · 同日血糖振幅均值(探索性)`, `Last ${nMeals} meals · same-day glucose amplitude (exploratory)`)}
      </p>
      {rows.length === 0 ? (
        <p className="nesio-trip-footnote">
          {L(dict, '样本还少 —— 多记几餐并导入血糖后,这里会出现「稳 / 飙」排序。不是医疗结论。',
            'Too few samples yet — log more meals and import glucose to rank steady vs spike. Not a medical verdict.')}
        </p>
      ) : (
        <ul className="nesio-bl-rank">
          {rows.map((r) => {
            const rise = mgDlToDisplay(r.avgRise, unit === 'mmol/L' ? 'mmol/L' : 'mg/dL');
            const maxW = Math.max(...rows.map((x) => Math.abs(x.avgRise)), 1);
            const w = Math.round((Math.abs(r.avgRise) / maxW) * 100);
            return (
              <li key={r.name}>
                <div className="nesio-bl-rank-row">
                  <span className="nesio-bl-rank-name">{r.name}</span>
                  <span className={`nesio-bl-rank-val${r.tone === 'spike' ? ' is-spike' : ' is-stable'}`}>
                    +{rise}{unit === 'mmol/L' ? '' : ''}
                  </span>
                </div>
                <div className={`nesio-bl-rank-bar${r.tone === 'spike' ? ' is-spike' : ' is-stable'}`} aria-hidden>
                  <div style={{ width: `${w}%` }} />
                </div>
                <small className="nesio-bl-rank-n">n={r.n} · {r.tone === 'spike' ? L(dict, '偏飙(探索)', 'spike-ish') : L(dict, '偏稳(探索)', 'steadier')}</small>
              </li>
            );
          })}
        </ul>
      )}
      <p className="nesio-trip-footnote">
        {L(dict, '基于同日血糖振幅与餐名共现 —— 模式值得留意,不是最终医学判断。', 'Based on same-day glucose amplitude co-occurring with foods — a pattern to notice, not a clinical call.')}
      </p>
    </div>
  );
}

export default function BodyLedgerPanel({
  health,
  initialSection = 'today',
}: {
  health: HealthMetrics | null;
  initialSection?: BodyLedgerSection;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [section, setSection] = useState<Exclude<BodyLedgerSection, 'care'>>(
    initialSection === 'care' ? 'today' : initialSection,
  );
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

  return (
    <div className="nesio-body-ledger">
      {/* 2026-07-29:原 .nesio-bl-tabs 是全站分段控件的第 6 套,收敛到 SegTabs。 */}
      <SegTabs
        items={([
          ['today', '今日账本', 'Today'],
          ['postmeal', '餐后血糖', 'Post-meal'],
          ['reaction', '稳 / 飙', 'Steady / spike'],
        ] as const).map(([id, zh, en]) => ({ key: id, label: L(dict, zh, en) }))}
        active={section}
        onSelect={setSection}
        ariaLabel={L(dict, '身体账本', 'Body ledger')}
      />

      {section === 'today' && (
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
      )}
      {section === 'postmeal' && <PostMealBody health={health} dict={dict} />}
      {section === 'reaction' && <ReactionBody health={health} dict={dict} />}
    </div>
  );
}

/** 概览快捷进入(对齐稿:账本 / 餐后 / 反应)。 */
export function BodyLedgerQuickLinks({
  onOpen, dict,
}: {
  onOpen: (section: BodyLedgerSection) => void;
  dict: string;
}) {
  const items: Array<{ id: BodyLedgerSection; zh: string; en: string; subZh: string; subEn: string; ico: ReactNode }> = [
    {
      id: 'today',
      zh: '身体账本 · 一日时间线',
      en: 'Body ledger · day',
      subZh: '吃 / 练 / 血糖放在一起看',
      subEn: 'Eating, training, glucose together',
      ico: <IconZap size={18} />,
    },
    {
      id: 'postmeal',
      zh: '餐后血糖',
      en: 'Post-meal glucose',
      subZh: '一餐对应的反应曲线',
      subEn: 'Response curve after a meal',
      ico: <IconCheckCircle size={18} />,
    },
    {
      id: 'reaction',
      zh: '食物反应排序',
      en: 'Food reaction ranking',
      subZh: '哪些让你稳,哪些偏飙',
      subEn: 'What steadies you vs spikes',
      ico: <IconUtensils size={18} />,
    },
  ];
  return (
    <>
      <p className="nesio-insights-section-label">{L(dict, '快捷进入', 'Quick open')}</p>
      <ul className="nesio-bl-quick">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="nesio-bl-quick-row" onClick={() => onOpen(it.id)}>
              <span className="nesio-bl-quick-ico">{it.ico}</span>
              <span className="nesio-bl-quick-main">
                <b>{L(dict, it.zh, it.en)}</b>
                <small>{L(dict, it.subZh, it.subEn)}</small>
              </span>
              <IconChevronRight size={16} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
