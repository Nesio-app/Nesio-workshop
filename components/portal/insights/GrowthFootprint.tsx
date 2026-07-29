'use client';

/**
 * GrowthFootprint — 成长首页顶部「成长足迹」总览面板。
 * 心智成长环 = 广度(点亮哪些维度);足迹 = 时间旅程(走了多远、坚持得怎样)。
 * 全部从 growthHistory() 现算,不加存储;语气克制不做分数。
 *   一句旅程话 + 四个数字(连续/走过/遇见的陷阱→练习场/疗愈→疗愈)+ 本周节奏条 + 近 8 周趋势曲线。
 */

import { useEffect, useState } from 'react';
import { growthHistory, growthStreakDays } from '@/lib/portal/growth-guide';
import { trapsMet, THINKING_TRAPS } from '@/lib/portal/thinking-catalog';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Foot {
  total: number; streak: number; daysJourneyed: number; firstAt: string | null;
  traps: number; trapTotal: number; healCount: number;
  week: { label: string; on: boolean }[]; weeks: number[];
}

function compute(en: boolean): Foot {
  const history = growthHistory(); // 新→旧
  const total = history.length;
  const now = Date.now();
  const firstAt = total ? history[history.length - 1].at : null;
  const first = firstAt ? new Date(firstAt).getTime() : now;
  const daysJourneyed = Math.max(1, Math.round((now - first) / DAY) + 1);
  const daysWith = new Set(history.map((a) => dayKey(new Date(a.at).getTime())));
  const wd = en ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['日', '一', '二', '三', '四', '五', '六'];
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * DAY);
    return { label: wd[d.getDay()], on: daysWith.has(dayKey(d.getTime())) };
  });
  const weeks = Array.from({ length: 8 }, () => 0);
  for (const a of history) {
    const wAgo = Math.floor((now - new Date(a.at).getTime()) / (7 * DAY));
    if (wAgo >= 0 && wAgo < 8) weeks[7 - wAgo] += 1;
  }
  return {
    total, streak: growthStreakDays(), daysJourneyed, firstAt,
    traps: trapsMet(history).size, trapTotal: THINKING_TRAPS.length,
    healCount: history.filter((a) => (a.refId || '').startsWith('heal:')).length,
    week, weeks,
  };
}

export default function GrowthFootprint({ onGoTab }: { onGoTab: (t: 'practice' | 'healing') => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [f, setF] = useState<Foot | null>(null);
  const [open, setOpen] = useState(false); // 图21:统计细节默认折叠
  useEffect(() => { try { setF(compute(en)); } catch { /* 空态兜底 */ } }, [en]);
  if (!f) return null;

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  // 8 周趋势曲线(面积 + 线 + 末点),viewBox 拉伸、描边不缩放
  const W = 100, H = 34, pad = 3, max = Math.max(...f.weeks, 1);
  const pts = f.weeks.map((v, i) => [pad + (i * (W - 2 * pad)) / 7, pad + (H - 2 * pad) * (1 - v / max)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[7][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;

  return (
    <div className="ng-fp">
      {/* 2026-07-28 UI 精修(标注 图21「折叠进成长足迹」):四个数字方块 + 这周节奏 + 8 周曲线
          原本一进成长页就铺满一屏,把「今天这一件」挤到屏幕外。现在收进标题下,想看再展开;
          那句「从 X 月 X 日算起,你回头看了自己 N 次」留在外面 —— 一句话就够代表足迹了。 */}
      <button type="button" className="ng-fp-hd ng-fp-hd--btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="l">{L(dict, '成长足迹', 'Your footprint')}</span>
        <span className="ng-fold-caret" aria-hidden>{open ? '⌃' : '⌄'}</span>
      </button>

      {f.total === 0 ? (
        <p className="ng-fp-empty">{L(dict, '还没开始留下觉察 —— 答一条今天的引导,足迹就从这里长出来。', 'No insight left yet — answer today’s prompt and your trail starts here.')}</p>
      ) : (
        <>
          <p className="ng-fp-lead">
            {f.firstAt
              ? L(dict, `从 ${fmtDay(f.firstAt)} 算起,你回头看了自己 `, `Since ${fmtDay(f.firstAt)}, you’ve looked back `)
              : ''}
            <b>{f.total}</b>{L(dict, ' 次。', f.total === 1 ? ' time.' : ' times.')}
          </p>

          {open && (<>
          <div className="ng-fp-grid">
            <div className="ng-fp-tile"><p className="n">{f.streak}<span>{L(dict, ' 天', 'd')}</span></p><p className="k">{L(dict, '连续回看', 'Streak')}</p></div>
            <div className="ng-fp-tile"><p className="n">{f.daysJourneyed}<span>{L(dict, ' 天', 'd')}</span></p><p className="k">{L(dict, '已经走过', 'Days in')}</p></div>
            <button type="button" className="ng-fp-tile act" onClick={() => onGoTab('practice')}><p className="n">{f.traps}<span>{L(dict, ` /${f.trapTotal}`, ` /${f.trapTotal}`)}</span></p><p className="k">{L(dict, '遇见的陷阱 ›', 'Traps met ›')}</p></button>
            <button type="button" className="ng-fp-tile act" onClick={() => onGoTab('healing')}><p className="n">{f.healCount}<span>{L(dict, ' 次', '×')}</span></p><p className="k">{L(dict, '疗愈 · 陪自己 ›', 'Healing ›')}</p></button>
          </div>

          <div className="ng-fp-week">
            <div className="hd"><span>{L(dict, '这周', 'This week')}</span><span className="q">{L(dict, '留过觉察的日子', 'Days you left insight')}</span></div>
            <div className="cols">
              {f.week.map((d, i) => (
                <div key={i} className="col"><span className={`bar${d.on ? ' on' : ''}${i === 6 ? ' today' : ''}`} /><span className="lb">{d.label}</span></div>
              ))}
            </div>
          </div>

          {f.total >= 3 && (
            <div className="ng-fp-trend">
              <div className="hd"><span>{L(dict, '近 8 周', 'Last 8 weeks')}</span><span className="q">{L(dict, '每周回看的走势', 'Look-backs per week')}</span></div>
              <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
                <path className="ar" d={area} />
                <path className="ln" d={line} vectorEffect="non-scaling-stroke" />
                <circle className="dot" cx={pts[7][0]} cy={pts[7][1]} r={2} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}
          </>)}
        </>
      )}
    </div>
  );
}
