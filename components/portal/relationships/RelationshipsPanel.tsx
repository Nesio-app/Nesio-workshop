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
import { getLocalOwner } from '@/lib/portal/local-owner';
import { IconCamera, IconHelpCircle } from '../icons';
import { L } from '@/lib/portal/i18n';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import RelationshipDetailSheet from './RelationshipDetailSheet';
import FamilySummary from './FamilySummary';
import PersonExtractSheet from './PersonExtractSheet';
import { buildFamilyDigest } from '@/lib/portal/family-digest';

const GROUPS: Closeness[] = ['core', 'close', 'acquaintance'];
const FAMILY_RE = /家人|家庭|family/i;

export default function RelationshipsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);

  const rebuild = () => {
    const owner = getLocalOwner();
    const displayName = loadProfileSettings().displayName;
    const self = {
      emails: owner?.email ? [owner.email] : [],
      names: [displayName].filter((s) => s && s !== '我'),
    };
    setContacts(buildRelationships(getLifeGraph(), Date.now(), undefined, self));
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

  // Google 联系人分组(家人置顶),用于按组筛选
  const allGroups = Array.from(new Set(contacts.flatMap((c) => c.groups)));
  allGroups.sort((a, b) => (FAMILY_RE.test(b) ? 1 : 0) - (FAMILY_RE.test(a) ? 1 : 0) || a.localeCompare(b, 'zh'));
  const shown = activeGroup ? contacts.filter((c) => c.groups.includes(activeGroup)) : contacts;
  const dueList = shown.filter((c) => c.reachOut);
  const familyDigest = buildFamilyDigest(contacts);

  return (
    <div className="nesio-health-dash">
      <div className="nesio-rel-head-row">
        <p className="nesio-health-updated" style={{ margin: 0 }}>
          {L(dict, `${shown.length} 个联系人 · ${dueList.length} 个该联系`, `${shown.length} people · ${dueList.length} to reach out`)}
        </p>
        <button type="button" className="nesio-rel-log-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={() => setExtractOpen(true)}>
          <IconCamera size={14} />{L(dict, '记给某人', 'Log to…')}
        </button>
      </div>

      {allGroups.length > 0 && (
        <div className="nesio-rel-chips" role="tablist" aria-label={L(dict, '联系人分组', 'Contact groups')}>
          <button type="button" role="tab" aria-selected={!activeGroup} className={`nesio-rel-chip${!activeGroup ? ' nesio-rel-chip--on' : ''}`} onClick={() => setActiveGroup(null)}>
            {L(dict, '全部', 'All')}
          </button>
          {allGroups.map((g) => (
            <button key={g} type="button" role="tab" aria-selected={activeGroup === g} className={`nesio-rel-chip${activeGroup === g ? ' nesio-rel-chip--on' : ''}`} onClick={() => setActiveGroup(g)}>
              {g}
            </button>
          ))}
        </div>
      )}

      {/* 念念提醒:给最该联系的人一句暖话(设计稿)—— 帮你起个头 = 开聊天预填草稿 */}
      {dueList.length > 0 && (
        <div className="nesio-rel-nudge">
          <span className="nesio-rel-nudge-ic" aria-hidden><IconHelpCircle size={16} /></span>
          <div className="nesio-rel-nudge-body">
            <p className="nesio-rel-nudge-text">
              {L(dict,
                `你有 ${lastContactLabel(dueList[0], dict)}没跟 ${dueList[0].name} 聊了。要不要今晚发条消息?`,
                `It's been ${lastContactLabel(dueList[0], 'en')} since you talked to ${dueList[0].name}. Message them tonight?`)}
            </p>
            <button type="button" className="nesio-rel-nudge-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('nesio-ask-text', { detail: { text: L(dict, `帮我给 ${dueList[0].name} 写一条问候消息`, `Help me write a message to ${dueList[0].name}`) } }))}>
              {L(dict, '帮你起个头 ›', 'Draft it for me ›')}
            </button>
          </div>
        </div>
      )}

      {!activeGroup && <FamilySummary digest={familyDigest} onOpen={setOpenKey} />}

      {dueList.length > 0 && (
        <div className="nesio-fit-panel" style={{ marginTop: '0.4rem' }}>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '该联系了', 'Time to reach out')}</p>
          {dueList.slice(0, 6).map((c) => (
            <div key={c.key} className="nesio-rel-due-row">
              <button type="button" className="nesio-rel-due-info nesio-rel-open" onClick={() => setOpenKey(c.key)}>
                <span className="nesio-rel-name">{c.name}</span>
                <span className="nesio-rel-sub">
                  {c.relation ? `${c.relation} · ` : ''}{lastContactLabel(c, dict)}
                </span>
              </button>
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
        const items = shown.filter((c) => c.closeness === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <p className="nesio-settings-section-label" style={{ marginTop: '1rem' }}>
              {L(dict, CLOSENESS_META[g].zh, CLOSENESS_META[g].en)} · {items.length}
            </p>
            <div className="nesio-rel-grid">
              {items.map((c) => (
                <div
                  key={c.key}
                  role="button"
                  tabIndex={0}
                  className={`nesio-rel-card nesio-rel-open${c.reachOut ? ' nesio-rel-card--due' : ''}`}
                  onClick={() => setOpenKey(c.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(c.key); } }}
                >
                  <span className="nesio-rel-name">{c.name}</span>
                  <span className="nesio-rel-sub">{c.relation || (dict === 'en' ? `mentioned ${c.mentions}×` : `提到 ${c.mentions} 次`)}</span>
                  <span className="nesio-rel-last">{lastContactLabel(c, dict)}</span>
                  <button
                    type="button"
                    className={`nesio-rel-touch-btn nesio-rel-touch-btn--sm${c.reachOut ? ' nesio-rel-touch-btn--due' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onContacted(c.key); }}
                  >
                    {c.reachOut ? L(dict, '该问候了', 'Say hi') : L(dict, '联系过了', 'Reached out')}
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

      {openKey && <RelationshipDetailSheet contactKey={openKey} onClose={() => setOpenKey(null)} />}
      <PersonExtractSheet open={extractOpen} onClose={() => setExtractOpen(false)} />
    </div>
  );
}
