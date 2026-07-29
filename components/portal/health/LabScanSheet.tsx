'use client';

/**
 * LabScanSheet — 拍化验单 → 确认入库(健康镜头 B 屏,2026-07-29)。
 *
 * 流程:选图/拍照 → **端上** OCR(Apple Vision,零外发) → 确定性解析 → 这张确认屏。
 *
 * 规格红线在这里兑现:
 *   · **needsConfirm 恒真** —— 识别出来的东西一条都不许静默入库。健康数据解错了
 *     不会报错,只会安安静静变成一条假记录,然后被曲线、被问一问、被「同期发生」引用。
 *   · **异常项 amber 置顶** —— 先核最要紧的几行(排序在 parseLabReport 里做)。
 *   · **日常偏高一律 amber,不用红** —— 红只留给真实风险。
 *   · 成员选择(我 / 家人)。
 *   · 逐项可改:名字/值/单位/参考区间全都能就地编辑,解错了当场改,不用回头重录。
 *
 * 端上识别不可用时**不偷偷走云** —— 化验单是病历,不因为端上没有就换条路发出去。
 * 直接说清楚为什么,并把人引到手填。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { recognizeOnDevice, visionAvailability, unavailableMessage, type VisionUnavailableReason } from '@/lib/native/vision';
import { parseLabReport, abnormalCount, findReportDate, flagOf, type ParsedLabRow } from '@/lib/health/lab-parse';
import { recordLab, SELF_PERSON_KEY } from '@/lib/health/health-signals';
import { buildRelationships } from '@/lib/portal/relationships';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Phase =
  | { s: 'pick' }
  | { s: 'reading' }
  | { s: 'blocked'; reason: VisionUnavailableReason }   // 端上不可用 —— 说清楚 + 去手填
  | { s: 'failed'; message: string }                    // 识别没成 —— 可重试
  | { s: 'empty'; text: string }                        // 认出字了但一条指标都解不出来
  | { s: 'confirm'; rows: Row[]; date: string };

/** 确认屏里的一行:解析结果 + 用户改动 + 要不要收。 */
interface Row extends ParsedLabRow { keep: boolean }

const today = () => new Date().toLocaleDateString('en-CA');

export default function LabScanSheet({
  open, onClose, onSaved, onManual,
}: { open: boolean; onClose: () => void; onSaved?: (n: number) => void; onManual?: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [phase, setPhase] = useState<Phase>({ s: 'pick' });
  const [who, setWho] = useState(SELF_PERSON_KEY);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const people = useMemo(() => {
    if (!open) return [];
    try { return buildRelationships(getLifeGraph()).slice(0, 12); } catch { return []; }
  }, [open]);

  const run = useCallback(async (file: File) => {
    setPhase({ s: 'reading' });
    const avail = await visionAvailability();
    if (!avail.available) { setPhase({ s: 'blocked', reason: avail.reason || 'plugin_missing' }); return; }

    const r = await recognizeOnDevice(file);
    if (!r.ok) { setPhase({ s: 'failed', message: r.message }); return; }

    const rows = parseLabReport(r.text);
    if (!rows.length) { setPhase({ s: 'empty', text: r.text }); return; }
    // 日期解不出来就用今天 —— 但这是**用户可见可改**的一个输入框,不是背地里替他定的。
    setPhase({ s: 'confirm', rows: rows.map((x) => ({ ...x, keep: true })), date: findReportDate(r.text) || today() });
  }, []);

  const reset = () => { setPhase({ s: 'pick' }); setSaveErr(null); };

  const patch = (i: number, p: Partial<Row>) => setPhase((cur) => {
    if (cur.s !== 'confirm') return cur;
    const rows = cur.rows.slice();
    const next = { ...rows[i], ...p };
    // 改了值或区间要重算判定 —— 否则用户把区间填对了,标记还停在旧结论上。
    if ('value' in p || 'low' in p || 'high' in p) {
      next.flag = flagOf(next.value, next.low, next.high);
    }
    rows[i] = next;
    return { ...cur, rows };
  });

  const commit = () => {
    if (phase.s !== 'confirm') return;
    const picked = phase.rows.filter((r) => r.keep && r.name.trim() && Number.isFinite(r.value));
    if (!picked.length) { setSaveErr(t('一条都没选。', 'Nothing selected.')); return; }
    setSaveErr(null);
    setBusy(true);
    try {
      for (const r of picked) {
        recordLab({
          name: r.name.trim(), value: r.value, unit: r.unit || '',
          low: r.low, high: r.high, personKey: who, date: phase.date,
          panel: t('化验单', 'Lab report'),
        });
      }
      onSaved?.(picked.length);
      onClose();
      reset();
    } catch {
      // 红线:写失败要看得见,不许关掉让人以为存上了。
      setSaveErr(t('没能存上,再试一次。', "Couldn't save — try again."));
    } finally {
      setBusy(false);
    }
  };

  const goManual = () => { onClose(); reset(); onManual?.(); };

  if (!open) return null;

  const abn = phase.s === 'confirm' ? abnormalCount(phase.rows) : 0;

  return (
    <NesioSheet variant="bottom" elevated open onOpenChange={(n) => { if (!n) { onClose(); reset(); } }}
      card={false} className="nesio-settings-sheet-card" ariaLabel={t('拍化验单', 'Scan a lab report')}>
      <h2 className="nesio-settings-sheet-title">{t('拍化验单', 'Scan a lab report')}</h2>
      <div className="nesio-settings-sheet-body">

        {phase.s === 'pick' && (
          <>
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
              {t('把整张单子放平、拍清楚。识别在这台手机上完成,图片不会离开设备。',
                'Lay the report flat and shoot it clearly. Recognition runs on this phone — the image never leaves the device.')}
            </p>
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.8rem' }}
              onClick={() => fileRef.current?.click()}>
              {t('拍照 / 选一张', 'Take or choose a photo')}
            </button>
            <button type="button" className="nesio-rel-log-btn" style={{ width: '100%', marginTop: '0.5rem' }} onClick={goManual}>
              {t('手填也行', 'Type it in instead')}
            </button>
          </>
        )}

        {phase.s === 'reading' && (
          <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{t('在这台手机上认字…', 'Reading on this phone…')}</p>
        )}

        {/* 端上不可用:说清楚为什么 + 给出路。绝不偷偷改走云端。 */}
        {phase.s === 'blocked' && (
          <div role="alert">
            <p className="nesio-rel-detail-err" style={{ marginTop: 0 }}>{unavailableMessage(phase.reason)}</p>
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.6rem' }} onClick={goManual}>
              {t('手填这张单子', 'Type this report in')}
            </button>
          </div>
        )}

        {phase.s === 'failed' && (
          <div role="alert">
            <p className="nesio-rel-detail-err" style={{ marginTop: 0 }}>{phase.message}</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
                {t('再拍一张', 'Try another photo')}
              </button>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={goManual}>
                {t('手填', 'Type it in')}
              </button>
            </div>
          </div>
        )}

        {phase.s === 'empty' && (
          <div role="alert">
            <p className="nesio-rel-detail-err" style={{ marginTop: 0 }}>
              {t('认出字了,但没找到能入库的指标行 —— 可能是版式没对上。',
                'Text was read, but no metric rows matched — the layout may be unusual.')}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
                {t('再拍一张', 'Try another photo')}
              </button>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={goManual}>
                {t('手填', 'Type it in')}
              </button>
            </div>
          </div>
        )}

        {phase.s === 'confirm' && (
          <>
            <p className="nesio-health-updated" style={{ margin: 0 }}>
              {abn > 0
                ? t(`识别到 ${phase.rows.length} 项 · ${abn} 项在参考区间外`, `${phase.rows.length} metrics · ${abn} outside the reference range`)
                : t(`识别到 ${phase.rows.length} 项`, `${phase.rows.length} metrics`)}
            </p>
            <p className="nesio-settings-option-hint" style={{ margin: '0.25rem 0 0' }}>
              {t('逐项核一眼再入库 —— 认错一个数字,后面的曲线就跟着错。', 'Check each row before saving — one wrong number skews every curve after it.')}
            </p>

            <label className="nesio-settings-section-label" htmlFor="ls-who" style={{ marginTop: '0.7rem' }}>{t('这是谁的', 'Whose')}</label>
            <select id="ls-who" className="nesio-ob-input" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value={SELF_PERSON_KEY}>{t('我', 'Me')}</option>
              {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>

            <label className="nesio-settings-section-label" htmlFor="ls-date" style={{ marginTop: '0.7rem' }}>{t('化验日期', 'Report date')}</label>
            <input id="ls-date" className="nesio-ob-input" type="date" value={phase.date}
              onChange={(e) => setPhase((c) => (c.s === 'confirm' ? { ...c, date: e.target.value } : c))} />

            <p className="nesio-settings-section-label" style={{ marginTop: '0.9rem' }}>{t('逐项确认', 'Row by row')}</p>
            {phase.rows.map((r, i) => {
              const off = r.flag === 'high' || r.flag === 'low';
              return (
                <div key={i} className="nesio-health-card" style={{ gridColumn: '1 / -1', marginBottom: '0.5rem', opacity: r.keep ? 1 : 0.45 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" checked={r.keep} aria-label={t(`收下「${r.name}」`, `Keep ${r.name}`)}
                      onChange={(e) => patch(i, { keep: e.target.checked })} />
                    <input className="nesio-ob-input" style={{ flex: 1 }} value={r.name} maxLength={40}
                      aria-label={t('指标名', 'Metric name')}
                      onChange={(e) => patch(i, { name: e.target.value })} />
                    {/* 偏离参考区间:amber。日常偏高不是风险,不用红。 */}
                    {off && (
                      <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', padding: '0.15rem 0.5rem',
                        borderRadius: 'var(--radius-pill)', background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>
                        {r.flag === 'high' ? t('偏高', 'High') : t('偏低', 'Low')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <input className="nesio-ob-input" style={{ flex: 2 }} inputMode="decimal" value={String(r.value)}
                      aria-label={t('数值', 'Value')}
                      onChange={(e) => patch(i, { value: Number(e.target.value) })} />
                    <input className="nesio-ob-input" style={{ flex: 1 }} value={r.unit || ''} maxLength={16} placeholder={t('单位', 'Unit')}
                      aria-label={t('单位', 'Unit')}
                      onChange={(e) => patch(i, { unit: e.target.value })} />
                    <input className="nesio-ob-input" style={{ flex: 1 }} inputMode="decimal" value={r.low ?? ''} placeholder={t('下限', 'Low')}
                      aria-label={t('参考下限', 'Reference low')}
                      onChange={(e) => patch(i, { low: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    <input className="nesio-ob-input" style={{ flex: 1 }} inputMode="decimal" value={r.high ?? ''} placeholder={t('上限', 'High')}
                      aria-label={t('参考上限', 'Reference high')}
                      onChange={(e) => patch(i, { high: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </div>
                  {/* 把握不足的行原样把 OCR 那一行摆出来,让人对照着改,而不是猜我们解错了什么 */}
                  {r.confidence !== 'high' && (
                    <span className="nesio-health-card-range" style={{ display: 'block', marginTop: '0.3rem' }}>
                      {t('原文:', 'Read as: ')}{r.raw}
                    </span>
                  )}
                </div>
              );
            })}

            {saveErr && <p className="nesio-rel-detail-err" role="alert">{saveErr}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
                {t('重拍', 'Retake')}
              </button>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} disabled={busy} onClick={commit}>
                {busy ? t('存着…', 'Saving…') : t(`确认入库 · ${phase.rows.filter((r) => r.keep).length} 项`, `Save ${phase.rows.filter((r) => r.keep).length}`)}
              </button>
            </div>
          </>
        )}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => {
            // 先把 File 抓出来再清 value —— 反了的话 FileList 当场变空,表现是「点了没反应」。踩过。
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void run(f);
          }} />

        <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
          {t('识别在本机完成 · 健康信息参考,不作诊断', 'Recognition runs on-device · for reference, not a diagnosis')}
        </p>
      </div>
    </NesioSheet>
  );
}
