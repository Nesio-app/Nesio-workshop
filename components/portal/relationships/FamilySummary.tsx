'use client';

/**
 * FamilySummary — 家庭汇总卡(人缘㊅)。关系 tab 顶部:家庭成员的分类数据概览 +
 * 一条合并的近期动态时间线(成绩/健康/消费…),点成员进详情。只读本机,不调 AI。
 */
import type { FamilyDigest } from '@/lib/portal/family-digest';
import { type PersonRecordCategory } from '@/lib/portal/person-records';
import { RecordCatIcon } from './record-icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface Props {
  digest: FamilyDigest;
  onOpen: (key: string) => void;
}

export default function FamilySummary({ digest, onOpen }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (!digest.members.length) return null;

  return (
    <div className="nesio-fam-summary">
      <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
        {L(dict, '家庭动态', 'Family')}
      </p>

      <div className="nesio-fam-members">
        {digest.members.map((m) => (
          <button key={m.key} type="button" className="nesio-fam-chip" onClick={() => onOpen(m.key)}>
            <span className="nesio-fam-chip-name">{m.name}</span>
            <span className="nesio-fam-chip-cats">
              {Object.entries(m.counts).map(([cat, n]) => (
                <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}><RecordCatIcon category={cat as PersonRecordCategory} size={12} />{n}</span>
              ))}
            </span>
          </button>
        ))}
      </div>

      {digest.recent.length > 0 && (
        <div className="nesio-rel-timeline" style={{ marginTop: '0.6rem' }}>
          {digest.recent.map((item) => {
            const d = item.record.date || item.record.createdAt;
            return (
              <button key={item.record.id} type="button" className="nesio-fam-tl-row" onClick={() => onOpen(item.personKey)}>
                <span className="nesio-rel-tl-date">
                  {new Date(d).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })}
                </span>
                <span className="nesio-rel-tl-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <RecordCatIcon category={item.record.category} size={13} /> <b>{item.personName}</b> · {item.record.title}
                  {typeof item.record.amount === 'number' ? ` · ${item.record.amount}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
