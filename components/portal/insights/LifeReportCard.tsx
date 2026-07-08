'use client';

/**
 * 生活报告卡 —— 洞察 tab 顶部(输出口定稿 §7:回顾面)。
 * 周报/月报一键 + 自定义起止日期,聚合 fact-journal 跨域列;可存记忆(externalId 幂等,
 * 同区间重生成原地更新,不堆重复节点)。
 */

import { useMemo, useState } from 'react';
import { buildLifeReport, lifeReportText, type LifeReport } from '@/lib/portal/life-report';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';

function dk(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetRange(p: Preset, now = new Date()): { start: string; end: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'this_week' || p === 'last_week') {
    const dow = (today.getDay() + 6) % 7; // 周一=0
    const monday = new Date(today); monday.setDate(today.getDate() - dow);
    if (p === 'this_week') return { start: dk(monday), end: dk(today) };
    const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
    const lastSun = new Date(monday); lastSun.setDate(monday.getDate() - 1);
    return { start: dk(lastMon), end: dk(lastSun) };
  }
  if (p === 'this_month') return { start: dk(new Date(now.getFullYear(), now.getMonth(), 1)), end: dk(today) };
  // last_month
  return {
    start: dk(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: dk(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

export default function LifeReportCard() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [preset, setPreset] = useState<Preset>('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const range = useMemo(() => {
    if (preset === 'custom') {
      if (!customStart || !customEnd || customStart > customEnd) return null;
      return { start: customStart, end: customEnd };
    }
    return presetRange(preset);
  }, [preset, customStart, customEnd]);

  const report: LifeReport | null = useMemo(() => (range ? buildLifeReport(range.start, range.end) : null), [range]);

  function saveToMemory() {
    if (!report) return;
    const zh = dict !== 'en';
    ingestLifeNode({
      type: 'preference',
      name: L(dict, `生活报告 ${report.startKey}~${report.endKey}`, `Life report ${report.startKey}~${report.endKey}`),
      attributes: {
        source: 'life-report',
        externalId: `life-report:${report.startKey}:${report.endKey}`,
        article: lifeReportText(report, zh),
      },
      source: 'system',
      confidence: 1,
      relations: [],
      tags: ['报告', '生活'],
    });
    setSavedMsg(L(dict, '已存入记忆 ✓', 'Saved to memory ✓'));
    setTimeout(() => setSavedMsg(''), 2500);
  }

  const fmtH = (min?: number) => (min == null ? '—' : `${Math.round(min / 60)}h`);
  const PRESETS: Array<[Preset, string, string]> = [
    ['this_week', '本周', 'This week'], ['last_week', '上周', 'Last week'],
    ['this_month', '本月', 'This month'], ['last_month', '上月', 'Last month'], ['custom', '自定义', 'Custom'],
  ];

  return (
    <div className="nesio-lr">
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '生活报告', 'Life report')}</p>
      <div className="nesio-lr-presets">
        {PRESETS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${preset === id ? ' is-active' : ''}`} onClick={() => setPreset(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="nesio-lr-custom">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label={L(dict, '开始日期', 'Start date')} />
          <span>–</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label={L(dict, '结束日期', 'End date')} />
        </div>
      )}
      {!report ? (
        <p className="nesio-settings-option-hint">{L(dict, '选择起止日期', 'Pick a date range')}</p>
      ) : report.daysWithData === 0 ? (
        <p className="nesio-settings-option-hint">{L(dict, `${report.startKey} ~ ${report.endKey}:这段时间还没有数据(足迹/支出/心情等积累后这里会有汇总)`, `${report.startKey} ~ ${report.endKey}: no data in this range yet`)}</p>
      ) : (
        <>
          <p className="nesio-settings-option-hint">{L(dict, `${report.startKey} ~ ${report.endKey} · ${report.daysWithData}/${report.days} 天有数据`, `${report.startKey} ~ ${report.endKey} · ${report.daysWithData}/${report.days} days with data`)}</p>
          <div className="nesio-tl-month-grid nesio-lr-grid">
            {report.sums.placeVisits != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{report.sums.placeVisits}</span><span className="nesio-tl-stat-l">{L(dict, '次到访', 'visits')}</span></div>}
            {report.sums.placeAwayMin != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{fmtH(report.sums.placeAwayMin)}</span><span className="nesio-tl-stat-l">{L(dict, '在外', 'out')}</span></div>}
            {report.sums.spend != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">${Math.round(report.sums.spend)}</span><span className="nesio-tl-stat-l">{L(dict, '支出', 'spent')}</span></div>}
            {report.avgs.moodValence != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{report.avgs.moodValence > 0 ? '+' : ''}{report.avgs.moodValence}</span><span className="nesio-tl-stat-l">{L(dict, '心情均值', 'mood avg')}</span></div>}
            {report.sums.trainingSessions != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{report.sums.trainingSessions}</span><span className="nesio-tl-stat-l">{L(dict, '次训练', 'workouts')}</span></div>}
            {report.sums.placeMoveKm != null && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{Math.round(report.sums.placeMoveKm)}</span><span className="nesio-tl-stat-l">{L(dict, 'km 移动', 'km moved')}</span></div>}
          </div>
          {report.topPlaces.length > 0 && (
            <p className="nesio-settings-option-hint" style={{ marginTop: '0.4rem' }}>
              {L(dict, '常去:', 'Top places: ')}{report.topPlaces.map((p) => `${p.label}(${p.visits})`).join(' · ')}
            </p>
          )}
          <div className="nesio-lr-actions">
            <button type="button" className="nesio-fin-review-accept" onClick={saveToMemory}>{L(dict, '存入记忆', 'Save to memory')}</button>
            {savedMsg && <span className="nesio-tl-geo-msg">{savedMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
