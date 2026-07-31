'use client';

/**
 * ReceiptScanRow —— 拍一张发票/小票,把金额和日期填进来,顺便告诉你**这笔银行里是不是已经有了**。
 *
 * ## 补的是哪一条
 *
 * 「资产上传交税发票 → 自动关联记账条目」这条一直只通了**反方向**:
 * 从资产页记一笔税费,会 `addManualEntry({assetId, assetCostKind})` 并把 expenseId 回写,
 * 双向、删不留孤儿账 —— 那一半是全仓做得最对的业务关联之一。
 * 缺的是正方向:**手里有一张发票,让系统去找账**。
 *
 * 缺的东西其实只有两件,配对逻辑早就在:
 *   · 从图里抽金额/日期 —— `receipt-extract.ts` 写好了,但**一个调用方都没有**;
 *   · 一个入口 —— 就是这个组件。
 *
 * ## 为什么走端上 OCR
 *
 * 识字这件事端上做得了(`lib/native/vision.ts`,验血报告那条路已经在用),
 * 所以这里**不打云**:免费可用、离线可用、发票不出手机。
 * 没有端上能力时不偷偷降级去云 —— 直接说「这台设备认不了字,手填吧」,
 * 因为发票上是税号和金额,替用户决定把它发出去不合适。
 *
 * ## 重点不是填得快,是**别记两遍**
 *
 * 刷卡付的税费,Plaid 那条流水已经在账上了。再手记一笔就是双计 ——
 * 这和 `spend-claim` 里「price 只认领不记账」是同一条规矩。
 * 所以抽到金额之后立刻跑一次 `receiptMatchCandidates`:银行里有对得上的,
 * 就把那条摆出来提醒你,并给「不是同一笔」的出口(`rejectPair`,记住了不再问)。
 */

import { useCallback, useRef, useState } from 'react';
import Button from '@/components/portal/ui/Button';
import { extractReceiptFields, type ReceiptFields } from '@/lib/portal/receipt-extract';
import { receiptMatchCandidates, rejectPair, loadRejectedPairs } from '@/lib/portal/receipt-match';
import { loadBankTx, type BankTx } from '@/lib/portal/providers/bank-tx';
import { visionAvailability, recognizeOnDevice } from '@/lib/native/vision';
import { L } from '@/lib/portal/i18n';

/** 给配对用的假 id —— 一张还没入库的发票没有 id,用「金额+日期」当稳定键,
 *  这样「不是同一笔」这个否决记得住(同一张发票再扫一次不会又问一遍)。 */
function scanKey(f: ReceiptFields): string {
  return `scan:${f.amount}:${f.date ?? 'nodate'}`;
}

type Phase =
  | { s: 'idle' }
  | { s: 'reading' }
  | { s: 'blocked'; reason?: string }          // 这台设备认不了字
  | { s: 'failed'; message?: string }          // 认字这一步出错
  | { s: 'empty' }                             // 认出字了,但没有一个像金额
  | { s: 'done'; fields: ReceiptFields; dup: BankTx | null };

export default function ReceiptScanRow({ dict, onExtracted }: {
  dict: 'zh' | 'en';
  /** 抽到了就回填到表单。`dup` 非空表示银行里已经有这笔,调用方应该劝阻再记一笔。 */
  onExtracted: (fields: ReceiptFields, dup: BankTx | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });

  const run = useCallback(async (file: File) => {
    setPhase({ s: 'reading' });
    let text = '';
    try {
      const avail = await visionAvailability();
      if (!avail.available) { setPhase({ s: 'blocked', reason: avail.reason }); return; }
      const r = await recognizeOnDevice(file);
      if (!r.ok) { setPhase({ s: 'failed', message: r.message }); return; }
      text = r.text;
    } catch {
      setPhase({ s: 'failed' });
      return;
    }

    const fields = extractReceiptFields(text);
    if (!fields) { setPhase({ s: 'empty' }); return; }

    // 银行里有没有对得上的 —— 有的话再手记一笔就是双计
    let dup: BankTx | null = null;
    if (fields.date) {
      try {
        const cands = receiptMatchCandidates(
          { id: scanKey(fields), amount: fields.amount, occurredAt: fields.date, merchant: fields.merchant ?? undefined },
          loadBankTx(),
          { rejected: loadRejectedPairs(), max: 1 },
        );
        dup = cands[0] ?? null;
      } catch { dup = null; }
    }
    setPhase({ s: 'done', fields, dup });
    onExtracted(fields, dup);
  }, [onExtracted]);

  const notSame = useCallback((f: ReceiptFields, tx: BankTx) => {
    try { rejectPair(scanKey(f), tx.id); } catch { /* 记不住否决不影响继续 */ }
    setPhase({ s: 'done', fields: f, dup: null });
    onExtracted(f, null);
  }, [onExtracted]);

  return (
    <div className="nesio-receipt-scan">
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(f); }} />

      <Button variant="soft" size="sm" disabled={phase.s === 'reading'}
        onClick={() => fileRef.current?.click()}>
        {phase.s === 'reading'
          ? L(dict, '正在认字…', 'Reading…')
          : L(dict, '拍发票自动填', 'Scan a receipt')}
      </Button>

      {/* 每一种走不通都要说出来 —— 按钮点了没反应是这个仓里反复出现的老病 */}
      {phase.s === 'blocked' && (
        <p className="nesio-receipt-scan-note" role="alert">
          {L(dict, '这台设备认不了字,金额手填吧。发票不会被发到云端。',
            'This device can’t read text on-device. Enter the amount by hand — the receipt is never uploaded.')}
        </p>
      )}
      {phase.s === 'failed' && (
        <p className="nesio-receipt-scan-note" role="alert">
          {L(dict, '这张没认出来。换一张更清楚的,或者手填。', 'Could not read this one. Try a clearer photo, or type it in.')}
          {' '}
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>{L(dict, '再试一次', 'Try again')}</Button>
        </p>
      )}
      {phase.s === 'empty' && (
        <p className="nesio-receipt-scan-note" role="alert">
          {L(dict, '认出字了,但没找到像金额的数字。手填吧。', 'Read the text, but found nothing that looks like an amount. Type it in.')}
        </p>
      )}

      {phase.s === 'done' && (
        <>
          {/* 「取最大」是猜的,得让人核对;靠关键词找到的就不啰嗦 */}
          {phase.fields.amountFrom === 'largest' && (
            <p className="nesio-receipt-scan-note">
              {L(dict, '这张上面没写「合计」,填的是最大的那个数 —— 核对一下。',
                'No “total” on this one — used the largest number. Please double-check.')}
            </p>
          )}
          {phase.dup && (
            <div className="nesio-receipt-scan-dup" role="alert">
              <p style={{ margin: 0 }}>
                {L(dict, '银行里已经有一笔对得上:', 'Your bank already has a matching charge:')}
                {' '}
                <strong>{phase.dup.name || L(dict, '一笔支出', 'a charge')}</strong>
                {' · '}{phase.dup.date}{' · '}{phase.dup.amount.toFixed(2)}
              </p>
              <p style={{ margin: 'var(--space-1) 0 0' }}>
                {L(dict, '再记一笔的话这钱会被算两次。', 'Recording it again would count this money twice.')}
              </p>
              <Button variant="ghost" size="sm"
                onClick={() => notSame(phase.fields, phase.dup as BankTx)}>
                {L(dict, '不是同一笔', 'Not the same one')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
