/**
 * 跨区偏好层 · LinUCB contextual bandit(cross-region-reasoning.md §2.3 P3)——纯函数,可单测。
 *
 * 学「你在乎哪类跨区」:每条候选特征 x → 分 = θᵀx + α·√(xᵀA⁻¹x)(利用 + 探索)。
 * 更新:A ← A + xxᵀ;b ← b + reward·x;θ = A⁻¹b(岭回归 λ)。冷启动 θ₀ = 手设先验
 * (A₀=λI、b₀=λ·θ₀ ⇒ θ₀ 生效),复刻「第一天≈按强度排,不更差」。单用户 → 免 CF/DP/embedding。
 */

/** 单位阵 × λ。 */
function scaledIdentity(d, lambda) {
  const A = [];
  for (let i = 0; i < d; i++) {
    A.push(new Array(d).fill(0));
    A[i][i] = lambda;
  }
  return A;
}

/** 高斯-约当求逆(小 d,d~15 足够快、够稳)。返回 null 表示奇异。 */
export function matInverse(M) {
  const n = M.length;
  // 增广 [M | I]
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // 选主元(部分主元法)
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row) => row.slice(n));
}

function matVec(M, v) {
  return M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 初始状态:A=λI,b=λ·θ₀ ⇒ 起始 θ=θ₀(手设先验)。 */
export function createBanditState(priorTheta, { lambda = 1 } = {}) {
  const d = priorTheta.length;
  return {
    d,
    lambda,
    A: scaledIdentity(d, lambda),
    b: priorTheta.map((t) => t * lambda),
  };
}

/** UCB 分 = θᵀx + α·√(xᵀA⁻¹x)。ainv 可传入复用(一批候选算一次逆)。 */
export function banditScore(x, state, { alpha = 0.3, ainv = null } = {}) {
  const Ainv = ainv || matInverse(state.A) || scaledIdentity(state.d, 1 / (state.lambda || 1));
  const theta = matVec(Ainv, state.b);
  const exploit = dot(theta, x);
  const explore = alpha * Math.sqrt(Math.max(0, dot(x, matVec(Ainv, x))));
  return exploit + explore;
}

/** 反馈更新:A += xxᵀ;b += reward·x。返回新状态(不原地改)。 */
export function banditUpdate(x, reward, state) {
  const d = state.d;
  const A = state.A.map((row) => row.slice());
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) A[i][j] += x[i] * x[j];
  const b = state.b.map((bi, i) => bi + reward * x[i]);
  return { ...state, A, b };
}

/** 便捷:对一批候选按 UCB 分降序(逆只算一次)。cands: [{x, ...}]。 */
export function rankByBandit(cands, state, opts = {}) {
  const ainv = matInverse(state.A) || scaledIdentity(state.d, 1 / (state.lambda || 1));
  return cands
    .map((c) => ({ c, score: banditScore(c.x, state, { alpha: opts.alpha ?? 0.3, ainv }) }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.c);
}

export const BANDIT_DEFAULTS = Object.freeze({ alpha: 0.3, lambda: 1 });
