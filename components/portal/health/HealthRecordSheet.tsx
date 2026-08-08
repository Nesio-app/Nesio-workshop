'use client';

/**
 * HealthRecordSheet — 手动记一条健康数据(健康镜头,2026-07-29)。
 *
 * 拍化验单(OCR)押后了 —— 它卡在识别准确率上,而 A/C 两屏的价值来自「数据在主事实表里」,
 * 跟数据是拍进来的还是手打进来的无关。所以先把**手录**这条路铺通:
 * 没导过 Apple 健康记录的人,今天就能用上整个镜头。OCR 到位后接的是同一个确认面,
 * 只是把这张表单预填好而已。
 *
 * 四类对应四种 payload:化验值 / 在用药 / 症状 / 就诊。
 * 成员选择沿用联系人身份键 —— 家人的记录挂到 TA 身上,人物详情页就能看到。
 */

import { useEffect, useMemo, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { recordLab, recordMed, recordSymptom, recordVisit, SELF_PERSON_KEY } from '@/lib/health/health-signals';
import { buildRelationships } from '@/lib/portal/relationships';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Kind = 'lab' | 'med' | 'symptom' | 'visit';

const KINDS: Array<{ k: Kind; zh: string; en: string }> = [
  { k: 'lab', zh: '化验值', en: 'Lab' },
  { k: 'med', zh: '在用药', en: 'Medication' },
  { k: 'symptom', zh: '症状', en: 'Symptom' },
  { k: 'visit', zh: '就诊', en: 'Visit' },
];

const today = () => new Date().toLocaleDateString('en-CA');

export default function HealthRecordSheet({ open, onClose, onSaved, initialKind = 'lab' }: { open: boolean; onClose: () => void; onSaved?: () => void; initialKind?: Kind }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [kind, setKind] = useState<Kind>('lab');
  const [who, setWho] = useState(SELF_PERSON_KEY);
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 化验
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  // 用药
  const [dose, setDose] = useState('');
  const [freq, setFreq] = useState('');
  // 症状
  const [severity, setSeverity] = useState<1 | 2 | 3>(1);
  // 就诊
  const [place, setPlace] = useState('');
  const [dept, setDept] = useState('');
  const [note, setNote] = useState('');
  // bug3 p41:就诊加医生(可从 People 里挑,挑了就带上归一 key)+ 保险 + 价格
  const [doctor, setDoctor] = useState('');
  const [doctorKey, setDoctorKey] = useState('');
  const [insurance, setInsurance] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setErr(null); setDate(today());
    setName(''); setValue(''); setUnit(''); setLow(''); setHigh('');
    setDose(''); setFreq(''); setSeverity(1); setPlace(''); setDept(''); setNote('');
    setDoctor(''); setDoctorKey(''); setInsurance(''); setPrice('');
  }, [open, initialKind]);

  // 成员:本人 + 有名字的联系人(家人排前面 —— 健康数据多半是给家里人记的)
  const people = useMemo(() => {
    if (!open) return [];
    try {
      return buildRelationships(getLifeGraph())
        .sort((a, b) => (a.closeness === 'core' ? -1 : 1) - (b.closeness === 'core' ? -1 : 1))
        .slice(0, 12);
    } catch { return []; }
  }, [open]);

  const num = (s: string): number | undefined => {
    const v = Number(s.trim());
    return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
  };

  const save = () => {
    setErr(null);
    const personKey = who;
    try {
      if (kind === 'lab') {
        const v = num(value);
        if (!name.trim() || v === undefined) { setErr(t('指标名和数值都要填。', 'Name and value are both required.')); return; }
        setBusy(true);
        recordLab({ name: name.trim(), value: v, unit: unit.trim(), low: num(low), high: num(high), personKey, date, panel: t('手动记录', 'Manual entry') });
      } else if (kind === 'med') {
        if (!name.trim()) { setErr(t('药名要填。', 'Medication name is required.')); return; }
        setBusy(true);
        // 起始日就是这里选的日期 —— 指标详情屏那条虚线竖线靠它,所以必须记准。
        recordMed({ name: name.trim(), dose: dose.trim() || undefined, freq: freq.trim() || undefined, startedAt: date, personKey });
      } else if (kind === 'symptom') {
        if (!name.trim()) { setErr(t('说一下是什么感觉。', 'Describe the symptom.')); return; }
        setBusy(true);
        recordSymptom({ name: name.trim(), severity, note: note.trim() || undefined, personKey, date });
      } else {
        if (!place.trim() && !dept.trim() && !note.trim() && !doctor.trim()) { setErr(t('至少填一项(医院 / 科室 / 医生 / 记一句)。', 'Fill at least one field.')); return; }
        setBusy(true);
        recordVisit({
          place: place.trim() || undefined, department: dept.trim() || undefined, note: note.trim() || undefined,
          doctor: doctor.trim() || undefined,
          // 只有真从 People 里挑的才带 key —— 手打一个名字不等于关系页里有这个人
          doctorKey: doctorKey || undefined,
          insurance: insurance.trim() || undefined,
          price: num(price), currency: num(price) !== undefined ? 'USD' : undefined,
          personKey, date,
        });
      }
      onSaved?.();
      onClose();
    } catch {
      // 红线:写失败要看得见,不许静默关掉让人以为存上了。
      setErr(t('没能存上,再试一次。', "Couldn't save — try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <NesioSheet variant="bottom" elevated open onOpenChange={(n) => { if (!n) onClose(); }}
      card={false} className="nesio-settings-sheet-card" ariaLabel={t('记一条健康记录', 'Log a health record')}>
      <h2 className="nesio-settings-sheet-title">{t('记一条', 'Log a record')}</h2>
      <div className="nesio-settings-sheet-body">

        <div className="nesio-rel-chips" role="tablist" aria-label={t('类型', 'Type')}>
          {KINDS.map((x) => (
            <button key={x.k} type="button" role="tab" aria-selected={kind === x.k}
              className={`nesio-rel-chip${kind === x.k ? ' nesio-rel-chip--on' : ''}`} onClick={() => { setKind(x.k); setErr(null); }}>
              {t(x.zh, x.en)}
            </button>
          ))}
        </div>

        <label className="nesio-settings-section-label" htmlFor="hr-who" style={{ marginTop: 'var(--space-3)' }}>{t('这是谁的', 'Whose')}</label>
        <select id="hr-who" className="nesio-ob-input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value={SELF_PERSON_KEY}>{t('我', 'Me')}</option>
          {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>

        <label className="nesio-settings-section-label" htmlFor="hr-date" style={{ marginTop: 'var(--space-3)' }}>
          {kind === 'med' ? t('从哪天开始吃', 'Started on') : t('日期', 'Date')}
        </label>
        <input id="hr-date" className="nesio-ob-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        {kind === 'lab' && (
          <>
            <label className="nesio-settings-section-label" htmlFor="hr-name" style={{ marginTop: 'var(--space-3)' }}>{t('指标名', 'Metric')}</label>
            <input id="hr-name" className="nesio-ob-input" value={name} maxLength={40} placeholder={t('如:空腹血糖、糖化血红蛋白', 'e.g. fasting glucose')} onChange={(e) => setName(e.target.value)} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <div style={{ flex: 2 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-val">{t('数值', 'Value')}</label>
                <input id="hr-val" className="nesio-ob-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-unit">{t('单位', 'Unit')}</label>
                <input id="hr-unit" className="nesio-ob-input" value={unit} maxLength={16} placeholder="mmol/L" onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-low">{t('参考下限', 'Ref low')}</label>
                <input id="hr-low" className="nesio-ob-input" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-high">{t('参考上限', 'Ref high')}</label>
                <input id="hr-high" className="nesio-ob-input" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
              </div>
            </div>
            <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
              {t('参考区间填了才画得出绿带 —— 化验单上一般印在数值旁边。留空也能存,只是曲线没有参照。',
                'The reference range draws the green band — usually printed next to the value. Optional, but the curve has no baseline without it.')}
            </p>
          </>
        )}

        {kind === 'med' && (
          <>
            <label className="nesio-settings-section-label" htmlFor="hr-name" style={{ marginTop: 'var(--space-3)' }}>{t('药名', 'Medication')}</label>
            <input id="hr-name" className="nesio-ob-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-dose">{t('剂量', 'Dose')}</label>
                <input id="hr-dose" className="nesio-ob-input" value={dose} maxLength={24} placeholder="0.5g" onChange={(e) => setDose(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-freq">{t('频次', 'Frequency')}</label>
                <input id="hr-freq" className="nesio-ob-input" value={freq} maxLength={24} placeholder={t('每日两次', 'twice daily')} onChange={(e) => setFreq(e.target.value)} />
              </div>
            </div>
          </>
        )}

        {kind === 'symptom' && (
          <>
            <label className="nesio-settings-section-label" htmlFor="hr-name" style={{ marginTop: 'var(--space-3)' }}>{t('哪里不舒服', 'What you felt')}</label>
            <input id="hr-name" className="nesio-ob-input" value={name} maxLength={40} placeholder={t('如:头晕、胃胀', 'e.g. dizziness')} onChange={(e) => setName(e.target.value)} />
            <label className="nesio-settings-section-label" style={{ marginTop: 'var(--space-3)' }}>{t('程度', 'How much')}</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {([1, 2, 3] as const).map((s) => (
                <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)}
                  style={{ flex: 1, padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-sm, 12px)',
                    border: '1px solid var(--portal-line)', cursor: 'pointer',
                    background: severity === s ? 'var(--portal-accent-soft-md)' : 'transparent',
                    color: severity === s ? 'var(--portal-ink)' : 'var(--portal-muted)' }}>
                  {t(['有点', '明显', '难受'][s - 1], ['Mild', 'Moderate', 'Rough'][s - 1])}
                </button>
              ))}
            </div>
            <label className="nesio-settings-section-label" htmlFor="hr-note" style={{ marginTop: 'var(--space-3)' }}>{t('记一句', 'Note')}</label>
            <input id="hr-note" className="nesio-ob-input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
          </>
        )}

        {kind === 'visit' && (
          <>
            <label className="nesio-settings-section-label" htmlFor="hr-place" style={{ marginTop: 'var(--space-3)' }}>{t('医院 / 诊所', 'Place')}</label>
            <input id="hr-place" className="nesio-ob-input" value={place} maxLength={40} onChange={(e) => setPlace(e.target.value)} />
            <label className="nesio-settings-section-label" htmlFor="hr-dept" style={{ marginTop: 'var(--space-3)' }}>{t('科室', 'Department')}</label>
            <input id="hr-dept" className="nesio-ob-input" value={dept} maxLength={24} onChange={(e) => setDept(e.target.value)} />

            {/* bug3 p41:医生名字 —— 可以直接打,也可以从 People 里挑(挑了就关联上) */}
            <label className="nesio-settings-section-label" htmlFor="hr-doctor" style={{ marginTop: 'var(--space-3)' }}>{t('医生', 'Doctor')}</label>
            <input id="hr-doctor" className="nesio-ob-input" value={doctor} maxLength={40}
              onChange={(e) => { setDoctor(e.target.value); setDoctorKey(''); }} />
            {people.length > 0 && (
              <div className="nesio-rel-chips" style={{ marginTop: 'var(--space-2)' }}>
                {people.slice(0, 8).map((p) => (
                  <button key={p.key} type="button"
                    className={`nesio-rel-chip${doctorKey === p.key ? ' nesio-rel-chip--on' : ''}`}
                    onClick={() => {
                      // 再点一次取消关联(名字留着,只是不再指向 People 里那个人)
                      if (doctorKey === p.key) { setDoctorKey(''); return; }
                      setDoctor(p.name); setDoctorKey(p.key);
                    }}>{p.name}</button>
                ))}
              </div>
            )}

            {/* bug3 p41:保险 + 价格 —— 就诊多半连着一笔钱,记在这条上才对得起来 */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <div style={{ flex: 2 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-ins">{t('保险', 'Insurance')}</label>
                <input id="hr-ins" className="nesio-ob-input" value={insurance} maxLength={40} onChange={(e) => setInsurance(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="nesio-settings-section-label" htmlFor="hr-price">{t('价格', 'Price')}</label>
                <input id="hr-price" className="nesio-ob-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>

            <label className="nesio-settings-section-label" htmlFor="hr-note" style={{ marginTop: 'var(--space-3)' }}>{t('记一句', 'Note')}</label>
            <input id="hr-note" className="nesio-ob-input" value={note} maxLength={120} placeholder={t('医生说了什么、下次什么时候来', 'What the doctor said, next visit')} onChange={(e) => setNote(e.target.value)} />
          </>
        )}

        {err && <p className="nesio-rel-detail-err" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button type="button" className="nesio-rel-log-btn" style={{ flex: 1 }} onClick={onClose}>{t('先不记', 'Not now')}</button>
          <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} disabled={busy} onClick={save}>
            {busy ? t('存着…', 'Saving…') : t('记下', 'Save')}
          </button>
        </div>

        <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
          {t('健康信息参考,不作诊断 · 仅本机', 'For reference, not a diagnosis · on this device')}
        </p>
      </div>
    </NesioSheet>
  );
}
