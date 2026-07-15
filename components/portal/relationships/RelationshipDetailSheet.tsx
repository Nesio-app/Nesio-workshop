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
import { setRelationshipOverride, type OverrideCloseness } from '@/lib/portal/relationship-overrides';
import { mergeEntity } from '@/lib/portal/entity-resolution';
import {
  loadPersonRecords, deletePersonRecord,
  RECORD_CATEGORY_MAP, type PersonRecord,
} from '@/lib/portal/person-records';
import RelationGraph from '../RelationGraph';
import { RecordCatIcon } from './record-icons';
import HangNoteSheet from './HangNoteSheet';
import { IconLock } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { useSheetDrag } from '../use-sheet-drag';

interface Props {
  contactKey: string | null;
  onClose: () => void;
}

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
  const [records, setRecords] = useState<PersonRecord[]>([]);
  const [hangOpen, setHangOpen] = useState(false); // 「挂一条」独立确认卡弹窗
  const [relDraft, setRelDraft] = useState(''); // 图4:关系词编辑草稿
  const [mergeDraft, setMergeDraft] = useState(''); // 数据审计 #4:合并同一个人的另一个名字
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  const rebuild = () => {
    if (!contactKey) { setProfile(null); setRecords([]); return; }
    const prof = buildPersonProfile(getLifeGraph(), contactKey);
    setProfile(prof);
    setRelDraft(prof?.contact?.relation ?? '');
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

  // 数据审计 #4:把「另一个名字」并到当前联系人 —— 未来这些提及都收敛到这个人。合并后关掉详情
  // (面板会随 ENTITY_ALIASES_EVENT 重新派生),避免停留在已被并走的旧 key 上。
  const doMerge = () => {
    const other = mergeDraft.trim();
    if (!other) return;
    mergeEntity(other, p.key); // other 是 alias → 归到当前人(canonical)
    setMergeDraft('');
    onClose();
  };

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

  const removeRecord = (id: string) => deletePersonRecord(id);

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
      <div className={`nesio-settings-sheet-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />

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

          {/* 图4:关系可改 —— 亲疏三档 + 关系词(推错时手动校正,只存本机) */}
          {c && (
            <div className="nesio-fit-panel" style={{ marginTop: '0.5rem' }}>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '关系 · 可修改', 'Relationship · editable')}</p>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
                {(['core', 'close', 'acquaintance'] as OverrideCloseness[]).map((cl) => (
                  <button key={cl} type="button" aria-pressed={c.closeness === cl}
                    onClick={() => setRelationshipOverride(p.key, { closeness: cl })}
                    style={{ flex: 1, padding: '0.4rem 0', fontSize: '0.8rem', borderRadius: 'var(--radius-sm, 12px)', border: '1px solid var(--portal-line)', cursor: 'pointer',
                      background: c.closeness === cl ? 'var(--portal-accent-soft-md)' : 'transparent',
                      color: c.closeness === cl ? 'var(--portal-ink)' : 'var(--portal-muted)', fontWeight: c.closeness === cl ? 700 : 500 }}>
                    {L(dict, CLOSENESS_META[cl].zh, CLOSENESS_META[cl].en)}
                  </button>
                ))}
              </div>
              <input type="text" className="nesio-ob-input"
                placeholder={L(dict, '关系词,如:同事、大学同学(留空=自动)', 'Relationship, e.g. coworker (blank = auto)')}
                value={relDraft} maxLength={16}
                onChange={(e) => setRelDraft(e.target.value)}
                onBlur={() => setRelationshipOverride(p.key, { relation: relDraft.trim() })}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <p className="nesio-settings-option-hint" style={{ margin: '0.35rem 0 0' }}>
                {L(dict, '改了只影响这个人的亲疏与联系节奏,只存本机。', "Only affects this person's closeness & reminder cadence — stored on-device.")}
              </p>
              {/* 数据审计 #4:实体解析 —— 同一个人被记成两个名字(如「妈妈」和「母亲」)时,合并成一个 */}
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem' }}>
                <input type="text" className="nesio-ob-input" style={{ flex: 1 }}
                  placeholder={L(dict, '其实是同一个人?输入 TA 的另一个名字合并', 'Same person? Type their other name to merge')}
                  value={mergeDraft} maxLength={40}
                  onChange={(e) => setMergeDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doMerge(); }} />
                <button type="button" className="nesio-fin-review-accept" disabled={!mergeDraft.trim()} onClick={doMerge}>
                  {L(dict, '合并', 'Merge')}
                </button>
              </div>
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

          {/* 挂在 TA 身上(成绩/消费/位置/医疗/药物/健康)*/}
          <div style={{ marginTop: '1rem' }}>
            <div className="nesio-rel-rec-head">
              <p className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '挂在 TA 身上', 'Attached to them')}</p>
              <button type="button" className="nesio-rel-rec-add" onClick={() => setHangOpen(true)}>
                {L(dict, '＋ 挂一条', '＋ Add')}
              </button>
            </div>

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
            ) : (
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

      {hangOpen && (
        <HangNoteSheet
          personKey={p.key}
          personName={p.displayName}
          subtitle={[p.isFamily ? L(dict, '家庭', 'Family') : '', c ? L(dict, CLOSENESS_META[c.closeness].zh, CLOSENESS_META[c.closeness].en) : ''].filter(Boolean).join(' · ')}
          avatarInitial={initialOf(p.displayName)}
          onClose={() => setHangOpen(false)}
        />
      )}
    </div>
  );
}
