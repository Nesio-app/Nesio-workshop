'use client';

/**
 * ContactEditSheet — 添加 / 编辑一个联系人(People 升级,2026-07-29)。
 *
 * 一张表单管两件事:
 *   · 没传 contactKey  → 新建(面板右上「＋ 加人」)
 *   · 传了 contactKey  → 编辑(详情页「编辑资料」)
 *
 * 编辑模式下改名会触发搬家(renameContact:把 person-records / 亲疏覆盖 / 别名一起挪),
 * 所以名字变了时给一句明说 —— 用户该知道 TA 的记录跟着走了,而不是猜。
 */

import { useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { addManualContact, updateManualContact, renameContact } from '@/lib/portal/manual-contacts';
import { RELATION_TAGS } from '@/lib/portal/relationships';
import { IconMail, IconPhone, IconNavigate } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export interface ContactDraft {
  name: string;
  email?: string;
  phone?: string;
  birthday?: string;
  relation?: string;
  note?: string;
  address?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 有值 = 编辑模式。 */
  contactKey?: string | null;
  nodeId?: string | null;
  initial?: ContactDraft;
  /** 保存成功后回传最终的 key(改名后可能变了)。 */
  onSaved?: (key: string) => void;
}

const EMPTY: ContactDraft = { name: '', email: '', phone: '', birthday: '', relation: '', note: '', address: '' };

/** 行内动作按钮(写信 / 打电话 / 导航):都走系统 URL scheme,没值就禁用,不做假按钮。 */
function FieldAction({ href, label, disabled, children }: { href: string; label: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className="nesio-ct-field-act is-off" aria-hidden>{children}</span>;
  }
  return (
    <a className="nesio-ct-field-act" href={href} aria-label={label} title={label}
      target="_blank" rel="noreferrer">{children}</a>
  );
}

export default function ContactEditSheet({ open, onClose, contactKey, nodeId, initial, onSaved }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const editing = Boolean(contactKey);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setDraft({ ...EMPTY, ...(initial || {}) }); setErr(null); }
  }, [open, initial]);

  const set = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  // 关系标签:固定表 + 当前值(数据推出来的关系词可能不在表里,得能看见也能取消)
  const relTags = (() => {
    const cur = (draft.relation || '').trim();
    if (!cur || RELATION_TAGS.some((t) => t.zh === cur)) return RELATION_TAGS;
    return [{ zh: cur, en: cur }, ...RELATION_TAGS];
  })();
  const mailTo = (draft.email || '').trim();
  // tel: 只留数字 / + / 号,别把「(919) 555-0100」原样塞进 URL
  const telNumber = (draft.phone || '').replace(/[^\d+#*]/g, '');
  const addr = (draft.address || '').trim();

  const save = () => {
    const name = draft.name.trim();
    if (!name) { setErr(L(dict, '先写个名字吧。', 'A name first.')); return; }
    setErr(null);
    setBusy(true);
    try {
      let key: string;
      if (editing && contactKey) {
        key = renameContact(contactKey, nodeId ?? null, draft);
        if (key === contactKey && nodeId) updateManualContact(nodeId, draft);
      } else {
        const made = addManualContact(draft);
        // 红线:写失败必须看得见,不许静默回到「没反应」。
        if (!made) { setErr(L(dict, '没能保存 —— 本机存储写不进,过会儿再试。', 'Could not save — local storage write failed. Try again.')); return; }
        key = made.key;
      }
      onSaved?.(key);
      onClose();
    } catch {
      setErr(L(dict, '没能保存,再试一次。', "Couldn't save — try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <NesioSheet
      variant="bottom"
      elevated
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={editing ? L(dict, '编辑联系人', 'Edit contact') : L(dict, '添加联系人', 'Add contact')}
    >
      <h2 className="nesio-settings-sheet-title">
        {editing ? L(dict, '编辑资料', 'Edit details') : L(dict, '添加一个人', 'Add someone')}
      </h2>
      <div className="nesio-settings-sheet-body">
        <label className="nesio-settings-section-label" htmlFor="ct-name">{L(dict, '名字', 'Name')}</label>
        <input id="ct-name" className="nesio-ob-input" value={draft.name} maxLength={40} autoFocus
          placeholder={L(dict, '怎么称呼 TA', 'What you call them')} onChange={set('name')} />

        {/* bug3:关系改成选 tag —— 自由填写的结果是「同事/同事们/工作同事」三种写法算三种关系 */}
        <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '关系', 'Relationship')}</p>
        <div className="nesio-rel-chips" role="group" aria-label={L(dict, '关系', 'Relationship')}>
          {relTags.map((t) => {
            const on = (draft.relation || '') === t.zh;
            return (
              <button key={t.zh} type="button" aria-pressed={on}
                className={`nesio-rel-chip${on ? ' nesio-rel-chip--on' : ''}`}
                onClick={() => setDraft((d) => ({ ...d, relation: on ? '' : t.zh }))}>
                {L(dict, t.zh, t.en)}
              </button>
            );
          })}
        </div>

        <label className="nesio-settings-section-label" htmlFor="ct-email" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '邮箱', 'Email')}</label>
        <div className="nesio-ct-field-row">
          <input id="ct-email" className="nesio-ob-input" type="email" value={draft.email || ''} maxLength={80}
            placeholder={L(dict, '有的话填上 —— 邮件往来会自动认到 TA', 'If you have it — emails will match to them')} onChange={set('email')} />
          <FieldAction href={`mailto:${encodeURIComponent(mailTo)}`} disabled={!mailTo}
            label={L(dict, '给 TA 写信', 'Write to them')}><IconMail size={16} /></FieldAction>
        </div>

        <label className="nesio-settings-section-label" htmlFor="ct-phone" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '电话', 'Phone')}</label>
        <div className="nesio-ct-field-row">
          <input id="ct-phone" className="nesio-ob-input" type="tel" value={draft.phone || ''} maxLength={32}
            onChange={set('phone')} />
          <FieldAction href={`tel:${telNumber}`} disabled={!telNumber}
            label={L(dict, '打给 TA', 'Call them')}><IconPhone size={16} /></FieldAction>
        </div>

        <label className="nesio-settings-section-label" htmlFor="ct-addr" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '地址', 'Address')}</label>
        <div className="nesio-ct-field-row">
          <input id="ct-addr" className="nesio-ob-input" value={draft.address || ''} maxLength={120}
            onChange={set('address')} />
          {/* maps.apple.com:iOS 交给系统默认地图,Android/桌面浏览器落到网页地图 */}
          <FieldAction href={`https://maps.apple.com/?q=${encodeURIComponent(addr)}`} disabled={!addr}
            label={L(dict, '导航过去', 'Navigate there')}><IconNavigate size={16} /></FieldAction>
        </div>

        <label className="nesio-settings-section-label" htmlFor="ct-bday" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '生日', 'Birthday')}</label>
        <input id="ct-bday" className="nesio-ob-input" type="date" value={draft.birthday || ''} onChange={set('birthday')} />

        <label className="nesio-settings-section-label" htmlFor="ct-note" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '备注', 'Note')}</label>
        <input id="ct-note" className="nesio-ob-input" value={draft.note || ''} maxLength={120} onChange={set('note')} />

        {err && <p className="nesio-rel-detail-err" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={onClose}>
            {L(dict, '取消', 'Cancel')}
          </button>
          <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} disabled={busy || !draft.name.trim()} onClick={save}>
            {busy ? L(dict, '存着…', 'Saving…') : L(dict, '保存', 'Save')}
          </button>
        </div>
      </div>
    </NesioSheet>
  );
}
