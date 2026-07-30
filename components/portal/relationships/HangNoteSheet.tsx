'use client';

/**
 * HangNoteSheet — 给一个人记一条(从人物页的「记录」打开,范围锁定这个人)。
 *
 * bug3 之前这里是两态:先「说一句 / 拍传」让云端 AI 抽取 → 再看确认卡。用户把起手页整页划掉,
 * 要求「直接进入手动输入」——所以现在只有一态:分类 chip + 一个输入框 + 一个加号(传照片/文件)
 * + 确认。零云调用 —— 云端人物抽取路由这里不再调(契约测试钉死,免得悄悄接回来)。
 *
 * 附件是唯一副本:走 local-file-store(IndexedDB),写失败必须可见,不静默丢。
 */
import { useRef, useState } from 'react';
import {
  addPersonRecord, RECORD_CATEGORIES, RECORD_CATEGORY_MAP,
  type PersonRecordCategory, type PersonRecordAttachment,
} from '@/lib/portal/person-records';
import { putLocalFile, prettyBytes, MAX_FILE_BYTES } from '@/lib/portal/local-file-store';
import { RecordCatIcon } from './record-icons';
import { IconPlus } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';

interface Props {
  personKey: string;
  personName: string;
  subtitle?: string;      // 「家庭 · 核心」等
  avatarInitial?: string; // 头像首字
  onClose: () => void;
}

export default function HangNoteSheet({ personKey, personName, subtitle, avatarInitial, onClose }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [category, setCategory] = useState<PersonRecordCategory>('achievement');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [files, setFiles] = useState<PersonRecordAttachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);

  const meta = RECORD_CATEGORY_MAP[category];

  const onPick = async (list: FileList | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setErr(null);
    setBusy(true);
    const added: PersonRecordAttachment[] = [];
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        setErr(L(dict, `「${f.name}」有 ${prettyBytes(f.size)},超过 ${prettyBytes(MAX_FILE_BYTES)} 上限,换个小一点的。`,
          `“${f.name}” is ${prettyBytes(f.size)} — over the ${prettyBytes(MAX_FILE_BYTES)} limit.`));
        continue;
      }
      const assetId = `pr-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ok = await putLocalFile(assetId, f, { name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size });
      // 红线:存不进就说出来,别在列表里挂一个指向空气的附件。
      if (!ok) {
        setErr(L(dict, `「${f.name}」没能存进本机 —— 可能空间满了,清点空间再试。`, `Couldn't store “${f.name}” — device storage may be full.`));
        continue;
      }
      added.push({ assetId, name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size });
    }
    if (added.length) setFiles((prev) => [...prev, ...added]);
    setBusy(false);
  };

  const save = () => {
    const title = text.trim();
    if (!title) return;
    addPersonRecord({
      personKey, category, title,
      ...(meta.money && amount && !Number.isNaN(Number(amount)) ? { amount: Number(amount) } : {}),
      ...(files.length ? { attachments: files } : {}),
    });
    setSaved(true);
    window.setTimeout(onClose, 900);
  };

  return (
    // elevated:这张卡从「关系详情」(自己就是 elevated,又开在洞察 fullscreen 里)再点开。
    // blurOverlay:bug3 要求打开后背后背景虚化。
    <NesioSheet
      variant="bottom"
      elevated
      blurOverlay
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card nesio-hang-card"
      ariaLabel={L(dict, `记一条给 ${personName}`, `Log for ${personName}`)}
    >
      {/* 头:只显示名字(bug3:原来是「挂在 X 身上」,啰嗦) */}
      <div className="nesio-hang-head">
        <span className="nesio-hang-avatar" aria-hidden>{avatarInitial || Array.from(personName.trim())[0] || '·'}</span>
        <div className="nesio-hang-head-id">
          <p className="nesio-hang-head-title">{personName}</p>
          {subtitle && <p className="nesio-hang-head-sub">{subtitle}</p>}
        </div>
      </div>

      {saved ? (
        <p className="nesio-hang-saved">{L(dict, `记到 ${personName} 身上了`, `Saved to ${personName}`)}</p>
      ) : (
        <div className="nesio-hang-body">
          <div className="nesio-rel-chips">
            {RECORD_CATEGORIES.map((cat) => (
              <button key={cat.key} type="button"
                className={`nesio-rel-chip${category === cat.key ? ' nesio-rel-chip--on' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => setCategory(cat.key)}>
                <RecordCatIcon category={cat.key} size={13} /> {L(dict, cat.zh, cat.en)}
              </button>
            ))}
          </div>

          {/* 一个输入框 + 一个加号(传照片 / 文件) */}
          <div className="nesio-ct-field-row">
            <input className="nesio-rel-rec-input" style={{ flex: 1, minWidth: 0 }}
              value={text} maxLength={120} autoFocus
              placeholder={L(dict, '记一条', 'Log something')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) save(); }} />
            <button type="button" className="nesio-ct-field-act" disabled={busy}
              onClick={() => pickRef.current?.click()}
              aria-label={L(dict, '传照片或文件', 'Attach photo or file')}
              title={L(dict, '传照片或文件', 'Attach photo or file')}>
              <IconPlus size={16} />
            </button>
          </div>
          <input ref={pickRef} type="file" multiple accept="image/*,application/pdf" className="nesio-visually-hidden"
            onChange={(e) => { void onPick(e.target.files); e.currentTarget.value = ''; }} />

          {meta.money && (
            <input className="nesio-rel-rec-input" type="number" inputMode="decimal"
              placeholder={L(dict, '金额', 'Amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}

          {files.length > 0 && (
            <ul className="nesio-hang-att-list">
              {files.map((f) => (
                <li key={f.assetId} className="nesio-hang-att">
                  <span className="nesio-hang-att-name">{f.name}</span>
                  <span className="nesio-hang-att-size">{prettyBytes(f.size)}</span>
                  <button type="button" className="nesio-rel-rec-del" aria-label={L(dict, '移除', 'Remove')}
                    onClick={() => setFiles((prev) => prev.filter((x) => x.assetId !== f.assetId))}>✕</button>
                </li>
              ))}
            </ul>
          )}

          {err && <p className="nesio-rel-detail-err" role="alert">{err}</p>}

          <button type="button" className="nesio-ob-primary-btn nesio-hang-primary" disabled={busy || !text.trim()} onClick={save}>
            {L(dict, '确认', 'Confirm')}
          </button>
        </div>
      )}
    </NesioSheet>
  );
}
