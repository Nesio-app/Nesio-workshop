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
import { addManualContact, updateManualContact, renameContact, contactKeyOf } from '@/lib/portal/manual-contacts';
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

const EMPTY: ContactDraft = { name: '', email: '', phone: '', birthday: '', relation: '', note: '' };

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

  // 改名 = 换身份键。提前算出来,好在按钮上方把「记录会跟着搬」说清楚。
  const willRename = editing && draft.name.trim()
    && contactKeyOf({ name: draft.name, email: draft.email }) !== contactKey;

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

        <label className="nesio-settings-section-label" htmlFor="ct-rel" style={{ marginTop: '0.7rem' }}>{L(dict, '关系', 'Relationship')}</label>
        <input id="ct-rel" className="nesio-ob-input" value={draft.relation || ''} maxLength={16}
          placeholder={L(dict, '如:妈妈、同事、大学同学', 'e.g. mom, coworker')} onChange={set('relation')} />

        <label className="nesio-settings-section-label" htmlFor="ct-email" style={{ marginTop: '0.7rem' }}>{L(dict, '邮箱', 'Email')}</label>
        <input id="ct-email" className="nesio-ob-input" type="email" value={draft.email || ''} maxLength={80}
          placeholder={L(dict, '有的话填上 —— 邮件往来会自动认到 TA', 'If you have it — emails will match to them')} onChange={set('email')} />

        <label className="nesio-settings-section-label" htmlFor="ct-phone" style={{ marginTop: '0.7rem' }}>{L(dict, '电话', 'Phone')}</label>
        <input id="ct-phone" className="nesio-ob-input" type="tel" value={draft.phone || ''} maxLength={32}
          placeholder={L(dict, '选填', 'Optional')} onChange={set('phone')} />

        <label className="nesio-settings-section-label" htmlFor="ct-bday" style={{ marginTop: '0.7rem' }}>{L(dict, '生日', 'Birthday')}</label>
        <input id="ct-bday" className="nesio-ob-input" type="date" value={draft.birthday || ''} onChange={set('birthday')} />

        <label className="nesio-settings-section-label" htmlFor="ct-note" style={{ marginTop: '0.7rem' }}>{L(dict, '备注', 'Note')}</label>
        <input id="ct-note" className="nesio-ob-input" value={draft.note || ''} maxLength={120}
          placeholder={L(dict, '想记住的一句话', 'Anything worth remembering')} onChange={set('note')} />

        {willRename && (
          <p className="nesio-settings-option-hint" style={{ margin: '0.7rem 0 0' }}>
            {L(dict,
              '名字/邮箱变了 —— 挂在 TA 身上的记录(含健康)会一起搬过来,旧名字以后也还认得出。',
              'Name/email changed — everything attached to them (health included) moves along, and the old name still resolves to them.')}
          </p>
        )}

        {err && <p className="nesio-rel-detail-err" role="alert" style={{ marginTop: '0.7rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={onClose}>
            {L(dict, '先不改', 'Not now')}
          </button>
          <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} disabled={busy || !draft.name.trim()} onClick={save}>
            {busy ? L(dict, '存着…', 'Saving…') : L(dict, '保存', 'Save')}
          </button>
        </div>

        <p className="nesio-settings-option-hint" style={{ marginTop: '0.8rem', textAlign: 'center' }}>
          {L(dict, '只存本机 · 仅你可见', 'On this device only · just for you')}
        </p>
      </div>
    </NesioSheet>
  );
}
