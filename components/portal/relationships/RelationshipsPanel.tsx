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
  buildRelationships, lastContactLabel,
  CLOSENESS_META, type Contact, type Closeness,
} from '@/lib/portal/relationships';
import { getLocalOwner } from '@/lib/portal/local-owner';
import { IconHelpCircle } from '../icons';
import { L } from '@/lib/portal/i18n';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import RelationshipDetailSheet from './RelationshipDetailSheet';
import FamilySummary from './FamilySummary';
import ContactEditSheet from './ContactEditSheet';
import { buildFamilyDigest } from '@/lib/portal/family-digest';
import { ENTITY_ALIASES_EVENT, mergeEntity } from '@/lib/portal/entity-resolution';
// #26:「Jing / Jing Duan / DUAN JING」是同一个人 —— 规范化对词序无能为力,得把候选挑出来
import { suggestPersonMerges } from '@/lib/portal/person-merge-suggest';

const GROUPS: Closeness[] = ['core', 'close', 'acquaintance'];
// 单层最多先渲染这么多行,其余「显示全部」再展开 —— 防「导入了几千个 Google 联系人 →
// 一次性铺几千行 DOM 把主线程/合成器打死」的整机卡死(用户实锤:关系页打开即卡死需重启)。
const TIER_CAP = 50;

// 图/设计:干净筛选 —— 固定桶(家人/朋友/同事/业务/重要),把杂乱的原始英文标签归并进去;
// 归不进的塞进「更多…」。桶按 关系词 + 分组标签 一起判定。
const BUCKETS: Array<{ id: string; zh: string; en: string; re: RegExp }> = [
  { id: 'family', zh: '家人', en: 'Family', re: /家人|家庭|family|爸|妈|父|母|哥|姐|弟|妹|儿子|女儿|丈夫|妻子|奶奶|爷爷|姥|外婆|外公|舅|叔|姑|婶|parent|mom|dad|son|daughter|wife|husband|sister|brother|child|spouse/i },
  { id: 'friend', zh: '朋友', en: 'Friends', re: /朋友|哥们|闺蜜|发小|friend|buddy|\bpal\b/i },
  { id: 'colleague', zh: '同事', en: 'Colleagues', re: /同事|同僚|colleague|co-?worker|coworker|\bteam\b|\bwork\b|老板|下属|领导|manager|boss|report/i },
  { id: 'business', zh: '业务', en: 'Business', re: /业务|客户|甲方|供应|合作|client|customer|vendor|recruit|recipient|account|contact|partner|投资|lead/i },
  { id: 'important', zh: '重要', en: 'Important', re: /重要|关键|vip|important|\bkey\b|\bstar\b/i },
];
const hayOf = (c: Contact) => [c.relation || '', ...c.groups].join(' ');
const isBucketed = (g: string) => BUCKETS.some((b) => b.re.test(g));

// 莫兰迪字母块:按名字散列取一档配色(与设计稿的分层配色一致的柔和调)
function avatarClass(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `nesio-rel-av--${h % 6}`;
}
function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0].toUpperCase() : '·';
}

/** 左侧头像:通讯录同步来的 Gmail 头像优先,没有才退回莫兰迪字母块(图片 404 也退回)。 */
function ContactAvatar({ c }: { c: Contact }) {
  const [broken, setBroken] = useState(false);
  if (c.photo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Google 头像是外域任意 URL,不走 next/image 优化
      <img className="nesio-rel-av nesio-rel-av--img" src={c.photo} alt="" loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    );
  }
  return <span className={`nesio-rel-av ${avatarClass(c.name)}`} aria-hidden>{initialOf(c.name)}</span>;
}

export default function RelationshipsPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null); // null=全部;桶 id 或原始分组名
  const [showMore, setShowMore] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // #26:说过「不是同一个人」的配对,本次会话里不再问第二遍(不落盘 —— 判据一改就该重新问)
  const [dismissedMerges, setDismissedMerges] = useState<string[]>([]);
  const [expandedTiers, setExpandedTiers] = useState<Record<Closeness, boolean>>({ core: false, close: false, acquaintance: false });

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
    window.addEventListener(ENTITY_ALIASES_EVENT, onUpdate); // 数据审计 #4:合并实体后就地重算
    return () => {
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener('nesio-person-records-updated', onUpdate);
      window.removeEventListener(ENTITY_ALIASES_EVENT, onUpdate);
    };
  }, []);

  // 空态也得能加人 —— 此前这里是条死路:没人 → 只告诉你「去连 Gmail」,
  // 想手动录第一个人没有任何入口。
  if (contacts.length === 0) {
    return (
      <div className="nesio-health-dash">
        <p className="nesio-insights-empty">
          {L(dict,
            '还没认出你圈子里的人。可以直接加一个,也可以在记录里提到人名(如「和 Linda 吃饭」),或到「设置 → 数据接入」连上 Gmail —— 这里就会列出你联系的人、多久没联系、该主动找谁。',
            'No one in your circle yet. Add someone directly, mention people in your notes (e.g. "dinner with Linda"), or connect Gmail in Settings → Data sources — this will then surface who you talk to, how long since contact, and who to reach out to.')}
        </p>
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%' }} onClick={() => setAddOpen(true)}>
          {L(dict, '＋ 加一个人', '＋ Add someone')}
        </button>
        <ContactEditSheet open={addOpen} onClose={() => setAddOpen(false)} onSaved={(k) => { rebuild(); setOpenKey(k); }} />
      </div>
    );
  }

  // 固定桶(只保留有人的),原始英文标签归并进去;归不进的进「更多…」(按频次)
  const presentBuckets = BUCKETS.filter((b) => contacts.some((c) => b.re.test(hayOf(c))));
  const moreCount = new Map<string, number>();
  for (const c of contacts) for (const g of c.groups) if (g.trim() && !isBucketed(g)) moreCount.set(g, (moreCount.get(g) || 0) + 1);
  const moreGroups = Array.from(moreCount.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).slice(0, 20).map(([g]) => g);

  const activeBucket = BUCKETS.find((b) => b.id === activeGroup);
  const shown = !activeGroup
    ? contacts
    : activeBucket
      ? contacts.filter((c) => activeBucket.re.test(hayOf(c)))
      : contacts.filter((c) => c.groups.includes(activeGroup));
  const dueList = shown.filter((c) => c.reachOut);
  const familyDigest = buildFamilyDigest(contacts);

  /* #26(2026-07-30 真机):「Jing」「Jing Duan」「DUAN JING」是同一个人被拆成三条。
     用户手动并了前两条,**第三条依然独立** —— 因为合并是一次一对手动指认,
     而系统从来没告诉他「还有一条也像」。
     规范化只到大小写/空白,对**词序反过来**无能为力(通讯录 姓+名 vs 邮件署名 名+姓)。
     这里把候选挑出来摆在最上面。**不自动合并** —— 合并不可撤销,而「同名不同人」
     在现实里很常见;系统替人做这个决定,错一次就把两个人的记录搅在一起,再也分不开。 */
  const mergeHints = suggestPersonMerges(contacts.map((c) => c.name))
    .filter((h) => !dismissedMerges.includes(`${h.canonical}|${h.alias}`));

  return (
    <div className="nesio-health-dash">
      {mergeHints.length > 0 && (
        <div className="nesio-rel-mergehint">
          {mergeHints.slice(0, 3).map((h) => (
            <div key={`${h.canonical}|${h.alias}`} className="nesio-rel-mergehint-row">
              <span className="nesio-rel-mergehint-text">
                {h.confidence === 'high'
                  ? L(dict, `「${h.alias}」和「${h.canonical}」是同样几个字,只是顺序不同 —— 多半是同一个人。`,
                    `“${h.alias}” and “${h.canonical}” are the same words in a different order — likely the same person.`)
                  : L(dict, `「${h.alias}」可能就是「${h.canonical}」—— 也可能是另一个同名的人。`,
                    `“${h.alias}” might be “${h.canonical}” — or a different person with that name.`)}
              </span>
              <span className="nesio-rel-mergehint-actions">
                <button type="button" className="nesio-rel-mergehint-btn"
                  onClick={() => { mergeEntity(h.alias, h.canonical); rebuild(); }}>
                  {L(dict, '合并', 'Merge')}
                </button>
                <button type="button" className="nesio-rel-mergehint-btn ghost"
                  onClick={() => setDismissedMerges((v) => [...v, `${h.canonical}|${h.alias}`])}>
                  {L(dict, '不是', 'Not the same')}
                </button>
              </span>
            </div>
          ))}
          <p className="nesio-rel-mergehint-foot">
            {L(dict, '合并之后这两个名字的记录会归到一处,不可撤销 —— 拿不准就先放着。',
              'Merging pools both names’ records into one and cannot be undone — leave it if you are unsure.')}
          </p>
        </div>
      )}

      {(presentBuckets.length > 0 || moreGroups.length > 0) && (
        <div className="nesio-rel-chips" role="tablist" aria-label={L(dict, '联系人分组', 'Contact groups')}>
          <button type="button" role="tab" aria-selected={!activeGroup} className={`nesio-rel-chip${!activeGroup ? ' nesio-rel-chip--on' : ''}`} onClick={() => setActiveGroup(null)}>
            {L(dict, '全部', 'All')}
          </button>
          {presentBuckets.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={activeGroup === b.id} className={`nesio-rel-chip${activeGroup === b.id ? ' nesio-rel-chip--on' : ''}`} onClick={() => setActiveGroup(b.id)}>
              {L(dict, b.zh, b.en)}
            </button>
          ))}
          {/* 更多…:展开归并不进桶的原始分组 */}
          {moreGroups.length > 0 && !showMore && (
            <button type="button" className="nesio-rel-chip nesio-rel-chip--more" onClick={() => setShowMore(true)}>
              {L(dict, '更多…', 'More…')}
            </button>
          )}
          {showMore && moreGroups.map((g) => (
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

      {/* 分层列表(核心/亲近/一般)—— 字母块头像按分层配色,每行自带「该问候了/联系过了」 */}
      {GROUPS.map((g) => {
        const items = shown.filter((c) => c.closeness === g);
        if (!items.length) return null;
        // 大列表先只铺 TIER_CAP 行(其余点「显示全部」再渲染)—— 关键:不把几千行一次性挂上去。
        const expanded = expandedTiers[g];
        const visible = expanded ? items : items.slice(0, TIER_CAP);
        return (
          <div key={g}>
            <p className="nesio-rel-tier-h">
              <span className={`nesio-rel-tier-dot nesio-rel-tier-dot--${g}`} aria-hidden />
              {L(dict, CLOSENESS_META[g].zh, CLOSENESS_META[g].en)} · {items.length}
            </p>
            <div className="nesio-rel-list">
              {visible.map((c) => (
                <div
                  key={c.key}
                  role="button"
                  tabIndex={0}
                  className={`nesio-rel-row nesio-rel-open${c.reachOut ? ' nesio-rel-row--due' : ''}`}
                  onClick={() => setOpenKey(c.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(c.key); } }}
                >
                  <ContactAvatar c={c} />
                  <span className="nesio-rel-row-body">
                    <span className="nesio-rel-name">{c.name}</span>
                    <span className="nesio-rel-sub">
                      {c.relation ? `${c.relation} · ` : ''}{dict === 'en' ? `mentioned ${c.mentions}×` : `提到 ${c.mentions} 次`} · {L(dict, `上次${lastContactLabel(c, dict)}`, `last ${lastContactLabel(c, 'en')}`)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {items.length > TIER_CAP && !expanded && (
              <button type="button" className="nesio-rel-showall"
                onClick={() => setExpandedTiers((s) => ({ ...s, [g]: true }))}>
                {L(dict, `显示全部 ${items.length} 位`, `Show all ${items.length}`)}
              </button>
            )}
          </div>
        );
      })}

      {/* 加人挪到最下边(bug3):列表是这一页的主体,加人是偶发动作,不该占顶部黄金位 */}
      <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '1rem' }} onClick={() => setAddOpen(true)}>
        {L(dict, '＋ 加人', '＋ Add someone')}
      </button>

      {openKey && <RelationshipDetailSheet contactKey={openKey} onClose={() => setOpenKey(null)} />}
      {/* 加完直接打开 TA 的详情页 —— 加人的下一步几乎总是「给 TA 记点什么」 */}
      <ContactEditSheet open={addOpen} onClose={() => setAddOpen(false)} onSaved={(k) => { rebuild(); setOpenKey(k); }} />
    </div>
  );
}
