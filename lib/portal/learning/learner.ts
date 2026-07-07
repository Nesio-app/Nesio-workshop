/**
 * Learner 底座(pilot)—— 把散在 6 个 learner 里重复的三样共性收成一处:
 *   ① 反馈事件(4 个用户侧 learner 的反馈动词逐字相同)
 *   ② 持久化模板(全是 load→JSON→revive→save 的同构样板)
 *   ③ 通知/扇出(一次反馈点击此前手工 fan-out 到多个存储)
 *
 * **不统一「更新律」**:SGD / EWMA / 计数投票 / 覆盖 / 滑窗统计各异,是各 learner 的本质,
 * 留成各自的策略。底座只提供「反馈进来 → 各 learner 自己更新 → 各自持久化」的骨架。
 *
 * pilot:guidance-ranker 先迁到这上面(见 guidance-ranker.ts),其余 learner 后续逐个跟。
 * 持久化用**同步 localStorage**(learner 状态都很小,读取点要同步,不上 IDB)。
 */

// ── 反馈事件 + 总线 ────────────────────────────────────────────────────────────

/** 用户侧统一反馈动词(useful=采纳,其余=没采纳/别打扰)。 */
export type FeedbackVerdict = 'useful' | 'wrong' | 'not_now' | 'too_much';

export interface FeedbackEvent {
  verdict: FeedbackVerdict;
  cardId?: string;  // 卡片反馈(ranker/card-feedback 按此取回上下文)
  domain?: string;  // 领域反馈(mirror 按此调领域权重)
  at: string;       // ISO 时间戳
}

type FeedbackHandler = (e: FeedbackEvent) => void;
const handlers = new Set<FeedbackHandler>();

/** learner 注册:此后每次 emitFeedback 都会收到。返回注销函数。 */
export function registerLearner(handler: FeedbackHandler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/**
 * 一次反馈扇出到所有已注册 learner。best-effort 隔离:单个 learner 抛错不影响其余
 * (拍快照遍历,允许 handler 在回调里注销自己)。
 */
export function emitFeedback(event: FeedbackEvent): void {
  for (const h of [...handlers]) {
    try { h(event); } catch { /* 单 learner 失败不拖垮其余 */ }
  }
}

/** 供测试:清空注册,避免用例间串扰。 */
export function _resetLearners(): void {
  handlers.clear();
}

// ── 持久化模板 ────────────────────────────────────────────────────────────────

export interface LearnerStore<S> {
  load(): S;
  save(s: S): void;
}

/**
 * 同步 localStorage 存取模板。fresh() 给冷启动初值;revive() 校验/补全旧数据(返回 null = 不合法,退回 fresh)。
 * 收敛了 mirror-profile / guidance-ranker / card-feedback 各写一遍的 load→JSON→save 样板。
 */
export function createLearnerStore<S>(opts: {
  key: string;
  fresh: () => S;
  revive?: (raw: unknown) => S | null;
}): LearnerStore<S> {
  return {
    load() {
      if (typeof window === 'undefined') return opts.fresh();
      try {
        const raw = JSON.parse(localStorage.getItem(opts.key) || 'null');
        if (raw != null) {
          const r = opts.revive ? opts.revive(raw) : (raw as S);
          if (r != null) return r;
        }
      } catch { /* 解析失败 → 冷启动 */ }
      return opts.fresh();
    },
    save(s: S) {
      if (typeof window === 'undefined') return;
      try { localStorage.setItem(opts.key, JSON.stringify(s)); } catch { /* quota */ }
    },
  };
}
