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
 * ## 端上认不了字的时候(2026-07-31 用户定案)
 *
 * 老规矩是「不给云兜底」—— 化验单是病历,不因为端上没有就换条路发出去。
 * 这条**没有被推翻**,被推翻的只是「一条路都不给」:那台设备上你只能一个字一个字手填。
 *
 * 新规矩是「**问过才发**」:
 *   · 默认仍然不发。屏幕先说清楚这台设备认不了字,并给「手填这张单子」。
 *   · 旁边多一颗「发到云端认一次」。按钮上和按下去之后**都写明这是病历**,
 *     并且**每一张都要重新点一次** —— 没有「以后不再问」,没有记住选择。
 *     一张化验单发不发出去,是一次一决定的事,不是一个设置项。
 *   · 云在这条路上只当 OCR(`mode: 'ocr'`,逐字转写)。「这行是白细胞、偏高」
 *     仍然由本机的 parseLabReport 判 —— 让会猜的东西去判临床数值,
 *     错了不会报错,只会安安静静变成一条假记录。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { recognizeOnDevice, visionAvailability, unavailableMessage, type VisionUnavailableReason } from '@/lib/native/vision';
import { parseLabReport, abnormalCount, findReportDate, flagOf, type ParsedLabRow } from '@/lib/health/lab-parse';
import { recordLab, SELF_PERSON_KEY } from '@/lib/health/health-signals';
import { readLabPdf } from '@/lib/health/lab-pdf';
import { buildRelationships } from '@/lib/portal/relationships';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Phase =
  | { s: 'pick' }
  // step 区分「在读 PDF」和「在认字」—— 两者耗时差一个量级,一句「识别中」会让人以为卡了
  | { s: 'reading'; step: 'pdf' | 'ocr' }
  // fromScan:扫描件 PDF 走到这里时,该说的不是「拍清楚点」而是「这份是图片型 PDF」
  | { s: 'blocked'; reason: VisionUnavailableReason; fromScan?: boolean }
  // 用户点了「发到云端认一次」→ 先把话说明白,再点一次才真发。**不记住选择。**
  // 带着 reason/fromScan 一起走:点「算了」要能原样退回上一屏,
  // 而不是退回一个编出来的原因(那会让「为什么认不了」这句话变成假的)。
  | { s: 'asking'; reason: VisionUnavailableReason; fromScan?: boolean }
  | { s: 'sending' }
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
  const pdfRef = useRef<HTMLInputElement>(null);
  /**
   * 端上认不了的那些图,留在这儿等用户决定发不发。
   * 只在内存里 —— 不落盘、不进 IndexedDB:一张没被同意发出去的化验单,
   * 不该因为「我们先存着」而在设备上多留一份。关掉面板(reset)就没了。
   */
  // 两条来路给的形状不一样:图片是 File,扫描件 PDF 渲出来的是 dataURL 字符串。
  const pendingImagesRef = useRef<Array<Blob | string>>([]);

  const people = useMemo(() => {
    if (!open) return [];
    try { return buildRelationships(getLifeGraph()).slice(0, 12); } catch { return []; }
  }, [open]);

  /** 拿到整份文字之后的共同收尾:解析 → 空 → 确认屏。图片/PDF 两条路都汇到这里。 */
  const finishWithText = useCallback((text: string) => {
    const rows = parseLabReport(text);
    if (!rows.length) { setPhase({ s: 'empty', text }); return; }
    // 日期解不出来就用今天 —— 但这是**用户可见可改**的一个输入框,不是背地里替他定的。
    setPhase({ s: 'confirm', rows: rows.map((x) => ({ ...x, keep: true })), date: findReportDate(text) || today() });
  }, []);

  const run = useCallback(async (file: File) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    // ── PDF ────────────────────────────────────────────────────────────────
    // 2026-07-29:用户问「也可以是上传的 pdf 么」。能,而且**多数情况比拍照更好** ——
    // 医院系统出的 PDF 带文字层,直接读文字:零 OCR 误差、不用端上 Vision、网页端也能用。
    // 只有扫描件(整页是一张图)才退回 Vision 那条路。
    if (isPdf) {
      setPhase({ s: 'reading', step: 'pdf' });
      let read;
      try {
        read = await readLabPdf(file);
      } catch {
        setPhase({ s: 'failed', message: t('这份 PDF 打不开 —— 可能是加密的,或者文件不完整。',
          'Could not open this PDF — it may be encrypted or incomplete.') });
        return;
      }

      if (read.kind === 'text') { finishWithText(read.lines.join('\n')); return; }

      // 扫描件:每页渲染成图,逐张过端上识别
      const avail = await visionAvailability();
      if (!avail.available) {
        pendingImagesRef.current = read.images;   // 用户点头之后才发得出去
        setPhase({ s: 'blocked', reason: avail.reason || 'plugin_missing', fromScan: true });
        return;
      }
      setPhase({ s: 'reading', step: 'ocr' });
      const texts: string[] = [];
      for (const img of read.images) {
        const r = await recognizeOnDevice(img);
        if (!r.ok) { setPhase({ s: 'failed', message: r.message }); return; }
        texts.push(r.text);
      }
      finishWithText(texts.join('\n'));
      return;
    }

    // ── 图片 ───────────────────────────────────────────────────────────────
    setPhase({ s: 'reading', step: 'ocr' });
    const avail = await visionAvailability();
    if (!avail.available) {
      pendingImagesRef.current = [file];
      setPhase({ s: 'blocked', reason: avail.reason || 'plugin_missing' });
      return;
    }

    const r = await recognizeOnDevice(file);
    if (!r.ok) { setPhase({ s: 'failed', message: r.message }); return; }
    finishWithText(r.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishWithText, dict]);

  const reset = () => {
    setPhase({ s: 'pick' });
    setSaveErr(null);
    pendingImagesRef.current = [];   // 没被同意发出去的化验单不留在内存里
  };

  /**
   * 用户**这一次**同意把这张化验单发到云端认字。
   *
   * 三条约束写在这儿,改的时候一起看:
   *   ① 只有从 `asking` 这一步点进来 —— 也就是屏幕上刚说过一遍「这是病历」;
   *   ② 云只认字(`mode: 'ocr'`),判定仍走本机 parseLabReport;
   *   ③ 用完就把图从内存里清掉,**不记住这次选择** —— 下一张要重新问。
   */
  const sendToCloud = useCallback(async () => {
    const imgs = pendingImagesRef.current;
    if (!imgs.length) {
      setPhase({ s: 'failed', message: t('这张图已经不在手边了 —— 再选一次就行。', 'That image is no longer held — pick it again.') });
      return;
    }
    setPhase({ s: 'sending' });
    const toBase64 = (b: Blob | string) => (typeof b === 'string'
      ? Promise.resolve(b.includes(',') ? b.split(',')[1] : b)
      : new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('read_failed'));
        r.readAsDataURL(b);
      }));
    try {
      const texts: string[] = [];
      for (const img of imgs) {
        const base64 = await toBase64(img);
        const res = await fetch('/api/portal/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
          body: JSON.stringify({
            type: 'image', mode: 'ocr', content: '', imageBase64: base64,
            mimeType: typeof img === 'string' ? 'image/png' : (img.type || 'image/jpeg'),
          }),
        });
        const data = await res.json() as { ok?: boolean; text?: string };
        if (!res.ok || !data.ok || !data.text) {
          // 红线:失败要说出来,不许静默回到「认不了」那一屏假装什么都没发生。
          setPhase({ s: 'failed', message: t('云端这次也没认出来 —— 可以换一张更清楚的,或者手填。',
            "The cloud couldn't read it either — try a clearer photo, or type it in.") });
          return;
        }
        texts.push(data.text);
      }
      pendingImagesRef.current = [];   // 发完就清:不留副本
      finishWithText(texts.join('\n'));
    } catch {
      setPhase({ s: 'failed', message: t('没连上 —— 网络回来再试,或者手填。', 'Could not connect — try again later, or type it in.') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishWithText, dict]);

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
              {t('拍一张,或直接选体检中心给的 PDF。全程在这台设备上完成,文件不会离开。',
                'Take a photo, or pick the PDF your lab sent. Everything runs on this device — the file never leaves.')}
            </p>
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-3)' }}
              onClick={() => fileRef.current?.click()}>
              {t('拍照', 'Take a photo')}
            </button>
            <button type="button" className="nesio-rel-log-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
              onClick={() => pdfRef.current?.click()}>
              {t('选文件 · PDF 或图片', 'Choose a file · PDF or image')}
            </button>
            <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-2)' }}>
              {t('带文字的 PDF 是直接读文字的 —— 比拍照准,也不需要端上识别。',
                'A text-based PDF is read directly — more accurate than a photo, and no on-device OCR needed.')}
            </p>
            <button type="button" className="nesio-rel-log-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={goManual}>
              {t('手填也行', 'Type it in instead')}
            </button>
          </>
        )}

        {phase.s === 'reading' && (
          <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
            {phase.step === 'pdf'
              ? t('在读这份 PDF…', 'Reading the PDF…')
              : t('在这台设备上认字…', 'Reading on this device…')}
          </p>
        )}

        {/* 端上不可用:说清楚为什么 + 给出路。绝不偷偷改走云端。 */}
        {phase.s === 'blocked' && (
          <div role="alert">
            {phase.fromScan && (
              <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
                {t('这份 PDF 是扫描件(整页就是一张图),没有可以直接读的文字 —— 只能走识别。',
                  'This PDF is a scan (each page is an image) with no text to read — it needs OCR.')}
              </p>
            )}
            <p className="nesio-rel-detail-err" style={{ marginTop: phase.fromScan ? 'var(--space-1)' : 0 }}>{unavailableMessage(phase.reason)}</p>
            {/* 主按钮仍然是手填 —— 默认不发。云那条是次要出口,而且要再点一次。 */}
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={goManual}>
              {t('手填这张单子', 'Type this report in')}
            </button>
            {pendingImagesRef.current.length > 0 && (
              <button type="button" className="nesio-rel-log-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
                onClick={() => setPhase({ s: 'asking', reason: phase.reason, fromScan: phase.fromScan })}>
                {t('或者:发到云端认一次', 'Or: send to the cloud to read it once')}
              </button>
            )}
          </div>
        )}

        {/* 真发之前把话说明白。**每一张都要走这一步** —— 没有「以后不再问」。 */}
        {phase.s === 'asking' && (
          <div>
            <p style={{ fontSize: 'var(--text-body)', color: 'var(--portal-ink)', margin: 0, lineHeight: 1.7, fontWeight: 'var(--weight-semibold)' as unknown as number }}>
              {t('这张化验单会发到云端认字。', 'This lab report will be sent to the cloud to be read.')}
            </p>
            <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-2)', lineHeight: 1.7 }}>
              {t('化验单是病历 —— 上面有你的姓名、日期和各项数值。这一次发出去,只用来认字;'
                + '认出来之后判「哪项偏高」仍然在这台设备上做,数值不会交给云去解读。'
                + '每一张都会重新问一次,不会记住这次的选择。',
                'A lab report is a medical record — it carries your name, dates and values. '
                + 'This one send is only to transcribe the text; deciding what is out of range still happens on this device. '
                + 'You will be asked again for every report — this choice is not remembered.')}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }}
                onClick={() => setPhase({ s: 'blocked', reason: phase.reason, fromScan: phase.fromScan })}>
                {t('算了', 'No')}
              </button>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={() => void sendToCloud()}>
                {t('发出去认这一张', 'Send this one')}
              </button>
            </div>
          </div>
        )}

        {phase.s === 'sending' && (
          <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>
            {t('发出去认字中…', 'Sending to be read…')}
          </p>
        )}

        {phase.s === 'failed' && (
          <div role="alert">
            <p className="nesio-rel-detail-err" style={{ marginTop: 0 }}>{phase.message}</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => pdfRef.current?.click()}>
                {t('换一个文件', 'Try another file')}
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
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => pdfRef.current?.click()}>
                {t('换一个文件', 'Try another file')}
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
            <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
              {t('逐项核一眼再入库 —— 认错一个数字,后面的曲线就跟着错。', 'Check each row before saving — one wrong number skews every curve after it.')}
            </p>

            <label className="nesio-settings-section-label" htmlFor="ls-who" style={{ marginTop: 'var(--space-3)' }}>{t('这是谁的', 'Whose')}</label>
            <select id="ls-who" className="nesio-ob-input" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value={SELF_PERSON_KEY}>{t('我', 'Me')}</option>
              {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>

            <label className="nesio-settings-section-label" htmlFor="ls-date" style={{ marginTop: 'var(--space-3)' }}>{t('化验日期', 'Report date')}</label>
            <input id="ls-date" className="nesio-ob-input" type="date" value={phase.date}
              onChange={(e) => setPhase((c) => (c.s === 'confirm' ? { ...c, date: e.target.value } : c))} />

            <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-4)' }}>{t('逐项确认', 'Row by row')}</p>
            {phase.rows.map((r, i) => {
              const off = r.flag === 'high' || r.flag === 'low';
              return (
                <div key={i} className="nesio-health-card" style={{ gridColumn: '1 / -1', marginBottom: 'var(--space-2)', opacity: r.keep ? 1 : 0.45 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <input type="checkbox" checked={r.keep} aria-label={t(`收下「${r.name}」`, `Keep ${r.name}`)}
                      onChange={(e) => patch(i, { keep: e.target.checked })} />
                    <input className="nesio-ob-input" style={{ flex: 1 }} value={r.name} maxLength={40}
                      aria-label={t('指标名', 'Metric name')}
                      onChange={(e) => patch(i, { name: e.target.value })} />
                    {/* 偏离参考区间:amber。日常偏高不是风险,不用红。 */}
                    {off && (
                      <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)',
                        borderRadius: 'var(--radius-pill)', background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>
                        {r.flag === 'high' ? t('偏高', 'High') : t('偏低', 'Low')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <input className="nesio-ob-input" style={{ flex: 2 }} inputMode="decimal" value={String(r.value)}
                      aria-label={t('数值', 'Value')}
                      onChange={(e) => patch(i, { value: Number(e.target.value) })} />
                    {/* 单位那格要比数值宽:「10^9/L」「mmol/L」在等宽四格里会被截成
                        「10^9」「mmol」—— 值是全的,但看起来像解析漏了。 */}
                    <input className="nesio-ob-input" style={{ flex: 1.6 }} value={r.unit || ''} maxLength={16} placeholder={t('单位', 'Unit')}
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
                    <span className="nesio-health-card-range" style={{ display: 'block', marginTop: 'var(--space-1)' }}>
                      {t('原文:', 'Read as: ')}{r.raw}
                    </span>
                  )}
                </div>
              );
            })}

            {saveErr && <p className="nesio-rel-detail-err" role="alert">{saveErr}</p>}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
                {t('重拍', 'Retake')}
              </button>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} disabled={busy} onClick={commit}>
                {busy ? t('存着…', 'Saving…') : t(`确认入库 · ${phase.rows.filter((r) => r.keep).length} 项`, `Save ${phase.rows.filter((r) => r.keep).length}`)}
              </button>
            </div>
          </>
        )}

        {/* 两个 input 是有意分开的:带 capture 的那个在手机上会**直接开相机**,
            选不到文件管理器里的 PDF。想选 PDF 必须有一个不带 capture 的。 */}
        <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="nesio-visually-hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void run(f);
          }} />

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="nesio-visually-hidden"
          onChange={(e) => {
            // 先把 File 抓出来再清 value —— 反了的话 FileList 当场变空,表现是「点了没反应」。踩过。
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void run(f);
          }} />

        <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          {t('读取与识别都在本机完成 · 健康信息参考,不作诊断', 'Reading and recognition run on-device · for reference, not a diagnosis')}
        </p>
      </div>
    </NesioSheet>
  );
}
