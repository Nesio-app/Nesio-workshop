'use client';

/**
 * FamilyDataCard — 家人数据切换卡(人缘 3)。放进 Health / Finance 版面:
 * 列出有相关数据的家庭成员(健康=医疗/药物/健康;消费=spending)+ 近期动态,
 * 点成员进详情(切换人员看/加)。复用 family-digest + 人物详情页。只存本机。
 * 没有相关数据时返回 null(不打扰、不改变原版面)。
 */
import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { buildRelationships } from '@/lib/portal/relationships';
import { buildFamilyDigest, type FamilyDigest } from '@/lib/portal/family-digest';
import { type PersonRecordCategory } from '@/lib/portal/person-records';
import { RecordCatIcon } from './record-icons';
import RelationshipDetailSheet from './RelationshipDetailSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const HEALTH_CATS: PersonRecordCategory[] = ['medical', 'medication', 'health'];
const SPEND_CATS: PersonRecordCategory[] = ['spending'];

export default function FamilyDataCard({ kind }: { kind: 'health' | 'spend' }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const cats = kind === 'health' ? HEALTH_CATS : SPEND_CATS;
  const catSet = new Set<PersonRecordCategory>(cats);
  const [digest, setDigest] = useState<FamilyDigest>({ members: [], recent: [] });
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    const rebuild = () => setDigest(buildFamilyDigest(buildRelationships(getLifeGraph())));
    rebuild();
    window.addEventListener('nesio-person-records-updated', rebuild);
    window.addEventListener('nesio-life-graph-updated', rebuild);
    return () => {
      window.removeEventListener('nesio-person-records-updated', rebuild);
      window.removeEventListener('nesio-life-graph-updated', rebuild);
    };
  }, []);

  const members = digest.members
    .map((m) => ({ m, relevant: cats.reduce((s, c) => s + (m.counts[c] || 0), 0) }))
    .filter((x) => x.relevant > 0)
    .map((x) => x.m);
  if (!members.length) return null;

  const recent = digest.recent.filter((r) => catSet.has(r.record.category)).slice(0, 5);
  const title = kind === 'health'
    ? L(dict, '家人健康 · 用药', 'Family health')
    : L(dict, '家人消费', 'Family spending');

  return (
    <div className="nesio-fit-panel" style={{ marginTop: 'var(--space-2)' }}>
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{title}</p>
      <div className="nesio-fam-members">
        {members.map((m) => (
          <button key={m.key} type="button" className="nesio-fam-chip" onClick={() => setOpenKey(m.key)}>
            <span className="nesio-fam-chip-name">{m.name}</span>
            <span className="nesio-fam-chip-cats">
              {cats.map((c) => (m.counts[c] ? <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><RecordCatIcon category={c} size={12} />{m.counts[c]}</span> : null))}
            </span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="nesio-rel-timeline" style={{ marginTop: 'var(--space-2)' }}>
          {recent.map((item) => {
            const d = item.record.date || item.record.createdAt;
            return (
              <button key={item.record.id} type="button" className="nesio-fam-tl-row" onClick={() => setOpenKey(item.personKey)}>
                <span className="nesio-rel-tl-date">{new Date(d).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })}</span>
                <span className="nesio-rel-tl-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <RecordCatIcon category={item.record.category} size={13} /> <b>{item.personName}</b> · {item.record.title}{typeof item.record.amount === 'number' ? ` · ${item.record.amount}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
        {L(dict, '点进去看 / 加(拍一张也行)· 仅你可见', 'Tap to view or add (photo works too) · only you')}
      </p>
      {openKey && <RelationshipDetailSheet contactKey={openKey} onClose={() => setOpenKey(null)} />}
    </div>
  );
}
