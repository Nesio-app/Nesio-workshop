/**
 * 每日快照 journal —— 跨区推理 P0(`docs/design/cross-region-reasoning.md` P0 /
 * `docs/design/system-layers.md` Layer 0 缺件①)。
 *
 * 职责:把「事件流 + 状态提供者 + 易逝上下文」横切成**每日一行**的对齐序列,
 * 给 P1 检测层(Spearman/共现)当事实空间。没有它,「下雨天打车支出↑」这类
 * 跨域相关永远学不出——天气取完即弃,不当天落盘就没了。
 *
 * 数据面(2026-07-08 与用户定稿,见 algorithm-layer-plan §7):
 *   位置(place-trail)· 健康时序 · 银行流水 · 心情 · 训练打卡 · 反馈计数
 *   + 易逝采样:天气 · 日历密度
 *   实验打卡(n-of-1)按 plan §3 记账推迟(loadExperiments 还在组件层,先抽 lib 再接)。
 *   邮件按 plan §1 bypass 归位路径处理,不单独进列。
 *
 * PIT 纪律在 journal-core.mjs(纯函数,有单测):过去行不可变;今天可持续采样合并。
 * 存储:IDB blob(登记 → 自动进云备份/彻底删除收口)。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { mergeDayRow, datesBack, todayKey } from './journal-core.mjs';
import { loadPlaceTrail, buildPlaceTimeline, haversineKm } from '@/lib/portal/place-trail';
import { loadBankTx, txFlow } from '@/lib/portal/bank-tx';
import { loadHealthMetrics } from '@/lib/portal/health-store';
import { loadTrainingState } from '@/lib/platform/training-protocol-engine';
import { readFeedbackLog } from '@/lib/platform/personalization';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { getRecentMoments, emotionValence } from '@/lib/portal/moment-analytics';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';

export interface JournalRow {
  dateKey: string;
  recordedAt: string;
  backfilled?: boolean;
  /** 列 → 数值。列名是软 schema:检测层按存在的列对齐,不要求每天全齐。 */
  m: Record<string, number>;
}

const KEY = 'nesio-fact-journal-v1';
export const FACT_JOURNAL_UPDATED_EVENT = 'nesio-fact-journal-updated';

const store = createBlobStore<Record<string, JournalRow>>({
  key: KEY,
  updateEvent: FACT_JOURNAL_UPDATED_EVENT,
  validate: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function loadAll(): Record<string, JournalRow> {
  const raw = store.load();
  return raw && typeof raw === 'object' ? raw : {};
}

/** 读最近 days 天的行(新→旧,只含已写入的天)。 */
export function readFactJournal(days = 120): JournalRow[] {
  const all = loadAll();
  return Object.values(all)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, days);
}

// ── 历史可回溯的列(按天批量推导)──────────────────────────────────────────

function deriveHistoricalColumns(dateKeys: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const want = new Set(dateKeys);
  const put = (dk: string, col: string, v: number) => {
    if (!want.has(dk) || !Number.isFinite(v)) return;
    const row = out.get(dk) || {};
    row[col] = Math.round(v * 100) / 100;
    out.set(dk, row);
  };

  // 位置:外出停留 / 移动 / 到访数(段已按事发地钟点对齐)
  try {
    for (const day of buildPlaceTimeline(loadPlaceTrail(), 3650)) {
      if (!want.has(day.dateKey)) continue;
      let away = 0, visits = 0, moveKm = 0;
      const segs = day.segments;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        visits += 1;
        if (s.category !== 'home') away += s.durationMin;
        const n = segs[i + 1];
        if (n && s.lat != null && s.lon != null && n.lat != null && n.lon != null) {
          const km = haversineKm(s.lat, s.lon, n.lat, n.lon);
          if (km >= 0.05 && km < 2000) moveKm += km;
        }
      }
      put(day.dateKey, 'placeAwayMin', away);
      put(day.dateKey, 'placeVisits', visits);
      if (moveKm > 0) put(day.dateKey, 'placeMoveKm', moveKm);
    }
  } catch { /* 无足迹数据 */ }

  // 银行:当日真实支出(txFlow 只认 expense,转账/收入/还款不算)
  try {
    const byDay = new Map<string, number>();
    for (const t of loadBankTx()) {
      const dk = String(t.date || '').slice(0, 10);
      if (!want.has(dk)) continue;
      if (txFlow(t) !== 'expense') continue;
      byDay.set(dk, (byDay.get(dk) || 0) + Math.abs(t.amount || 0));
    }
    for (const [dk, v] of byDay) put(dk, 'spend', v);
  } catch { /* 无银行数据 */ }

  // 心情:当日情绪均值(moment 节点,valence 复用 moment-analytics 的表)
  try {
    const moments = getRecentMoments(getLifeGraph(), 400);
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const nd of moments) {
      const ts = (nd.attributes?.recordedAt as string) || nd.createdAt || '';
      const dk = ts.slice(0, 10);
      if (!want.has(dk)) continue;
      const emo = (nd.attributes?.emotionId || nd.attributes?.emotion || '') as string;
      if (!emo) continue;
      const v = emotionValence(emo);
      const cur = byDay.get(dk) || { sum: 0, n: 0 };
      cur.sum += v; cur.n += 1;
      byDay.set(dk, cur);
    }
    for (const [dk, { sum, n }] of byDay) if (n > 0) put(dk, 'moodValence', sum / n);
  } catch { /* 无心情数据 */ }

  // 训练打卡:当日完成 session 数
  try {
    const log = loadTrainingState().log || [];
    const byDay = new Map<string, number>();
    for (const s of log) {
      if (!want.has(s.date)) continue;
      byDay.set(s.date, (byDay.get(s.date) || 0) + 1);
    }
    for (const [dk, v] of byDay) put(dk, 'trainingSessions', v);
  } catch { /* 无训练数据 */ }

  // 反馈:当日 useful / 负向 计数(事实日志回放)
  try {
    const byDay = new Map<string, { pos: number; neg: number }>();
    for (const e of readFeedbackLog()) {
      const dk = String(e.at || '').slice(0, 10);
      if (!want.has(dk)) continue;
      const cur = byDay.get(dk) || { pos: 0, neg: 0 };
      if (e.reaction === 'useful' || e.reaction === 'done') cur.pos += 1;
      else if (e.reaction === 'dismiss' || e.reaction === 'wrong' || e.reaction === 'too_much') cur.neg += 1;
      byDay.set(dk, cur);
    }
    for (const [dk, { pos, neg }] of byDay) { put(dk, 'fbUseful', pos); put(dk, 'fbNegative', neg); }
  } catch { /* 无反馈日志 */ }

  // 健康:只认 latestDate 正好落在目标日的读数(月度 series 无日粒度,不硬造)
  try {
    const metrics = loadHealthMetrics();
    const HEALTH_COLS: Record<string, string> = { steps: 'steps', sleep: 'sleepMin', restingHR: 'restingHR', hrv: 'hrv' };
    for (const [key, col] of Object.entries(HEALTH_COLS)) {
      const metric = (metrics as Record<string, { latest?: number; latestDate?: string }> | null)?.[key];
      if (metric?.latestDate && want.has(metric.latestDate) && typeof metric.latest === 'number') {
        put(metric.latestDate, col, metric.latest);
      }
    }
  } catch { /* 无健康数据 */ }

  return out;
}

// ── 易逝上下文(只能当天采,回不去)────────────────────────────────────────

function sampleEphemeral(): Record<string, number> {
  const m: Record<string, number> = {};
  try {
    const w = readPortalCache<{ temperatureC?: number; tempC?: number; precipitationMm?: number }>(PORTAL_CACHE_KEYS.weather);
    const temp = w?.temperatureC ?? w?.tempC;
    if (typeof temp === 'number') m.weatherTempC = temp;
    if (typeof w?.precipitationMm === 'number') m.weatherPrecipMm = w.precipitationMm;
  } catch { /* 无天气缓存 */ }
  try {
    const cal = readPortalCache<{ events?: unknown[] }>(PORTAL_CACHE_KEYS.calendar);
    if (Array.isArray(cal?.events)) m.calendarEvents = cal.events.length;
  } catch { /* 无日历缓存 */ }
  return m;
}

// ── 主入口 ───────────────────────────────────────────────────────────────

/**
 * 保证 journal 就位:回填缺失的过去 backfillDays 天(可回溯列,PIT 不覆写已有行)
 * + 采样今天(可回溯列 + 易逝上下文,当天可反复合并)。幂等,可随 Today 挂载调用。
 */
export function ensureFactJournal(backfillDays = 90, now = new Date()): void {
  const all = loadAll();
  const tk = todayKey(now);
  const keys = datesBack(backfillDays, now);
  const missingPast = keys.filter((dk) => dk !== tk && !all[dk]);
  const derived = deriveHistoricalColumns([...missingPast, tk]);

  let changed = false;
  const nowIso = now.toISOString();
  for (const dk of missingPast) {
    const m = derived.get(dk);
    if (!m || Object.keys(m).length === 0) continue; // 没数据的天不写空行
    const row = mergeDayRow(all[dk], { dateKey: dk, m, backfilled: true }, true, nowIso);
    if (row) { all[dk] = row; changed = true; }
  }

  const todayMetrics = { ...(derived.get(tk) || {}), ...sampleEphemeral() };
  if (Object.keys(todayMetrics).length > 0) {
    const row = mergeDayRow(all[tk], { dateKey: tk, m: todayMetrics }, false, nowIso);
    if (row) { all[tk] = row; changed = true; }
  }

  if (changed) store.save(all);
}
