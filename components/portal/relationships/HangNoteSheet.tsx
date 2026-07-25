'use client';

/**
 * HangNoteSheet — 「挂一条」(设计稿:挂在 TA 身上)。从人物页 + 挂一条打开,范围锁定这个人。
 *
 * 两态:
 *  · 起手 —— 说一句 / 拍传,不先填表(也可「手动填」)。念念自动归类、认日期、贴标签。
 *  · 确认卡 —— 念念认出来 → 提取标题 + 念念贴的标签(分类 + 日期)+ 敏感项自动只存本机 → 挂到 TA。
 *
 * 功能以现有为准:AI 提取走 /api/portal/person-extract(guardAiRoute);落库走 addPersonRecord;
 * 敏感三类(医疗/药物/健康)由 person-records 的 sensitive 标决定「只存本机、不进 AI/洞察」。
 */
import { useRef, useState } from 'react';
import {
  addPersonRecord, RECORD_CATEGORIES, RECORD_CATEGORY_MAP,
  type PersonRecordCategory,
} from '@/lib/portal/person-records';
import { imageToDataUrl } from '@/lib/portal/image-util';
import { RecordCatIcon } from './record-icons';
import { IconMic, IconCamera, IconLock } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import { guardPaidCloudAi } from '@/lib/portal/entitlement';

type Extracted = { category: PersonRecordCategory; title: string; detail?: string; date?: string; amount?: number };

interface Props {
  personKey: string;
  personName: string;
  subtitle?: string;      // 「家庭 · 核心」等
  avatarInitial?: string; // 头像首字
  onClose: () => void;
}

export default function HangNoteSheet({ personKey, personName, subtitle, avatarInitial, onClose }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Extracted[] | null>(null);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState<{ category: PersonRecordCategory; title: string; detail: string; date: string; amount: string }>(
    { category: 'achievement', title: '', detail: '', date: '', amount: '' },
  );
  const [saved, setSaved] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const doExtract = async (payload: { text?: string; image?: string }) => {
    if (!guardPaidCloudAi('person_extract')) return; // 安全审计 #2:AI 抽取付费云,免费→升级引导
    setErr(null); setBusy(true); setPending(null);
    try {
      const res = await fetch('/api/portal/person-extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; records?: Extracted[] } | null;
      if (!res.ok || !data?.ok) throw new Error('extract_failed');
      const recs = Array.isArray(data.records) ? data.records : [];
      if (!recs.length) { setErr(L(dict, '没认出可记录的信息,换个说法/清晰点的照片,或手动填。', "Couldn't find anything to log — rephrase, use a clearer photo, or fill it in manually.")); return; }
      setPending(recs);
    } catch {
      setErr(L(dict, '识别没成功,稍后再试,或手动填。', "Couldn't process that — try again, or fill it in manually."));
    } finally { setBusy(false); }
  };
  const runText = () => { const t = text.trim(); if (t && !busy) void doExtract({ text: t }); };
  const onPickPhoto = async (file: File | undefined) => {
    if (!file || busy) return;
    setErr(null); setBusy(true); setPending(null);
    try {
      const image = await imageToDataUrl(file);
      await doExtract({ image, ...(text.trim() ? { text: text.trim() } : {}) });
    } catch {
      setErr(L(dict, '这张图没能读取,换一张再试。', "Couldn't read that image — try another."));
      setBusy(false);
    }
  };

  const done = () => { setSaved(true); window.setTimeout(onClose, 900); };
  const savePending = () => {
    if (!pending) return;
    for (const r of pending) {
      addPersonRecord({ personKey, category: r.category, title: r.title,
        ...(r.detail ? { detail: r.detail } : {}), ...(r.date ? { date: r.date } : {}),
        ...(typeof r.amount === 'number' ? { amount: r.amount } : {}) });
    }
    done();
  };
  const saveManual = () => {
    const title = form.title.trim();
    if (!title) return;
    addPersonRecord({ personKey, category: form.category, title,
      ...(form.detail.trim() ? { detail: form.detail.trim() } : {}),
      ...(form.date ? { date: form.date } : {}),
      ...(form.amount && !Number.isNaN(Number(form.amount)) ? { amount: Number(form.amount) } : {}) });
    done();
  };

  const setPendingCategory = (i: number, cat: PersonRecordCategory) =>
    setPending((prev) => prev ? prev.map((r, j) => (j === i ? { ...r, category: cat } : r)) : prev);
  const anySensitive = pending?.some((r) => RECORD_CATEGORY_MAP[r.category].sensitive) || (manual && RECORD_CATEGORY_MAP[form.category].sensitive);

  return (
    <NesioSheet
      variant="bottom"
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card nesio-hang-card"
      ariaLabel={L(dict, `挂在 ${personName} 身上`, `Attach to ${personName}`)}
    >

        {/* 头:挂在 TA 身上 */}
        <div className="nesio-hang-head">
          <span className="nesio-hang-avatar" aria-hidden>{avatarInitial || Array.from(personName.trim())[0] || '·'}</span>
          <div className="nesio-hang-head-id">
            <p className="nesio-hang-head-title">{L(dict, `挂在 ${personName} 身上`, `Attach to ${personName}`)}</p>
            {subtitle && <p className="nesio-hang-head-sub">{subtitle}</p>}
          </div>
        </div>

        {saved ? (
          <p className="nesio-hang-saved">{L(dict, `记到 ${personName} 身上了`, `Saved to ${personName}`)}</p>
        ) : pending ? (
          <>
            {/* 念念确认语 */}
            <p className="nesio-hang-nessa">
              <span className="nesio-hang-nessa-kicker">{L(dict, '念念', 'Nessa')}</span>
              {L(dict,
                `记到 ${personName} 身上了。${anySensitive ? '健康项只你可见、不进 AI。' : '我已经归好类了。'}`,
                `Saving to ${personName}.${anySensitive ? ' Health items stay private to you, never sent to AI.' : ' Sorted and dated.'}`)}
            </p>
            {pending.map((r, i) => {
              const meta = RECORD_CATEGORY_MAP[r.category];
              return (
                <div key={i} className="nesio-hang-confirm">
                  <span className="nesio-hang-confirm-badge">{L(dict, '说一句 · 刚刚', 'Just now')}</span>
                  <p className="nesio-hang-confirm-title">{r.title}{typeof r.amount === 'number' ? ` · ${r.amount}` : ''}</p>
                  <p className="nesio-hang-confirm-tagline">{L(dict, '— 念念贴的', '— tagged by Nessa')}</p>
                  <div className="nesio-hang-tags">
                    {/* 分类 chip:点循环换类(错了一眼改) */}
                    <button type="button" className={`nesio-hang-tag nesio-hang-tag--cat${meta.sensitive ? ' is-sensitive' : ''}`}
                      onClick={() => { const list = RECORD_CATEGORIES; const idx = list.findIndex((x) => x.key === r.category); setPendingCategory(i, list[(idx + 1) % list.length].key); }}>
                      <RecordCatIcon category={r.category} size={12} /> {L(dict, meta.zh, meta.en)}
                    </button>
                    {r.date && <span className="nesio-hang-tag"># {r.date}</span>}
                  </div>
                  <div className="nesio-hang-lock">
                    <IconLock size={12} />
                    {meta.sensitive
                      ? L(dict, `${meta.zh} · 仅你可见,不进 AI`, `${meta.en} · only you, never sent to AI`)
                      : L(dict, `${meta.zh} · 存进 TA 的档案`, `${meta.en} · to their profile`)}
                  </div>
                </div>
              );
            })}
            <button type="button" className="nesio-ob-primary-btn nesio-hang-primary" onClick={savePending}>
              {L(dict, `挂到 ${personName} 身上`, `Attach to ${personName}`)}
            </button>
            <button type="button" className="nesio-hang-redo" onClick={() => { setPending(null); }}>{L(dict, '改一下 ›', 'Redo ›')}</button>
          </>
        ) : manual ? (
          <div className="nesio-hang-body">
            <div className="nesio-rel-chips">
              {RECORD_CATEGORIES.map((cat) => (
                <button key={cat.key} type="button"
                  className={`nesio-rel-chip${form.category === cat.key ? ' nesio-rel-chip--on' : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                  onClick={() => setForm((f) => ({ ...f, category: cat.key }))}>
                  <RecordCatIcon category={cat.key} size={13} /> {L(dict, cat.zh, cat.en)}
                </button>
              ))}
            </div>
            <input className="nesio-rel-rec-input" placeholder={L(dict, '标题(如「期末年级第一」)', 'Title')} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <input className="nesio-rel-rec-input" placeholder={L(dict, '备注(可选)', 'Note (optional)')} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="nesio-rel-rec-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={{ flex: 1 }} />
              {RECORD_CATEGORY_MAP[form.category].money && (
                <input className="nesio-rel-rec-input" type="number" inputMode="decimal" placeholder={L(dict, '金额', 'Amount')} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={{ flex: 1 }} />
              )}
            </div>
            {RECORD_CATEGORY_MAP[form.category].sensitive && (
              <div className="nesio-hang-lock"><IconLock size={12} />{L(dict, '敏感信息:仅你可见 · 跨端同步 · 不进 AI', 'Sensitive — only you, synced across your devices, never sent to AI')}</div>
            )}
            <button type="button" className="nesio-ob-primary-btn nesio-hang-primary" onClick={saveManual}>{L(dict, `挂到 ${personName} 身上`, `Attach to ${personName}`)}</button>
            <button type="button" className="nesio-hang-redo" onClick={() => setManual(false)}>{L(dict, '‹ 用说的', '‹ Speak instead')}</button>
          </div>
        ) : (
          <div className="nesio-hang-body">
            <p className="nesio-hang-nessa">
              <span className="nesio-hang-nessa-kicker">{L(dict, '念念', 'Nessa')}</span>
              {L(dict, `说一句关于 ${personName} 的事就行,我来归类、认日期。`, `Just say something about ${personName} — I'll sort and date it.`)}
            </p>
            <div className="nesio-hang-input-card">
              <textarea
                className="nesio-hang-input" rows={2}
                placeholder={L(dict, '如「期末年级第一 6月2日」「爸爸每天一片氨氯地平」…', 'e.g. "1st in grade, Jun 2", "one amlodipine daily"…')}
                value={text} onChange={(e) => setText(e.target.value)}
              />
              <div className="nesio-hang-cap-row">
                <button type="button" className="nesio-hang-cap nesio-hang-cap--primary" onClick={runText} disabled={busy}>
                  <IconMic size={16} />{busy ? L(dict, '识别中…', 'Reading…') : L(dict, '说一句', 'Speak')}
                </button>
                <button type="button" className="nesio-hang-cap" onClick={() => photoRef.current?.click()} disabled={busy}>
                  <IconCamera size={16} />{L(dict, '拍 / 传', 'Photo')}
                </button>
              </div>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden
                onChange={(e) => { void onPickPhoto(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </div>
            {err && <p className="nesio-rel-detail-err" role="alert">{err}</p>}
            <div className="nesio-hang-lock nesio-hang-lock--foot"><IconLock size={12} />{L(dict, '敏感项(医疗 / 药物 / 健康)仅你可见 · 不进 AI', 'Sensitive (medical / medication / health) — only you, never sent to AI')}</div>
            <button type="button" className="nesio-hang-redo" onClick={() => setManual(true)}>{L(dict, '想自己填? 手动填 ›', 'Prefer to type it? Fill in manually ›')}</button>
          </div>
        )}
    </NesioSheet>
  );
}
