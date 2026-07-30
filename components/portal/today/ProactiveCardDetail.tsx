'use client';

/**
 * ProactiveCardDetail —— 引导卡的详情页(2026-07-30,用户实锤:
 * 「有来源的,我点不进去看细节。可以每个卡片点一下进入细节么」)。
 *
 * 之前的问题不是「没做详情」,是**详情的入口只对两种卡开着**:
 *   · 有 nodeId 的 → 开记忆详情;
 *   · 有 fingerprints 且 resolver 认得出的 → 跳对应板块。
 * 其余(例行卡、月报提醒、金句、兜底卡…)`onOpen` 直接是 undefined —— 整张卡点不动。
 * 而它们**恰恰**是带着「依据 · N 条」的那种,卡面上写着来源,却点不进去看。
 *
 * 这一页是那个兜底:任何卡都能点开,看到它凭什么出现。
 * 依据里带 signalId 的那几条本身也是可点的 —— 那是数据里一直有、却从没接线的指针。
 */

import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import { GuidanceIcon } from '../icons';
import type { ProactiveCardData } from './proactive-types';

export default function ProactiveCardDetail({ card, onClose, onOpenSignal }: {
  card: ProactiveCardData;
  onClose: () => void;
  /** 依据条目可追溯时的跳转(signalId → 记忆节点);解析不出就不给按钮。 */
  onOpenSignal?: (signalId: string) => boolean;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());

  return (
    <NesioSheet
      variant="bottom"
      open
      elevated
      card={false}
      onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel={card.title}
    >
      <div className="nesio-cardetail">
        <div className="nesio-cardetail-head">
          <span className="ic"><GuidanceIcon icon={card.icon} size={18} /></span>
          <h2 className="t">{card.title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label={L(dict, '收起', 'Close')}>✕</button>
        </div>

        <p className="nesio-cardetail-body">{card.body}</p>

        {card.reason && (
          <>
            <p className="nesio-cardetail-label">{L(dict, '为什么现在', 'Why now')}</p>
            <p className="nesio-cardetail-why">{card.reason}</p>
          </>
        )}

        {card.evidence && card.evidence.length > 0 && (
          <>
            <p className="nesio-cardetail-label">{L(dict, '依据', 'Based on')}</p>
            <ul className="nesio-cardetail-ev">
              {card.evidence.map((e, i) => {
                // signalId 在数据里一直有,只是从没被接成入口。能跳就给箭头,不能跳就纯文字 ——
                // 不做「点了没反应」的假链接。
                const jump = e.signalId ? () => { if (onOpenSignal?.(e.signalId!)) onClose(); } : null;
                return (
                  <li key={`${e.label}-${i}`}>
                    {jump ? (
                      <button type="button" className="go" onClick={jump}>
                        <span className="k">{e.label}</span>
                        <span className="v">{e.value}</span>
                        <span className="arr" aria-hidden>›</span>
                      </button>
                    ) : (
                      <span className="flat"><span className="k">{e.label}</span><span className="v">{e.value}</span></span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {card.sourceTags.length > 0 && (
          <>
            <p className="nesio-cardetail-label">{L(dict, '来自', 'From')}</p>
            <div className="nesio-cardetail-tags">
              {card.sourceTags.map((s) => <span key={s} className="tag">{s}</span>)}
            </div>
          </>
        )}
      </div>
    </NesioSheet>
  );
}
