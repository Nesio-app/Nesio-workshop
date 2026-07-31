'use client';

/**
 * RelationshipDetailSheet — 人物详情页(人缘㊁)。从关系 tab 点一个联系人 → 滑出。
 * 身份头(头像/名字/关系/亲疏/家庭徽章/该联系 + 联系过了)+ 关键事实瓦片 + 关系网(ego 图)+ 时间线。
 * 读 buildPersonProfile 的后台档案(不 UI 现算);头像:自定义上传优先 → Google 照片 → 首字母兜底。
 * 只存本机、不调 AI。
 */

import { useEffect, useRef, useState } from 'react';
import { getLifeGraph, updateLifeNode } from '@/lib/portal/life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { buildPersonProfile, type PersonProfile } from '@/lib/portal/relationship-profile';
import { markContacted, lastContactLabel, CLOSENESS_META, RELATION_TAGS } from '@/lib/portal/relationships';
import { setRelationshipOverride, type OverrideCloseness } from '@/lib/portal/relationship-overrides';
import { mergeEntity } from '@/lib/portal/entity-resolution';
import {
  loadPersonRecords, deletePersonRecord,
  RECORD_CATEGORY_MAP, type PersonRecord,
} from '@/lib/portal/person-records';
import { removeContact } from '@/lib/portal/manual-contacts';
import { deleteLocalFile } from '@/lib/portal/local-file-store';
import RelationGraph from '../RelationGraph';
import { RecordCatIcon } from './record-icons';
import HangNoteSheet from './HangNoteSheet';
import ContactEditSheet from './ContactEditSheet';
import PersonLinksSection from './PersonLinksSection';
import { IconLock } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';

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
  const [editOpen, setEditOpen] = useState(false); // 编辑资料(名字/邮箱/电话/生日/备注)
  const [relDraft, setRelDraft] = useState(''); // 图4:关系词编辑草稿
  const [mergeDraft, setMergeDraft] = useState(''); // 数据审计 #4:合并同一个人的另一个名字

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
        ingestLifeNode({
          type: 'person', name: p.displayName, source: 'manual', confidence: 0.9,
          attributes: { avatar: dataUrl, epistemic: 'observation', generator: 'user', ...(p.email ? { email: p.email } : {}) },
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

  // 删记录连附件一起删 —— 附件唯一副本在本机 IndexedDB,只删记录会留下永远取不回的孤儿 blob。
  const removeRecord = (id: string) => {
    const rec = records.find((r) => r.id === id);
    for (const a of rec?.attachments || []) void deleteLocalFile(a.assetId);
    deletePersonRecord(id);
  };

  const c = p.contact;
  // 关系标签(bug3):固定表 + 表外的当前值(推出来的英文关系词)当第一个 chip,能看见也能取消
  const relTags = relDraft && !RELATION_TAGS.some((t) => t.zh === relDraft)
    ? [{ zh: relDraft, en: relDraft }, ...RELATION_TAGS]
    : RELATION_TAGS;
  const personNode = p.nodeId ? getLifeGraph().find((n) => n.id === p.nodeId) : undefined;
  const attrStr = (k: string) => (typeof personNode?.attributes?.[k] === 'string' ? String(personNode.attributes[k]) : '');
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
    <>
      {/* 2026-07-28(标注 图20):「关系点不开详情」同因:详情本来就有(改亲疏/关系词/头像/合并同一个人),只是被洞察面板盖住看不见。 */}
      <NesioSheet
        variant="bottom"
        elevated
        open
        onOpenChange={(next) => { if (!next) onClose(); }}
        card={false}
        className="nesio-settings-sheet-card"
        ariaLabel={p.displayName}
      >

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
            ref={fileRef} type="file" accept="image/*" className="nesio-visually-hidden"
            onChange={(e) => { void onPickAvatar(e.target.files?.[0]); e.currentTarget.value = ''; }}
          />
          <div className="nesio-rel-detail-id">
            {/* bug3:「挂一条」改名「记录」并挪到名字同一行 —— 记一条是这页最常做的事,
                原来它埋在下面的分区标题右侧,要滚下去才看得到。 */}
            <div className="nesio-rel-detail-name-row">
              <h2 className="nesio-settings-sheet-title" style={{ margin: 0 }}>{p.displayName}</h2>
              <button type="button" className="nesio-rel-rec-add" onClick={() => setHangOpen(true)}>
                {L(dict, '记录', 'Log')}
              </button>
            </div>
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
            <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '关系 · 可修改', 'Relationship · editable')}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                {(['core', 'close', 'acquaintance'] as OverrideCloseness[]).map((cl) => (
                  <button key={cl} type="button" aria-pressed={c.closeness === cl}
                    onClick={() => setRelationshipOverride(p.key, { closeness: cl })}
                    style={{ flex: 1, padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-sm, 12px)', border: '1px solid var(--portal-line)', cursor: 'pointer',
                      background: c.closeness === cl ? 'var(--portal-accent-soft-md)' : 'transparent',
                      color: c.closeness === cl ? 'var(--portal-ink)' : 'var(--portal-muted)', fontWeight: c.closeness === cl ? 700 : 500 }}>
                    {L(dict, CLOSENESS_META[cl].zh, CLOSENESS_META[cl].en)}
                  </button>
                ))}
              </div>
              {/* bug3:关系词改成选 tag —— 表里没有的旧值(数据推出来的英文关系词)当第一个 chip 显示,点一下可取消 */}
              <div className="nesio-rel-chips" role="group" aria-label={L(dict, '关系', 'Relationship')}>
                {relTags.map((t) => {
                  const on = relDraft === t.zh;
                  return (
                    <button key={t.zh} type="button" aria-pressed={on}
                      className={`nesio-rel-chip${on ? ' nesio-rel-chip--on' : ''}`}
                      onClick={() => {
                        const next = on ? '' : t.zh;
                        setRelDraft(next);
                        setRelationshipOverride(p.key, { relation: next });
                      }}>
                      {L(dict, t.zh, t.en)}
                    </button>
                  );
                })}
              </div>
              {/* 数据审计 #4:实体解析 —— 同一个人被记成两个名字(如「妈妈」和「母亲」)时,合并成一个 */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
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

          {/* 挂在 TA 身上(成绩/消费/位置/医疗/药物/健康)。加入口已挪到名字行(bug3) */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '挂在 TA 身上', 'Attached to them')}</p>

            {records.length > 0 && (
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
                          {meta.sensitive ? L(dict, ' · 仅你可见', ' · only you') : ''}
                          {r.attachments?.length ? L(dict, ` · ${r.attachments.length} 个附件`, ` · ${r.attachments.length} file(s)`) : ''}
                        </span>
                      </div>
                      {meta.sensitive && (
                        <span className="nesio-rel-rec-local" title={L(dict, '仅你可见 · 不进 AI', 'Only you · never sent to AI')}><IconLock size={11} />{L(dict, '私密', 'Private')}</span>
                      )}
                      <button type="button" className="nesio-rel-rec-del" onClick={() => removeRecord(r.id)} aria-label={L(dict, '删除', 'Delete')}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 时间线 */}
          {p.timeline.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
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

          {/* 健康 / 家务活 关联(2026-07-29 People 升级)—— 点一个人能看到 TA 关联的东西 */}
          <PersonLinksSection personKey={p.key} email={p.email} />

          {/* 编辑 / 关联 / 移除。
              2026-07-29:移除按钮此前只在有 person 节点时才出现 —— 从邮件和 relations
              推出来的人(占大多数)根本没有移除入口。现在一律给,走 removeContact:
              有节点就真删,没节点标 hidden 让推导层跳过。否则「删了又回来」。 */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
            <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={() => setEditOpen(true)}>
              {L(dict, '编辑资料', 'Edit details')}
            </button>
            <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }}
              onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query: p.displayName } })); }}>
              {L(dict, '在记忆里找 TA ›', 'Find in memories ›')}
            </button>
            <button type="button"
              onClick={() => {
                if (!confirm(L(dict, `把「${p.displayName}」从关系里移除?提到 TA 的记忆不会删。`, `Remove “${p.displayName}” from relationships? Memories mentioning them stay.`))) return;
                // 删失败(存储写不进)不假装成功 —— 提示用户,详情页留着。
                if (removeContact(p.key, p.nodeId)) {
                  onClose();
                } else {
                  setUploadErr(L(dict, '没能移除 —— 本机存储写不进,过会儿再试。', 'Could not remove — local storage write failed. Try again.'));
                }
              }}
              style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--status-risk)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
              {L(dict, '从关系里移除', 'Remove')}
            </button>
          </div>

          <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
            {L(dict, '仅你可见 · 从你的记忆、邮件、通讯录推出', 'Only you · from your notes, email and contacts')}
          </p>
        </div>
      </NesioSheet>

      {/* 改名会换身份键 —— renameContact 把记录/覆盖/别名一起搬。改完 key 可能变了,
          详情页停在旧 key 上就成了空壳,所以直接关掉让面板按新 key 重新进。 */}
      <ContactEditSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        contactKey={p.key}
        nodeId={p.nodeId}
        initial={{
          name: p.displayName,
          email: p.email || '',
          birthday: p.birthday || '',
          relation: c?.relation || '',
          phone: attrStr('phone'),
          address: attrStr('address'),
          note: attrStr('note'),
        }}
        onSaved={(nextKey) => { if (nextKey !== p.key) onClose(); else rebuild(); }}
      />

      {hangOpen && (
        <HangNoteSheet
          personKey={p.key}
          personName={p.displayName}
          subtitle={[p.isFamily ? L(dict, '家庭', 'Family') : '', c ? L(dict, CLOSENESS_META[c.closeness].zh, CLOSENESS_META[c.closeness].en) : ''].filter(Boolean).join(' · ')}
          avatarInitial={initialOf(p.displayName)}
          onClose={() => setHangOpen(false)}
        />
      )}
    </>
  );
}
