'use client';

/**
 * RelationshipDetailSheet — 人物详情页(人缘㊁)。从关系 tab 点一个联系人 → 滑出。
 * 身份头(头像/名字/关系/亲疏/家庭徽章/该联系 + 联系过了)+ 关键事实瓦片 + 关系网(ego 图)+ 时间线。
 * 读 buildPersonProfile 的后台档案(不 UI 现算);头像:自定义上传优先 → Google 照片 → 首字母兜底。
 * 只存本机、不调 AI。
 */

import { useEffect, useRef, useState } from 'react';
import { getLifeGraph, addLifeNode, updateLifeNode } from '@/lib/portal/life-graph';
import { buildPersonProfile, type PersonProfile } from '@/lib/portal/relationship-profile';
import { markContacted, lastContactLabel, CLOSENESS_META } from '@/lib/portal/relationships';
import {
  loadPersonRecords, addPersonRecord, deletePersonRecord,
  RECORD_CATEGORIES, RECORD_CATEGORY_MAP, type PersonRecord, type PersonRecordCategory,
} from '@/lib/portal/person-records';
import { imageToDataUrl } from '@/lib/portal/image-util';
import RelationGraph from '../RelationGraph';
import { RecordCatIcon } from './record-icons';
import { IconLock, IconMic, IconCamera } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface Props {
  contactKey: string | null;
  onClose: () => void;
}

/** person-extract 路由返回的一条候选记录(客户端预览用)。 */
type ExtractedRecord = { category: PersonRecordCategory; title: string; detail?: string; date?: string; amount?: number };

/** 把上传的图缩到 ≤200px 的方图,输出 data URI(避免整张原图塞进节点属性)。 */
function downscaleToDataUrl(file: File, size = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no_ctx'));
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0].toUpperCase() : '·';
}

export default function RelationshipDetailSheet({ contactKey, onClose }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<PersonRecord[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ category: PersonRecordCategory; title: string; detail: string; date: string; amount: string }>(
    { category: 'achievement', title: '', detail: '', date: '', amount: '' },
  );
  // 「说一句自动识别」——AI 提取 → 预览 → 确认保存
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlErr, setNlErr] = useState<string | null>(null);
  const [pending, setPending] = useState<ExtractedRecord[] | null>(null);

  const rebuild = () => {
    if (!contactKey) { setProfile(null); setRecords([]); return; }
    setProfile(buildPersonProfile(getLifeGraph(), contactKey));
    setRecords(loadPersonRecords(contactKey));
  };

  useEffect(() => {
    rebuild();
    const onUpdate = () => rebuild();
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    window.addEventListener('nesio-person-records-updated', onUpdate);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener('nesio-person-records-updated', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactKey]);

  if (!contactKey || !profile) return null;
  const p = profile;
  const avatarSrc = p.avatar || p.photo || '';

  const onContacted = () => {
    markContacted(p.key);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    rebuild();
  };

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    setBusy(true);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      // 有 person 节点就富化;没有(纯关系推出的联系人)就为他建一个,好挂头像与后续数据
      if (p.nodeId) {
        const node = getLifeGraph().find((n) => n.id === p.nodeId);
        updateLifeNode(p.nodeId, { attributes: { ...(node?.attributes || {}), avatar: dataUrl } });
      } else {
        addLifeNode({
          type: 'person', name: p.displayName, source: 'manual', confidence: 0.9,
          attributes: { avatar: dataUrl, ...(p.email ? { email: p.email } : {}) },
          relations: [], tags: ['联系人'],
        });
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
      rebuild();
    } catch {
      setUploadErr(L(dict, '这张图没能设置成功,换一张再试试。', "Couldn't set that photo — try another."));
    } finally {
      setBusy(false);
    }
  };

  const saveRecord = () => {
    const title = form.title.trim();
    if (!title) return;
    addPersonRecord({
      personKey: p.key, category: form.category, title,
      ...(form.detail.trim() ? { detail: form.detail.trim() } : {}),
      ...(form.date ? { date: form.date } : {}),
      ...(form.amount && !Number.isNaN(Number(form.amount)) ? { amount: Number(form.amount) } : {}),
    });
    setForm({ category: form.category, title: '', detail: '', date: '', amount: '' });
    setAdding(false);
  };
  const removeRecord = (id: string) => deletePersonRecord(id);

  // 说一句 / 拍照片 → AI 提取候选记录(不直接落库,先预览让你确认)
  const doExtract = async (payload: { text?: string; image?: string }) => {
    setNlErr(null); setNlBusy(true); setPending(null);
    try {
      const res = await fetch('/api/portal/person-extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; records?: ExtractedRecord[] } | null;
      if (!res.ok || !data?.ok) throw new Error('extract_failed');
      const recs = Array.isArray(data.records) ? data.records : [];
      if (!recs.length) { setNlErr(L(dict, '没认出可记录的信息,换个说法/清晰点的照片,或用下面手动填。', "Couldn't find anything to log — rephrase or use a clearer photo, or add it manually below.")); return; }
      setPending(recs);
    } catch {
      setNlErr(L(dict, '识别没成功,稍后再试,或手动填。', "Couldn't process that — try again, or add it manually."));
    } finally { setNlBusy(false); }
  };
  const runExtract = () => {
    const text = nlText.trim();
    if (!text || nlBusy) return;
    void doExtract({ text });
  };
  const onPickPhoto = async (file: File | undefined) => {
    if (!file || nlBusy) return;
    setNlErr(null); setNlBusy(true); setPending(null);
    try {
      const image = await imageToDataUrl(file);
      await doExtract({ image, ...(nlText.trim() ? { text: nlText.trim() } : {}) });
    } catch {
      setNlErr(L(dict, '这张图没能读取,换一张再试。', "Couldn't read that image — try another."));
      setNlBusy(false);
    }
  };
  const savePending = () => {
    if (!pending) return;
    for (const r of pending) {
      addPersonRecord({ personKey: p.key, category: r.category, title: r.title,
        ...(r.detail ? { detail: r.detail } : {}), ...(r.date ? { date: r.date } : {}),
        ...(typeof r.amount === 'number' ? { amount: r.amount } : {}) });
    }
    setPending(null); setNlText(''); setAdding(false);
  };

  const c = p.contact;
  // 3 stats(设计稿):上次联系 / 提到 N次 / 认识 N天。认识天数 = 距最早往来记录的天数。
  const knownDays = (() => {
    const times = p.timeline.map((t) => (t.at ? Date.parse(t.at) : NaN)).filter((n) => Number.isFinite(n));
    if (!times.length) return null;
    return Math.max(0, Math.floor((Date.now() - Math.min(...times)) / 86_400_000));
  })();
  const stats: Array<{ label: string; value: string }> = [];
  if (c) stats.push({ label: L(dict, '上次联系', 'Last'), value: lastContactLabel(c, dict) });
  if (c) stats.push({ label: L(dict, '提到', 'Mentions'), value: L(dict, `${c.mentions} 次`, `${c.mentions}×`) });
  if (knownDays != null) stats.push({ label: L(dict, '认识', 'Known'), value: L(dict, `${knownDays} 天`, `${knownDays}d`) });

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={p.displayName}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        {/* 身份头 */}
        <div className="nesio-rel-detail-head">
          <button
            type="button"
            className="nesio-rel-avatar"
            onClick={() => fileRef.current?.click()}
            aria-label={L(dict, '上传头像', 'Set photo')}
            title={L(dict, '点一下换头像', 'Tap to set a photo')}
          >
            {avatarSrc
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarSrc} alt={p.displayName} className="nesio-rel-avatar-img" draggable={false} />
              : <span className="nesio-rel-avatar-initial">{initialOf(p.displayName)}</span>}
            <span className="nesio-rel-avatar-edit" aria-hidden>{busy ? '…' : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            )}</span>
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { void onPickAvatar(e.target.files?.[0]); e.currentTarget.value = ''; }}
          />
          <div className="nesio-rel-detail-id">
            <h2 className="nesio-settings-sheet-title" style={{ margin: 0 }}>{p.displayName}</h2>
            <div className="nesio-rel-detail-pills">
              {p.isFamily && <span className="nesio-rel-pill nesio-rel-pill--fam">{L(dict, '家庭', 'Family')}</span>}
              {c && <span className="nesio-rel-pill">{L(dict, CLOSENESS_META[c.closeness].zh, CLOSENESS_META[c.closeness].en)}</span>}
              {c?.relation && <span className="nesio-rel-pill nesio-rel-pill--rel">{c.relation}</span>}
              {c?.reachOut && <span className="nesio-rel-pill nesio-rel-pill--due">{L(dict, '该联系了', 'Reach out')}</span>}
            </div>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>

        <div className="nesio-settings-sheet-body">
          {uploadErr && <p className="nesio-rel-detail-err" role="alert">{uploadErr}</p>}

          {c?.reachOut && (
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%' }} onClick={onContacted}>
              {L(dict, '联系过了', 'Reached out')}
            </button>
          )}

          {/* 3 stats:上次联系 / 提到 / 认识(设计稿) */}
          {stats.length > 0 && (
            <div className="nesio-rel-stats">
              {stats.map((s, i) => (
                <div key={i} className="nesio-rel-stat">
                  <span className="nesio-rel-stat-label">{s.label}</span>
                  <span className="nesio-rel-stat-value">{s.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* 关系网(ego) */}
          {p.ego.nodes.length > 1 && (
            <div className="nesio-related-section">
              <p className="nesio-settings-section-label">{L(dict, '关系网', 'Connections')}</p>
              <RelationGraph
                nodes={p.ego.nodes}
                edges={p.ego.edges}
                focusId={p.ego.nodes[0].id}
                height={220}
                emptyText={L(dict, '还没有关系连接', 'No connections yet')}
              />
            </div>
          )}

          {/* 按人分类的数据(成绩/消费/位置/医疗/药物/健康)*/}
          <div style={{ marginTop: '1rem' }}>
            <div className="nesio-rel-rec-head">
              <p className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '挂在 TA 身上的信息', 'Attached info')}</p>
              <button type="button" className="nesio-rel-rec-add" onClick={() => setAdding((v) => !v)}>
                {adding ? L(dict, '取消', 'Cancel') : L(dict, '＋ 挂一条', '＋ Add')}
              </button>
            </div>

            {adding && (
              <div className="nesio-rel-rec-form">
                {/* 说一句 → 自动识别 */}
                <textarea
                  className="nesio-rel-rec-input" rows={2}
                  placeholder={L(dict, '说一句,自动识别(如「期末年级第一 6月2日」「每天一片氨氯地平」)', 'Describe it (e.g. "1st in grade, Jun 2")')}
                  value={nlText} onChange={(e) => setNlText(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                    onClick={runExtract} disabled={nlBusy}
                  >
                    <IconMic size={15} />{nlBusy ? L(dict, '识别中…', 'Reading…') : L(dict, '说一句', 'From text')}
                  </button>
                  <button
                    type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                    onClick={() => photoRef.current?.click()} disabled={nlBusy}
                  >
                    <IconCamera size={15} />{L(dict, '拍/传', 'Photo')}
                  </button>
                </div>
                <input
                  ref={photoRef} type="file" accept="image/*" capture="environment" hidden
                  onChange={(e) => { void onPickPhoto(e.target.files?.[0]); e.currentTarget.value = ''; }}
                />
                {nlErr && <p className="nesio-rel-detail-err" role="alert">{nlErr}</p>}
                {pending && pending.length > 0 && (
                  <div className="nesio-rel-rec-list" style={{ marginTop: 0 }}>
                    <p className="nesio-settings-option-hint" style={{ margin: 0 }}>
                      {L(dict, `识别到以下,确认存到 ${p.displayName}:`, `Detected — save to ${p.displayName}?`)}
                    </p>
                    {pending.map((r, i) => {
                      const meta = RECORD_CATEGORY_MAP[r.category];
                      return (
                        <div key={i} className="nesio-rel-rec-row">
                          <span className="nesio-rel-rec-ic"><RecordCatIcon category={r.category} size={16} /></span>
                          <div className="nesio-rel-rec-main">
                            <span className="nesio-rel-rec-title">{r.title}{typeof r.amount === 'number' ? ` · ${r.amount}` : ''}</span>
                            {(r.detail || r.date) && <span className="nesio-rel-rec-sub">{r.date || ''}{r.detail ? `${r.date ? ' · ' : ''}${r.detail}` : ''}</span>}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                      <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={savePending}>{L(dict, '保存这些', 'Save these')}</button>
                      <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => setPending(null)}>{L(dict, '丢弃', 'Discard')}</button>
                    </div>
                  </div>
                )}
                <p className="nesio-settings-option-hint" style={{ margin: '0.2rem 0', textAlign: 'center' }}>{L(dict, '— 或手动填 —', '— or fill manually —')}</p>

                <div className="nesio-rel-chips">
                  {RECORD_CATEGORIES.map((cat) => (
                    <button key={cat.key} type="button"
                      className={`nesio-rel-chip${form.category === cat.key ? ' nesio-rel-chip--on' : ''}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      onClick={() => setForm((f) => ({ ...f, category: cat.key }))}>
                      <RecordCatIcon category={cat.key} size={13} /> {L(dict, cat.zh, cat.en)}
                    </button>
                  ))}
                </div>
                <input className="nesio-rel-rec-input" placeholder={L(dict, '标题(如「期末年级第一」)', 'Title')} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                <input className="nesio-rel-rec-input" placeholder={L(dict, '备注(可选)', 'Note (optional)')} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input className="nesio-rel-rec-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={{ flex: 1 }} />
                  {RECORD_CATEGORY_MAP[form.category].money && (
                    <input className="nesio-rel-rec-input" type="number" inputMode="decimal" placeholder={L(dict, '金额', 'Amount')} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={{ flex: 1 }} />
                  )}
                </div>
                {RECORD_CATEGORY_MAP[form.category].sensitive && (
                  <p className="nesio-rel-rec-sensitive" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><IconLock size={12} />{L(dict, '敏感信息:只存本机,不进 AI、不上传', 'Sensitive — on-device only, never sent to AI')}</p>
                )}
                <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.4rem' }} onClick={saveRecord}>{L(dict, '保存', 'Save')}</button>
              </div>
            )}

            {records.length > 0 ? (
              <div className="nesio-rel-rec-list">
                {records.map((r) => {
                  const meta = RECORD_CATEGORY_MAP[r.category];
                  return (
                    <div key={r.id} className="nesio-rel-rec-row">
                      <span className="nesio-rel-rec-ic" title={L(dict, meta.zh, meta.en)}><RecordCatIcon category={r.category} size={16} /></span>
                      <div className="nesio-rel-rec-main">
                        <span className="nesio-rel-rec-title">{r.title}{typeof r.amount === 'number' ? ` · ${r.amount}` : ''}</span>
                        <span className="nesio-rel-rec-sub">
                          {L(dict, meta.zh, meta.en)}
                          {r.date ? ` · ${new Date(r.date).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })}` : ''}
                          {r.detail ? ` · ${r.detail}` : ''}
                          {meta.sensitive ? L(dict, ' · 只存本机', ' · on-device') : ''}
                        </span>
                      </div>
                      {meta.sensitive && (
                        <span className="nesio-rel-rec-local" title={L(dict, '只存本机', 'On-device only')}><IconLock size={11} />{L(dict, '本机', 'Local')}</span>
                      )}
                      <button type="button" className="nesio-rel-rec-del" onClick={() => removeRecord(r.id)} aria-label={L(dict, '删除', 'Delete')}>✕</button>
                    </div>
                  );
                })}
              </div>
            ) : !adding && (
              <p className="nesio-settings-option-hint" style={{ margin: '0.3rem 0 0' }}>
                {L(dict, '把成绩、消费、位置,或医疗/药物/健康按人记在这里(敏感项只存本机)。', 'Attach achievements, spending, places — or medical/medication/health, per person (sensitive stays on-device).')}
              </p>
            )}
          </div>

          {/* 时间线 */}
          {p.timeline.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p className="nesio-settings-section-label">{L(dict, '往来', 'Timeline')}</p>
              <div className="nesio-rel-timeline">
                {p.timeline.map((t, i) => (
                  <div key={i} className="nesio-rel-tl-row">
                    <span className="nesio-rel-tl-date">
                      {t.at ? new Date(t.at).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : '—'}
                    </span>
                    <span className="nesio-rel-tl-text">{t.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
            {L(dict, '只存本机 · 从你的记忆、邮件、通讯录推出', 'On-device only · from your notes, email and contacts')}
          </p>
        </div>
      </div>
    </div>
  );
}
