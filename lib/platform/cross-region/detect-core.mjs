/**
 * 跨区推理 · 检测层核心(纯统计,零 ML)—— cross-region-reasoning.md §2.1/§2.2 P1。
 *
 * 目标:从每日快照 journal 的对齐序列里，发现**真**的跨域关系，而不是编造。
 * 手段全是经典统计：Spearman 秩相关(抗非正态/只要单调)+ Dickey-Fuller 平稳性
 * (挡趋势驱动的伪相关)+ 共现(计数型)+ Benjamini-Hochberg 多重检验(一次运行
 * 所有候选一起控假阳)。参数起点值见 §4。
 *
 * 纯函数、可 vm 单测。列元数据(标签/域/敏感度)在 detect.ts(展示层),这里只吃
 * `{key, domain, kind}` 三元组，保证引擎与产品文案解耦。
 */

// ── 特殊函数:Student-t / 卡方 尾概率(自包含,无依赖)────────────────────

/** ln Γ(x) —— Lanczos 近似。 */
function gammaln(xx) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** 正则不完全 Beta 函数的连分式(Numerical Recipes betacf)。 */
function betacf(a, b, x) {
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-9) break;
  }
  return h;
}

/** 正则不完全 Beta I_x(a,b)。 */
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** 双尾 Student-t 尾概率 P(|T| ≥ |t|),df 自由度。 */
export function studentTTwoTailP(t, df) {
  if (!Number.isFinite(t) || df <= 0) return 1;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** erfc(x) —— Numerical Recipes 有理近似,精度 ~1.2e-7。 */
function erfcc(x) {
  const z = Math.abs(x);
  const tt = 1 / (1 + 0.5 * z);
  const ans =
    tt *
    Math.exp(
      -z * z - 1.26551223 +
        tt * (1.00002368 +
          tt * (0.37409196 +
            tt * (0.09678418 +
              tt * (-0.18628806 +
                tt * (0.27886807 +
                  tt * (-1.13520398 +
                    tt * (1.48851587 +
                      tt * (-0.82215223 + tt * 0.17087277))))))))
    );
  return x >= 0 ? ans : 2 - ans;
}

/** 卡方(1 自由度)尾概率 P(χ² ≥ c)。 */
export function chiSquare1dfP(c) {
  if (c <= 0) return 1;
  return erfcc(Math.sqrt(c / 2));
}

// ── 秩相关 ──────────────────────────────────────────────────────────────

/** 分数秩(并列取平均秩)。 */
export function rankData(arr) {
  const idx = arr.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1-based 平均秩
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Pearson 相关。序列等长、方差非零。 */
export function pearson(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman ρ = 秩上的 Pearson(通用式,容忍并列)。 */
export function spearman(x, y) {
  return pearson(rankData(x), rankData(y));
}

/** Spearman/Pearson 相关的双尾 p 值(t 近似,df=n-2)。 */
export function correlationPValue(rho, n) {
  if (n < 3) return 1;
  const r2 = Math.min(rho * rho, 1 - 1e-12);
  const t = rho * Math.sqrt((n - 2) / (1 - r2));
  return studentTTwoTailP(t, n - 2);
}

// ── 平稳性:Dickey-Fuller(含常数,无趋势)──────────────────────────────

/** 一阶差分。 */
export function firstDiff(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

/**
 * DF 检验:回归 Δy_t = α + β·y_{t-1} + ε,τ = β̂/SE(β̂)。
 * τ 越负越拒绝单位根 → 平稳。5% 近似临界值(含常数无趋势,渐近)≈ -2.86。
 * 序列太短(<8)无从判定,保守当作非平稳以触发差分(差分后弱平稳更稳妥)。
 */
export function dfStationary(series, crit = -2.86) {
  const n = series.length;
  if (n < 8) return { tau: 0, stationary: false, tooShort: true };
  const ylag = series.slice(0, n - 1);
  const dy = firstDiff(series);
  const m = ylag.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < m; i++) {
    mx += ylag[i];
    my += dy[i];
  }
  mx /= m;
  my /= m;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < m; i++) {
    sxx += (ylag[i] - mx) * (ylag[i] - mx);
    sxy += (ylag[i] - mx) * (dy[i] - my);
  }
  if (sxx === 0) return { tau: 0, stationary: false, degenerate: true };
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let rss = 0;
  for (let i = 0; i < m; i++) {
    const e = dy[i] - (alpha + beta * ylag[i]);
    rss += e * e;
  }
  const s2 = rss / Math.max(1, m - 2);
  const seBeta = Math.sqrt(s2 / sxx);
  if (!Number.isFinite(seBeta) || seBeta === 0) return { tau: 0, stationary: false, degenerate: true };
  const tau = beta / seBeta;
  return { tau, stationary: tau < crit };
}

// ── 多重检验:Benjamini-Hochberg FDR ────────────────────────────────────

/**
 * BH-FDR:一批 p 值一起控制假发现率 q。返回布尔数组(哪些候选存活)。
 * 步骤:升序,找最大 k 使 p_(k) ≤ (k/M)·q,则前 k 个存活。
 */
export function benjaminiHochberg(pvals, q = 0.1) {
  const M = pvals.length;
  if (M === 0) return [];
  const order = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let maxK = -1;
  for (let k = 0; k < M; k++) {
    if (order[k].p <= ((k + 1) / M) * q) maxK = k;
  }
  const pass = new Array(M).fill(false);
  for (let k = 0; k <= maxK; k++) pass[order[k].i] = true;
  return pass;
}

// ── 对齐 + 检测管线 ──────────────────────────────────────────────────────

/**
 * 内连接对齐两列:只保留两列同一天都有值的行,按 dateKey 升序。
 * rows: [{dateKey, m:{col:number}}]
 */
export function alignPair(rows, colA, colB) {
  const a = [];
  const b = [];
  const dates = [];
  const sorted = [...rows].sort((p, q) => (p.dateKey < q.dateKey ? -1 : 1));
  for (const r of sorted) {
    const va = r.m ? r.m[colA] : undefined;
    const vb = r.m ? r.m[colB] : undefined;
    if (typeof va === 'number' && Number.isFinite(va) && typeof vb === 'number' && Number.isFinite(vb)) {
      a.push(va);
      b.push(vb);
      dates.push(r.dateKey);
    }
  }
  return { a, b, dates };
}

const DEFAULTS = Object.freeze({
  minN: 14, // §4 相关最小样本
  minRho: 0.3, // §4 效应量门
  q: 0.1, // §4 FDR
  dfCrit: -2.86, // DF 5% 近似
  minCooccurN: 5, // 计数型共现最小天数
});

/**
 * 主入口:检测所有跨域候选关系并过门。
 * @param rows journal 行 [{dateKey, m}]
 * @param columns [{key, domain, kind:'continuous'|'count'}]
 * @param opts 覆盖 DEFAULTS
 * @returns 存活关系(按强度降序),每条带 pValue / n / 证据
 */
export function detectCrossRegion(rows, columns, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const cands = [];

  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const A = columns[i];
      const B = columns[j];
      if (A.domain === B.domain) continue; // 只要跨域(跨区)

      const { a, b, dates } = alignPair(rows, A.key, B.key);
      if (a.length < cfg.minN) continue; // 证据不足 → cold,不出

      // ── 相关路径:先平稳化(挡趋势伪相关),再 Spearman ──
      const sa = dfStationary(a, cfg.dfCrit);
      const sb = dfStationary(b, cfg.dfCrit);
      let xa = a;
      let xb = b;
      let differenced = false;
      if (!sa.stationary || !sb.stationary) {
        xa = firstDiff(a);
        xb = firstDiff(b);
        differenced = true;
      }
      if (xa.length >= cfg.minN) {
        const rho = spearman(xa, xb);
        if (Number.isFinite(rho) && Math.abs(rho) >= cfg.minRho) {
          cands.push({
            kind: 'corr',
            a: A.key,
            b: B.key,
            domainA: A.domain,
            domainB: B.domain,
            strength: Math.round(rho * 1000) / 1000,
            pValue: correlationPValue(rho, xa.length),
            n: xa.length,
            differenced,
            dates: [dates[0], dates[dates.length - 1]],
          });
        }
      }

      // ── 共现路径:两列都是计数型,看「都发生」vs 独立期望(phi 相关 + 卡方)──
      if (A.kind === 'count' && B.kind === 'count' && a.length >= cfg.minCooccurN) {
        const ba = a.map((v) => (v > 0 ? 1 : 0));
        const bb = b.map((v) => (v > 0 ? 1 : 0));
        const phi = pearson(ba, bb);
        if (Number.isFinite(phi) && Math.abs(phi) >= cfg.minRho) {
          const chi2 = a.length * phi * phi; // χ² = n·φ²(1 df)
          cands.push({
            kind: 'cooccur',
            a: A.key,
            b: B.key,
            domainA: A.domain,
            domainB: B.domain,
            strength: Math.round(phi * 1000) / 1000,
            pValue: chiSquare1dfP(chi2),
            n: a.length,
            differenced: false,
            dates: [dates[0], dates[dates.length - 1]],
          });
        }
      }
    }
  }

  // ── 门控:一批候选一起 BH-FDR(绝不逐对看 0.05)──
  if (cands.length === 0) return [];
  const pass = benjaminiHochberg(cands.map((c) => c.pValue), cfg.q);
  return cands
    .filter((_, i) => pass[i])
    .sort((x, y) => Math.abs(y.strength) - Math.abs(x.strength));
}

export const DETECT_DEFAULTS = DEFAULTS;

// ── P1.5 先后/因果提示(lead-lag)────────────────────────────────────────────
// 真 PCMCI(条件独立检验)在端上单用户日级数据不可行;这里用**滞后互相关**抓
// 「X 变化 → k 天后 Y 跟着变」:先平稳化(挡趋势伪滞后)→ 扫滞后 1..τmax 的 Spearman
// → **滞后相关必须显著强于同期相关**(lagDominanceMargin,挡同期相关拖影到邻近滞后,
// 是 PCMCI 条件化的务实替身)→ 批量 BH-FDR。产出是「先后线索」,**不是因果证明**。

const LEADLAG_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  tauMax: 7,               // §4 PCMCI τ_max = 7 天
  lagDominanceMargin: 0.1, // 滞后须比同期强这么多才算真先后
});

/**
 * 检测跨域先后线索。columns 同 detectCrossRegion。返回按强度降序、过 BH-FDR 的候选。
 * 每条:{kind:'leadlag', leader, follower, lag, strength(ρ), pValue, n, differenced, dates}
 */
export function detectLeadLag(rows, columns, opts = {}) {
  const cfg = { ...LEADLAG_DEFAULTS, ...opts };
  const cands = [];

  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const A = columns[i];
      const B = columns[j];
      if (A.domain === B.domain) continue; // 只要跨域

      const { a, b, dates } = alignPair(rows, A.key, B.key);
      if (a.length < cfg.minN + 1) continue;

      // 平稳化(非平稳一阶差分),挡趋势驱动的伪滞后相关
      const sa = dfStationary(a, cfg.dfCrit);
      const sb = dfStationary(b, cfg.dfCrit);
      let xa = a;
      let xb = b;
      let differenced = false;
      if (!sa.stationary || !sb.stationary) {
        xa = firstDiff(a);
        xb = firstDiff(b);
        differenced = true;
      }
      if (xa.length < cfg.minN + 1) continue;

      const rho0 = spearman(xa, xb); // 同期相关(基准)
      let best = null;

      for (let k = 1; k <= cfg.tauMax; k++) {
        if (xa.length - k < cfg.minN) break;
        // A 领先 B k 天:A_t 对齐 B_{t+k}
        const rAB = spearman(xa.slice(0, xa.length - k), xb.slice(k));
        // B 领先 A k 天
        const rBA = spearman(xb.slice(0, xb.length - k), xa.slice(k));
        for (const [leader, follower, r] of [[A.key, B.key, rAB], [B.key, A.key, rBA]]) {
          if (!Number.isFinite(r) || Math.abs(r) < cfg.minRho) continue;
          // 滞后必须显著强于同期,否则只是同期相关的拖影(非真先后)
          if (Math.abs(r) <= Math.abs(rho0) + cfg.lagDominanceMargin) continue;
          if (!best || Math.abs(r) > Math.abs(best.rho)) {
            best = { leader, follower, lag: k, rho: r, n: xa.length - k, domainA: A.domain, domainB: B.domain };
          }
        }
      }

      if (best) {
        cands.push({
          kind: 'leadlag',
          leader: best.leader,
          follower: best.follower,
          a: A.key,
          b: B.key,
          domainA: best.domainA,
          domainB: best.domainB,
          lag: best.lag,
          strength: Math.round(best.rho * 1000) / 1000,
          pValue: correlationPValue(best.rho, best.n),
          n: best.n,
          differenced,
          dates: [dates[0], dates[dates.length - 1]],
        });
      }
    }
  }

  if (cands.length === 0) return [];
  const pass = benjaminiHochberg(cands.map((c) => c.pValue), cfg.q);
  return cands
    .filter((_, i) => pass[i])
    .sort((x, y) => Math.abs(y.strength) - Math.abs(x.strength));
}

export const LEADLAG_DETECT_DEFAULTS = LEADLAG_DEFAULTS;
