'use client';

/**
 * RelationshipsPanel — 关系管理(批次 41)。洞察 →「关系」tab。
 * 读 life-graph 的 person/relations/email 节点,推出联系人清单:
 *   - 顶部「该联系了」:超过节奏没联系的人,一键「联系过了」打卡(本机)
 *   - 下方按亲疏(核心/亲近/一般)列出全部,显示上次联系
 * 纯本地规则,不调 AI、不上传。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import {
  buildRelationships, markContacted, lastContactLabel,
  CLOSENESS_META, type Contact, type Closeness,
} from '@/lib/portal/relationships';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const GROUPS: Closeness[] = ['core', 'close', 'acquaintance'];

export default function RelationshipsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [contacts, setContacts] = useState<Contact[]>([]);

  const rebuild = () => setContacts(buildRelationships(getLifeGraph()));

  useEffect(() => {
    rebuild();
    const onUpdate = () => rebuild();
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const onContacted = (key: string) => {
    markContacted(key);
    rebuild();
  };

  if (contacts.length === 0) {
    return (
      <div className="nesio-health-dash">
        <p className="nesio-insights-empty" style={{ marginBottom: 0 }}>
          {L(dict,
            '还没认出你圈子里的人。记录里提到人名(如「和 Linda 吃饭」),或到「设置 → 数据接入」连上 Gmail,这里就会列出你联系的人、多久没联系、该主动找谁。',
            'No one in your circle yet. Mention people in your notes (e.g. "dinner with Linda"), or connect Gmail in Settings → Data sources, and this will surface who you talk to, how long since contact, and who to reach out to.')}
        </p>
      </div>
    );
  }

  const dueList = contacts.filter((c) => c.reachOut);

  return (
    <div className="nesio-health-dash">
      <p className="nesio-health-updated">
        {L(dict, `${contacts.length} 个联系人 · ${dueList.length} 个该联系`, `${contacts.length} people · ${dueList.length} to reach out`)}
      </p>

      {dueList.length > 0 && (
        <div className="nesio-fit-panel" style={{ marginTop: '0.4rem' }}>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '该联系了', 'Time to reach out')}</p>
          {dueList.slice(0, 6).map((c) => (
            <div key={c.key} className="nesio-rel-due-row">
              <div className="nesio-rel-due-info">
                <span className="nesio-rel-name">{c.name}</span>
                <span className="nesio-rel-sub">
                  {c.relation ? `${c.relation} · ` : ''}{lastContactLabel(c, dict)}
                </span>
              </div>
              <button type="button" className="nesio-rel-touch-btn" onClick={() => onContacted(c.key)}>
                {L(dict, '联系过了', 'Reached out')}
              </button>
            </div>
          ))}
          <p className="nesio-settings-option-hint" style={{ margin: '0.4rem 0 0' }}>
            {L(dict, '节奏按亲疏推:核心 2 周 · 亲近 1 月 · 一般 3 月(点「联系过了」重置)', 'Cadence by closeness: core 2wk · close 1mo · acquaintance 3mo (tap to reset)')}
          </p>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = contacts.filter((c) => c.closeness === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>
              {L(dict, CLOSENESS_META[g].zh, CLOSENESS_META[g].en)} · {items.length}
            </p>
            <div className="nesio-rel-grid">
              {items.map((c) => (
                <div key={c.key} className={`nesio-rel-card${c.reachOut ? ' nesio-rel-card--due' : ''}`}>
                  <span className="nesio-rel-name">{c.name}</span>
                  <span className="nesio-rel-sub">{c.relation || (dict === 'en' ? `mentioned ${c.mentions}×` : `提到 ${c.mentions} 次`)}</span>
                  <span className="nesio-rel-last">{lastContactLabel(c, dict)}</span>
                  <button type="button" className="nesio-rel-touch-btn nesio-rel-touch-btn--sm" onClick={() => onContacted(c.key)}>
                    {L(dict, '联系过了', 'Reached out')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
        {L(dict, '只存本机 · 从你的记忆和邮件推出,非 AI', 'On-device only · derived from your notes and email, not AI')}
      </p>
    </div>
  );
}
