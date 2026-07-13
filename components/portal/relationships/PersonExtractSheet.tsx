'use client';

/**
 * PersonExtractSheet — 全局「记给某人」(拍一拍入档 1c)。从关系 tab 顶部打开:
 * 拍一张 / 说一句 → person-extract 提取 {personName, records} → 跨人名匹配到联系人
 * (可改选)→ 预览 → 确认存进那个人档案。不用先点进某个人。
 * 只存本机;AI 提取走 guardAiRoute。
 */
import { useMemo, useRef, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { buildRelationships } from '@/lib/portal/relationships';
import { addPersonRecord, RECORD_CATEGORY_MAP, type PersonRecordCategory } from '@/lib/portal/person-records';
import { RecordCatIcon } from './record-icons';
import { IconMic, IconCamera } from '../icons';
import { imageToDataUrl } from '@/lib/portal/image-util';
import { matchPerson } from '@/lib/portal/person-match';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Extracted = { category: PersonRecordCategory; title: string; detail?: string; date?: string; amount?: number };

export default function PersonExtractSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const contacts = useMemo(() => (open ? buildRelationships(getLifeGraph()).map((c) => ({ key: c.key, name: c.name })) : []), [open]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Extracted[] | null>(null);
  const [personKey, setPersonKey] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const doExtract = async (payload: { text?: string; image?: string }) => {
    setErr(null); setBusy(true); setPending(null);
    try {
      const res = await fetch('/api/portal/person-extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; personName?: string; records?: Extracted[] } | null;
      if (!res.ok || !data?.ok) throw new Error('extract_failed');
      const recs = Array.isArray(data.records) ? data.records : [];
      if (!recs.length) { setErr(L(dict, '没认出可记录的信息,换个说法/清晰点的照片。', "Couldn't find anything to log — rephrase or use a clearer photo.")); return; }
      const matched = matchPerson(data.personName || '', contacts);
      setPersonKey(matched || contacts[0]?.key || '');
      setPending(recs);
    } catch {
      setErr(L(dict, '识别没成功,稍后再试。', "Couldn't process that — try again."));
    } finally { setBusy(false); }
  };
  const runText = () => { const t = text.trim(); if (t && !busy) void doExtract({ text: t }); };
  const onPickPhoto = async (file: File | undefined) => {
    if (!file || busy) return;
    setErr(null); setBusy(true); setPending(null);
    try { await doExtract({ image: await imageToDataUrl(file), ...(text.trim() ? { text: text.trim() } : {}) }); }
    catch { setErr(L(dict, '这张图没能读取,换一张。', "Couldn't read that image.")); setBusy(false); }
  };
  const save = () => {
    if (!pending || !personKey) return;
    for (const r of pending) {
      addPersonRecord({ personKey, category: r.category, title: r.title,
        ...(r.detail ? { detail: r.detail } : {}), ...(r.date ? { date: r.date } : {}),
        ...(typeof r.amount === 'number' ? { amount: r.amount } : {}) });
    }
    setPending(null); setText(''); onClose();
  };

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '记给某人', 'Log to a person')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '拍一张 / 说一句,记给某人', 'Snap or say it — log to a person')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>

        <div className="nesio-settings-sheet-body">
          <div className="nesio-rel-rec-form">
            <textarea
              className="nesio-rel-rec-input" rows={2}
              placeholder={L(dict, '说一句(如「小美期末年级第一」「爸爸每天一片氨氯地平」),或直接拍照片', 'Describe it, or take a photo')}
              value={text} onChange={(e) => setText(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }} onClick={runText} disabled={busy}>
                <IconMic size={15} />{busy ? L(dict, '识别中…', 'Reading…') : L(dict, '说一句', 'From text')}
              </button>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }} onClick={() => photoRef.current?.click()} disabled={busy}>
                <IconCamera size={15} />{L(dict, '拍/传', 'Photo')}
              </button>
            </div>
            <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => { void onPickPhoto(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            {err && <p className="nesio-rel-detail-err" role="alert">{err}</p>}
          </div>

          {pending && pending.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '记给谁', 'Log to')}</p>
              <select className="nesio-rel-rec-input" value={personKey} onChange={(e) => setPersonKey(e.target.value)}>
                {contacts.length === 0 && <option value="">{L(dict, '(没有联系人)', '(no contacts)')}</option>}
                {contacts.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>

              <p className="nesio-settings-section-label">{L(dict, '识别到', 'Detected')}</p>
              <div className="nesio-rel-rec-list">
                {pending.map((r, i) => {
                  const meta = RECORD_CATEGORY_MAP[r.category];
                  return (
                    <div key={i} className="nesio-rel-rec-row">
                      <span className="nesio-rel-rec-ic"><RecordCatIcon category={r.category} size={16} /></span>
                      <div className="nesio-rel-rec-main">
                        <span className="nesio-rel-rec-title">{r.title}{typeof r.amount === 'number' ? ` · ${r.amount}` : ''}</span>
                        <span className="nesio-rel-rec-sub">
                          {L(dict, meta.zh, meta.en)}
                          {r.date ? ` · ${r.date}` : ''}{r.detail ? ` · ${r.detail}` : ''}
                          {meta.sensitive ? L(dict, ' · 只存本机', ' · on-device') : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={save} disabled={!personKey}>{L(dict, '保存', 'Save')}</button>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => setPending(null)}>{L(dict, '重来', 'Redo')}</button>
              </div>
            </div>
          )}

          <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
            {L(dict, '只存本机 · 敏感项(医疗/药物/健康)不上传', 'On-device only · sensitive items never leave your device')}
          </p>
        </div>
      </div>
    </div>
  );
}
