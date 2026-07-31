'use client';

/**
 * ReconcileSheet — 上传 statement 对账(L3-b)。
 *
 * 流程:选文件 → **端上**取文本层 → 确定性解析 → 三条自校验 → 候选行复核 → 逐行确认入账。
 *
 * 三条设计红线,在这个文件里的体现:
 *
 * ① **文件不出设备。** pdf.js 在浏览器里跑,零网络、零 AI。statement 是最敏感的文件之一,
 *    传出去做「智能识别」这件事本身就不该发生。所以这里没有任何 fetch。
 *
 * ② **解析器不写账。** 这里显示的全部是候选行;只有你勾了、点了「记入账本」才落库。
 *    解析错了重新传一次就行,账本一个字不动。
 *
 * ③ **每个异步动作都有可见失败态。** 选文件/解析/入账三处各有自己的错误行 + 重试出口。
 *    「点了没反应」是本仓反复出现的病根,这里不许再犯。
 *
 * 算钱的部分全在 lib/portal/statement-parse.ts 和 statement-reconcile.ts 里(纯函数,
 * 有契约、能反证)。这个组件只负责显示和收集你的确认。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { openPdf, groupItemsIntoRows, type PdfLine } from '@/lib/portal/pdfjs-loader';
import { parseStatement, parseVerdict, selfCheckStatement, type StatementParseResult } from '@/lib/portal/statement-parse';
import { reviewStatement, candidateToEntry, importedRowIds, type StatementReview } from '@/lib/portal/statement-reconcile';
import { addExpense, loadDomainExpenses, defaultFinanceCurrency } from '@/lib/portal/finance-sources';
import { addReconcileRecord, voucherAssetId, recordsForFile } from '@/lib/portal/reconcile-record';
import { putLocalFile, MAX_FILE_BYTES, prettyBytes } from '@/lib/portal/local-file-store';
import { loadCombinedFinanceTx } from '@/lib/portal/tesla-finance';
import { formatMoney } from '@/lib/portal/bank-tx';

type Phase = 'idle' | 'reading' | 'review' | 'saved';

/** 同一份文件要得到同一个 key —— 它是幂等键的一半(另一半是行号)。 */
const fileKeyOf = (f: File): string => `${f.name}:${f.size}:${f.lastModified}`;

export default function ReconcileSheet({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileKey, setFileKey] = useState('');
  const [parsed, setParsed] = useState<StatementParseResult | null>(null);
  const [review, setReview] = useState<StatementReview | null>(null);
  const [rawById, setRawById] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /**
   * 缺账期时用哪一年重解析。**默认就填当年,不留空。**
   *
   * 之前初值是 `''`,而输入框的 placeholder 写着 "2026" —— 灰字看着就像已经填好了。
   * 可下面那颗「用这一年重新解析」是 `disabled={!/^\d{4}$/.test(year)}`:
   * 空字符串 → 按钮是禁用的 → 点下去**什么都不会发生**,而屏幕上没有一处说明为什么。
   * 这就是「点了没反应」的全部真相:不是逻辑没跑,是按钮根本没被允许跑。
   *
   * 现在默认填当年 —— 对账单绝大多数是最近开的,填错了当场改一个数字的事;
   * 而「看着填了、其实没填」是查都查不出来的。
   */
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [savedCount, setSavedCount] = useState(0);
  /** 点过「不对,我自己来」的诊断 —— 同一份单子里不再劝第二次。 */
  const [refusedFix, setRefusedFix] = useState(false);
  /** 最近一次选的文件缓存起来 —— 填完年份要能就地重解析,不用再选一次文件。 */
  const pagesRef = useRef<PdfLine[][] | null>(null);
  /** 原文件本身:留着当凭证(会计意义上的原始单据)。 */
  const fileRef2 = useRef<File | null>(null);
  const [keepVoucher, setKeepVoucher] = useState(true);
  /** 这份单子之前对过几次 —— 显示出来,不拦截。 */
  const [priorRuns, setPriorRuns] = useState(0);

  const reset = () => {
    setPhase('idle'); setErr(''); setFileName(''); setFileKey('');
    setParsed(null); setReview(null); setRawById({}); setPicked(new Set());
    setYear(String(new Date().getFullYear())); setSavedCount(0); setRefusedFix(false); setPriorRuns(0);
    setKeepVoucher(true); pagesRef.current = null; fileRef2.current = null;
  };

  /** 拿一批(可能已被人工修正过的)行重新算复核清单。解析不重跑 —— 修正的是解析结果本身。 */
  const rebuild = useCallback((res0: StatementParseResult, key: string, raw: Record<string, string>) => {
    // 自校验必须跟着行一起重算 —— 改了一行金额却沿用旧的 selfCheck,
    // 面板会在已经改对之后继续显示「差 $1233.56」,人会以为按钮没生效。
    const res: StatementParseResult = { ...res0, selfCheck: selfCheckStatement(res0.header, res0.rows) };
    setParsed(res);
    const rev = reviewStatement({
      rows: res.rows, header: res.header,
      bankTx: loadCombinedFinanceTx(), existing: loadDomainExpenses(),
      fileKey: key, rawById: raw,
    });
    setReview(rev);
    setPicked(new Set(rev.defaultSelected));
  }, []);

  /** 解析已经取好的文本层(选文件后、以及补填年份后都走这里)。 */
  const runParse = useCallback((pages: PdfLine[][], key: string, fallbackYear?: number) => {
    const res = parseStatement(pages, fallbackYear ? { fallbackYear } : {});
    const raw: Record<string, string> = {};
    for (const r of res.rows) raw[r.id] = r.raw;
    setRawById(raw);
    setRefusedFix(false);
    rebuild(res, key, raw);
    setPhase('review');
  }, [rebuild]);

  /**
   * 「就这么改」:按诊断算好的值改这一行,然后重算。
   *
   * 只有 `reread_amount` 这一种能一键改 —— 它改的是**解析结果**(我读错了一个数),
   * 不是改你的账。另外两种(漏记一笔 / 多记一笔)的动作分别是「勾上它」和
   * 「去账本里作废那条」,都得你自己点,这里不代劳。
   */
  function applyFix() {
    if (!parsed || !review?.diagnosis) return;
    const { fix } = review.diagnosis;
    if (fix.kind !== 'reread_amount' || fix.to === undefined) return;
    const id = fix.targetIds[0];
    const next: StatementParseResult = {
      ...parsed,
      rows: parsed.rows.map((r) => (r.id === id ? { ...r, amount: fix.to as number } : r)),
    };
    rebuild(next, fileKey, rawById);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setPhase('reading'); setErr(''); setFileName(f.name);
    const key = fileKeyOf(f);
    setFileKey(key);
    fileRef2.current = f;
    setPriorRuns(recordsForFile(key).length);
    try {
      const buf = await f.arrayBuffer();
      const doc = await openPdf(buf);
      const pages: PdfLine[][] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        pages.push(groupItemsIntoRows(content.items));
      }
      await doc.destroy?.();
      pagesRef.current = pages;
      runParse(pages, key);
    } catch {
      // 红线③:失败必须说出来,并留一个能再来一次的出口
      setErr(t('这份文件读不出来 —— 可能不是 PDF,或者它是扫描件(没有文字层)。',
        'Could not read this file — it may not be a PDF, or it is a scan with no text layer.'));
      setPhase('idle');
    }
  }

  async function saveSelected() {
    if (!review) return;
    setErr('');
    const cur = defaultFinanceCurrency();
    // 幂等在**落库这一刻**再查一次,不能只靠打开面板时算的那份状态:
    // 连点两次「记入账本」中间没有重新解析,光凭 picked 会把同一批再记一遍。
    // (下面那句失败提示说「再点一次会跳过已存的」—— 得先让它是真的。)
    const already = importedRowIds(loadDomainExpenses(), fileKey);
    let n = 0;
    try {
      for (const row of review.rows) {
        if (!picked.has(row.candidate.id)) continue;
        if (already.has(row.candidate.id)) continue;
        const e = candidateToEntry(row.candidate, fileKey);
        const saved = addExpense({
          amount: e.amount, kind: e.kind, currency: cur, occurredAt: e.date,
          source: 'manual', sourceRef: e.sourceRef, includeInFinance: true,
          ...(e.note ? { note: e.note, merchant: e.note } : {}),
        });
        if (!saved) throw new Error('save_failed');
        n += 1;
      }
      setSavedCount(n);
      setPhase('saved');
      onSaved();
    } catch {
      setErr(t('有一条没存上,已经存进去的那些还在。再点一次会跳过已存的。',
        'One row failed to save; the ones already saved are kept. Trying again skips them.'));
      return;
    }

    // ── 凭证 + 对账记录 ──────────────────────────────────────────────────
    // 放在入账**之后**、且失败不回滚:账已经记进去了,凭证没存上不该把账撤回来。
    // 但也不许静默 —— 人以为「留痕了」而其实没有,比不留更糟。
    let asset: string | undefined;
    const f = fileRef2.current;
    if (keepVoucher && f) {
      if (f.size > MAX_FILE_BYTES) {
        setErr(`${t('账已经记好了,但这份文件太大存不下凭证(上限', 'Rows are saved, but the file is too big to keep as a voucher (max')} ${prettyBytes(MAX_FILE_BYTES)})。`);
      } else {
        const id = voucherAssetId(fileKey);
        const ok = await putLocalFile(id, f, { name: f.name, mimeType: f.type || 'application/pdf', size: f.size });
        if (ok) asset = id;
        else setErr(t('账已经记好了,但原件没存下来 —— 本机空间可能不够。',
          'Rows are saved, but the original file could not be kept — this device may be out of space.'));
      }
    }
    const rec = addReconcileRecord({
      fileKey, fileName,
      ...(parsed?.header.accountTail ? { accountTail: parsed.header.accountTail } : {}),
      ...(parsed?.header.periodStart ? { periodStart: parsed.header.periodStart } : {}),
      ...(parsed?.header.periodEnd ? { periodEnd: parsed.header.periodEnd } : {}),
      ...(review.reconcile ? {
        expected: review.reconcile.expected,
        computed: review.reconcile.computed,
        delta: review.reconcile.delta,
      } : {}),
      acceptedCount: n,
      ...(asset ? { voucherAssetId: asset } : {}),
    });
    if (!rec) {
      setErr(t('账已经记好了,但这次对账没留下记录 —— 本机存储写不进去。',
        'Rows are saved, but this reconciliation was not recorded — local storage refused the write.'));
    }
  }

  const verdict = parsed ? parseVerdict(parsed) : null;
  const counts = useMemo(() => {
    const c = { new: 0, matched: 0, imported: 0 };
    for (const r of review?.rows ?? []) c[r.state] += 1;
    return c;
  }, [review]);

  // ── 样式(全部走 token,零硬编码色)──────────────────────────────────────
  const label: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: '0 0 4px' };
  const primary: React.CSSProperties = {
    border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px',
    fontSize: 'var(--text-body)', fontWeight: 600, fontFamily: 'var(--font-sans)',
    cursor: 'pointer', background: 'var(--portal-accent)', color: '#fff',
  };
  const ghost: React.CSSProperties = {
    border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '10px',
    fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'var(--font-sans)',
    cursor: 'pointer', background: 'transparent', color: 'var(--portal-accent)',
  };
  const checkTone = (s: 'pass' | 'fail' | 'unknown') =>
    s === 'pass' ? 'var(--status-go)' : s === 'fail' ? 'var(--status-gentle)' : 'var(--portal-muted)';

  const stateChip = (s: 'new' | 'matched' | 'imported') => ({
    fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-pill)',
    background: s === 'new' ? 'var(--status-calm-soft)' : s === 'matched' ? 'var(--status-go-soft)' : 'var(--portal-accent-soft)',
    color: s === 'new' ? 'var(--status-calm)' : s === 'matched' ? 'var(--status-go)' : 'var(--portal-muted)',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <NesioSheet variant="bottom" open={open}
      onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}
      ariaLabel={t('上传对账单', 'Reconcile a statement')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>

        <div>
          <p style={{ fontSize: 'var(--text-h3)', fontWeight: 700, margin: 0, color: 'var(--portal-ink)' }}>
            {t('对一份账单', 'Check a statement')}
          </p>
          {/* 2026-07-31:「文件只在这台设备上解析,不上传……」这段删掉。
              触发这张卡的那颗按钮上就写着「上传对账单核对(只在本机解析,不上传)」——
              同一句话在一屏里说两遍;而「你确认了才进账本」下面整屏都是逐条勾选,
              界面本身已经把它演出来了。 */}
        </div>

        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="nesio-visually-hidden"
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />

        {phase === 'idle' && (
          <>
            <button type="button" style={primary} onClick={() => fileRef.current?.click()}>
              {t('选一份 PDF 账单', 'Pick a PDF statement')}
            </button>
            {err && (
              <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-gentle)', margin: 0, lineHeight: 1.6 }}>{err}</p>
                <button type="button" style={ghost} onClick={() => fileRef.current?.click()}>
                  {t('换一份再试', 'Try another file')}
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'reading' && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', margin: 0 }}>
            {t('正在本机读取…', 'Reading on this device…')} {fileName}
          </p>
        )}

        {phase === 'review' && parsed && review && (
          <>
            {priorRuns > 0 && (
              <p style={{ ...label, margin: 0, lineHeight: 1.6 }}>
                {`${t('这份单子之前对过', 'You have reconciled this statement')} ${priorRuns} ${t('次 —— 已经记过的行下面会标出来,不会重复记。', 'time(s) — rows already added are marked below and will not be double-counted.')}`}
              </p>
            )}
            {/* 只差一个年份 —— 单独一档,别报成「不支持」 */}
            {verdict === 'need_year' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* 2026-07-31:那段两行的解释删了。留一个短标签就够 ——
                    「哪一年」三个字 + 一个填好的年份框,要做什么一眼就清楚。 */}
                <p style={{ ...label, margin: 0 }}>{t('这份单子是哪一年的', 'Which year is this statement')}</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input inputMode="numeric" placeholder="2026" value={year} onChange={(e) => setYear(e.target.value)}
                    style={{ width: 100, border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--text-body)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }} />
                  <button type="button" style={{ ...ghost, flex: 1 }}
                    disabled={!/^\d{4}$/.test(year)}
                    onClick={() => {
                      // 红线:没有静默分支。pages 丢了(重进过面板 / reset 过)就说出来并给出口,
                      // 不能和「点了没反应」长成一个样。
                      if (!pagesRef.current) {
                        setErr(t('这份单子的内容已经不在手边了 —— 再选一次文件就行。',
                          'The parsed pages are no longer in memory — pick the file again.'));
                        setPhase('idle');
                        return;
                      }
                      runParse(pagesRef.current, fileKey, Number(year));
                    }}>
                    {t('用这一年重新解析', 'Re-parse with this year')}
                  </button>
                </div>
              </div>
            )}

            {verdict === 'unusable' && (
              <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-gentle)', margin: 0, lineHeight: 1.6 }}>
                {t('这份 PDF 里没有可读的文字层 —— 多半是扫描件。可以先试试从银行导出 CSV。',
                  'No readable text layer — likely a scan. Exporting a CSV from your bank works better for now.')}
              </p>
            )}

            {/* 三条自校验:解析器自己说自己对不对 */}
            {parsed.rows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ ...label, margin: 0 }}>{t('解析自检', 'Parser self-check')}</p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: checkTone(parsed.selfCheck.balance) }}>
                  {parsed.selfCheck.balance === 'pass'
                    ? t('期初 + 这些交易 = 期末 ✓', 'Opening + these = closing ✓')
                    : parsed.selfCheck.balance === 'fail'
                      ? `${t('和期末余额差', 'Off from closing balance by')} ${formatMoney(Math.abs(parsed.selfCheck.balanceDelta ?? 0))}`
                      : t('这份单子没印期初/期末,这条查不了', 'No opening/closing printed — cannot check this one')}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: checkTone(parsed.selfCheck.period) }}>
                  {parsed.selfCheck.period === 'fail'
                    ? `${parsed.selfCheck.outOfPeriod.length} ${t('笔日期落在账期之外', 'rows fall outside the period')}`
                    : parsed.selfCheck.period === 'pass'
                      ? t('日期都在账期内 ✓', 'All dates within the period ✓')
                      : t('页眉里没找到账期', 'No period found in the header')}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: checkTone(parsed.selfCheck.count) }}>
                  {parsed.selfCheck.count === 'fail'
                    ? `${t('单子写着', 'Statement says')} ${parsed.selfCheck.countClaimed} ${t('笔,我读出', 'rows; I read')} ${parsed.selfCheck.countParsed}`
                    : parsed.selfCheck.count === 'pass'
                      ? t('笔数对得上 ✓', 'Row count matches ✓')
                      : `${t('读出', 'Read')} ${parsed.selfCheck.countParsed} ${t('笔(单子没写总数)', 'rows (no total printed)')}`}
                </p>
              </div>
            )}

            {/* 差额诊断:哪一行 / 为什么 / 怎么改 —— 不许只报「差 $X」 */}
            {review.diagnosis && review.diagnosis.reason !== 'balanced' && !refusedFix && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 'var(--space-3)', border: '1px solid var(--portal-accent-border)', borderRadius: 'var(--radius-md)', background: 'var(--portal-accent-soft)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--portal-ink)' }}>
                  {t('差', 'Off by')} {formatMoney(Math.abs(review.diagnosis.delta))}
                </p>
                {review.diagnosis.locus.map((l) => (
                  <p key={l.id} style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
                    {rawById[l.id] || l.merchant || l.id}
                  </p>
                ))}
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
                  {review.diagnosis.reason === 'amount_misread'
                    ? `${t('这一行的金额我读成了别的数;按', 'I read this row\'s amount wrong; reading it as')} ${formatMoney(Math.abs(review.diagnosis.fix.to ?? 0))} ${t('读就正好对上', 'makes it balance')}`
                    : review.diagnosis.reason === 'missing_in_ledger'
                      ? t('这一笔银行有、账本没有 —— 勾上它就对上了。', 'The bank has this one and your ledger does not — tick it and it balances.')
                      : review.diagnosis.reason === 'extra_in_ledger'
                        ? t('账本里多了一笔 —— 多半是重复记了。', 'Your ledger has one extra — likely a duplicate.')
                        : t('查到这些线索,但凑不出一个确定的改法 —— 先不猜。',
                          'These are the leads, but nothing adds up exactly — not guessing.')}
                </p>
                {/* 只有「金额读错了」能一键改 —— 它改的是**我的解析结果**,不是改你的账。
                    另两种(漏记 / 多记)的动作是「勾上它」和「去账本里作废那条」,得你自己点。 */}
                {review.diagnosis.fix.kind === 'reread_amount' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" style={{ ...ghost, flex: 1 }} onClick={applyFix}>
                      {t('就这么改', 'Fix it that way')}
                    </button>
                    <button type="button" style={{ ...ghost, flex: 1 }} onClick={() => setRefusedFix(true)}>
                      {t('不对,我自己来', 'No — I will handle it')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 候选行 */}
            {review.rows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ ...label, margin: 0 }}>
                  {`${t('新的', 'New')} ${counts.new} · ${t('已有', 'Already there')} ${counts.matched} · ${t('之前记过', 'Imported before')} ${counts.imported}`}
                </p>
                {review.rows.map((r) => {
                  const on = picked.has(r.candidate.id);
                  return (
                    <label key={r.candidate.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--portal-line)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={on}
                        onChange={() => setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(r.candidate.id)) n.delete(r.candidate.id); else n.add(r.candidate.id);
                          return n;
                        })} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.candidate.description || t('(没有描述)', '(no description)')}
                        </span>
                        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                          {r.candidate.occurredAt} · {t('第', 'p.')}{r.candidate.page}{t(' 页', '')}
                          {r.state === 'matched' && r.dayGap != null && r.dayGap > 0
                            ? ` · ${t('账本里那笔差', 'ledger row is')} ${r.dayGap} ${t('天', 'd off')}`
                            : ''}
                        </span>
                      </span>
                      <span style={stateChip(r.state)}>
                        {r.state === 'new' ? t('新的', 'New') : r.state === 'matched' ? t('已有', 'Have it') : t('记过', 'Done')}
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: r.candidate.amount < 0 ? 'var(--portal-ink)' : 'var(--status-go)' }}>
                        {r.candidate.amount < 0 ? '-' : '+'}{formatMoney(Math.abs(r.candidate.amount))}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* 认不出来的行:留着给人看,不许悄悄丢 */}
            {parsed.skipped.length > 0 && (
              <details>
                <summary style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', cursor: 'pointer' }}>
                  {`${parsed.skipped.length} ${t('行我没认出来 —— 点开看看是不是漏了什么', 'rows I could not read — open to check nothing is missing')}`}
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                  {parsed.skipped.slice(0, 40).map((s, i) => (
                    <p key={`${s.page}-${s.line}-${i}`} style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.5 }}>
                      {t('第', 'p.')}{s.page}{t(' 页 第', ' line ')}{s.line}{t(' 行', '')}:{s.raw}
                    </p>
                  ))}
                </div>
              </details>
            )}

            {err && <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-risk)', margin: 0, lineHeight: 1.6 }}>{err}</p>}

            {review.rows.length > 0 && (
              <>
                {/* 凭证:会计意义上的原始单据。存本机(和其他附件同一套),
                    会进你自己的备份,不进任何服务器 —— 这句话要说出来,
                    因为 statement 是最敏感的文件之一,人有权先知道再决定。 */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={keepVoucher} onChange={() => setKeepVoucher((v) => !v)} style={{ marginTop: 3 }} />
                  <span style={{ ...label, margin: 0, lineHeight: 1.6 }}>
                    {t('把原件留作凭证(存在这台设备上,会进你自己的备份,不上任何服务器)',
                      'Keep the original as a voucher (stored on this device, included in your own backup, never uploaded)')}
                  </span>
                </label>
                <button type="button" style={{ ...primary, opacity: picked.size ? 1 : 0.5 }} disabled={!picked.size}
                  onClick={() => { void saveSelected(); }}>
                  {`${t('记入账本', 'Add to ledger')}(${picked.size})`}
                </button>
              </>
            )}
            <button type="button" style={ghost} onClick={() => fileRef.current?.click()}>
              {t('换一份账单', 'Another statement')}
            </button>
          </>
        )}

        {phase === 'saved' && (
          <>
            {/* ⚠️ 这里必须渲染 err:凭证/对账记录的失败发生在 setPhase('saved') **之后**,
                只在 review 那一屏渲染的话,这些提示 set 了却永远看不到 ——
                正是本仓反复出现的「写了没接上」。自查第二遍抓到的。 */}
            {err && <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-gentle)', margin: 0, lineHeight: 1.6 }}>{err}</p>}
            <p style={{ fontSize: 'var(--text-body)', color: 'var(--status-go)', margin: 0 }}>
              {`${t('记下了', 'Added')} ${savedCount} ${t('笔。同一份单子再传一次不会重复记。', 'rows. Re-uploading the same statement will not double-count.')}`}
            </p>
            <button type="button" style={ghost} onClick={() => fileRef.current?.click()}>
              {t('再传一份', 'Another statement')}
            </button>
            <button type="button" style={ghost} onClick={() => { reset(); onClose(); }}>
              {t('完成', 'Done')}
            </button>
          </>
        )}
      </div>
    </NesioSheet>
  );
}
