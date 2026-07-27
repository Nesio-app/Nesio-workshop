/**
 * 反馈事实日志 —— Signal 投影(不再独立 IDB 双写)。
 *
 * 旧方案曾用独立 blob 日志 + 总线订阅,与 `feedback.*` Signal 平行。
 * 2026-07-27(可清数据精简):事实只认 Signal;`readFeedbackLog` / `replayFeedback` 从
 * `feedback.*` 投影。总线仍扇出到 preference / ranker(投影学习器),不在此落第二份事实。
 */
import { getSignals } from '@/lib/life-domain/signal';
import { emitFeedback, onFeedback, type FeedbackEvent, type Reaction } from './feedback-bus';
import { createSignal } from '@/lib/life-domain/create-signal';

const REACTIONS: ReadonlySet<string> = new Set(['useful', 'dismiss', 'wrong', 'done', 'snooze', 'too_much']);

function asReaction(value: unknown): Reaction | null {
  return typeof value === 'string' && REACTIONS.has(value) ? (value as Reaction) : null;
}

function signalToEvent(signal: { type: string; capturedAt: string; payload?: Record<string, unknown> }): FeedbackEvent | null {
  const p = signal.payload || {};
  // 规范总线形:payload 已带 surface/dimension/key/reaction
  if (typeof p.surface === 'string' && typeof p.dimension === 'string' && typeof p.key === 'string') {
    const reaction = asReaction(p.reaction)
      || (p.feedback === 'not_now' ? 'snooze' : asReaction(p.feedback));
    if (reaction) {
      return {
        surface: p.surface,
        dimension: p.dimension,
        key: p.key,
        reaction,
        at: typeof p.at === 'string' ? p.at : signal.capturedAt,
      };
    }
  }
  // feedback.today_card
  if (signal.type === 'feedback.today_card' && typeof p.cardId === 'string') {
    const reaction = p.feedback === 'not_now' ? 'snooze' : asReaction(p.feedback);
    if (!reaction) return null;
    return { surface: 'today', dimension: 'card', key: p.cardId, reaction, at: signal.capturedAt };
  }
  // feedback.retrieval
  if (signal.type === 'feedback.retrieval' && typeof p.targetId === 'string') {
    const reaction = p.verdict === 'not_this' ? 'wrong' : p.verdict === 'useful' ? 'useful' : null;
    if (!reaction) return null;
    return { surface: 'ask', dimension: 'retrieval', key: p.targetId, reaction, at: signal.capturedAt };
  }
  // feedback.reaction(总线落事实)
  if (signal.type === 'feedback.reaction') {
    const reaction = asReaction(p.reaction);
    if (!reaction || typeof p.surface !== 'string' || typeof p.dimension !== 'string' || typeof p.key !== 'string') return null;
    return {
      surface: p.surface,
      dimension: p.dimension,
      key: p.key,
      reaction,
      at: typeof p.at === 'string' ? p.at : signal.capturedAt,
    };
  }
  return null;
}

/** 读全量反馈事实(Signal 投影;时间升序便于回放重建投影)。 */
export function readFeedbackLog(): FeedbackEvent[] {
  const seen = new Set<string>();
  const out: FeedbackEvent[] = [];
  for (const s of getSignals().filter((x) => String(x.type).startsWith('feedback.'))) {
    const e = signalToEvent(s);
    if (!e) continue;
    const k = `${e.surface}|${e.dimension}|${e.key}|${e.reaction}|${e.at.slice(0, 19)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.reverse(); // getSignals 新→旧 → 回放要旧→新
}

/** 回放:可按 surface/dimension 过滤,供某原语从头重建投影。 */
export function replayFeedback(filter?: (e: FeedbackEvent) => boolean): FeedbackEvent[] {
  const log = readFeedbackLog();
  return filter ? log.filter(filter) : log;
}

/**
 * 总线 → Signal:一次 emitFeedback 落一条 `feedback.reaction`(事实唯一入口)。
 * preference/ranker 仍直接订总线;本模块只负责把总线事件变成可回放事实。
 * Today 富反馈另有 `feedback.today_card`(含 evidence ids);总线不再为 today/card 落瘦 `feedback.reaction`。
 */
let wired = false;
export function ensureFeedbackSignalBridge(): void {
  if (wired) return;
  wired = true;
  onFeedback((event) => {
    // Today 富反馈已由 recordSignalFeedback 落 feedback.today_card;跳过瘦 reaction 避免双事实。
    if (event.surface === 'today' && event.dimension === 'card') return;
    try {
      createSignal({
        source: 'manual',
        type: 'feedback.reaction',
        title: `反馈:${event.surface}/${event.dimension}/${event.key}`,
        payload: { ...event },
        confidence: 1,
        retentionPolicy: 'LongLiving',
        tags: ['feedback', event.surface],
        epistemic: 'feedback',
        generator: 'user',
        derivedFrom: [event.key],
      });
    } catch { /* 落事实失败不拖垮扇出 */ }
  });
}

// 模块加载即接线(与旧 onFeedback(append) 同位置)。
ensureFeedbackSignalBridge();

// 再导出总线,方便测试「emit → Signal → readFeedbackLog」闭环。
export { emitFeedback };
