/**
 * 跨区投递门控(cross-region-reasoning.md §2.2 同意 + §2.2 新鲜度/去重 + §2.4 投递)——
 * 纯函数,可单测。软频控/预算/时段门复用既有 guidance 管线,这里只做管线没有的:
 * ① 同意门(敏感域 health/finance/location 未授权则不主动推)
 * ② 新鲜度/去重(14 天内同关系不重复,除非强度实质变化)
 * ③ 可打断性门(非 critical 须 P(受纳) ≥ 阈)
 * 出口是 DomainInsightItem[](交 insightsToGuidanceEvents,再走七层仲裁)。
 */

const GATE_DEFAULTS = Object.freeze({
  cooldownDays: 14,          // §4 关系去重冷却
  materialDeltaRho: 0.3,     // 强度实质变化阈(相关 ρ 无「量级」,用 |Δ| 或变号近似)
  interruptThreshold: 0.5,   // §4 非 critical 可打断性门
  budgetK: 3,                // §4 每日投递上限(此处对跨区族的软上限)
});

const SENSITIVE_DOMAINS = new Set(['health', 'finance', 'location']);

/** 关系涉及敏感域? */
export function isSensitiveRelation(rel) {
  return SENSITIVE_DOMAINS.has(rel.domainA) || SENSITIVE_DOMAINS.has(rel.domainB);
}

/** 同意门:敏感关系须已授权对应域(两端都敏感则两端都要授权)。 */
export function passesConsent(rel, consentedDomains) {
  const consent = consentedDomains instanceof Set ? consentedDomains : new Set(consentedDomains || []);
  for (const d of [rel.domainA, rel.domainB]) {
    if (SENSITIVE_DOMAINS.has(d) && !consent.has(d)) return false;
  }
  return true;
}

/** 强度分桶(用于去重键:实质变化 → 新桶 → 可重新出)。 */
export function strengthBucket(strength, deltaRho = GATE_DEFAULTS.materialDeltaRho) {
  const step = Math.max(0.05, deltaRho);
  const sign = strength >= 0 ? '+' : '-';
  return `${sign}${Math.round(Math.abs(strength) / step)}`;
}

/**
 * 新鲜度/去重:14 天内展示过的同关系(且强度未实质变化)丢弃。
 * cooldownLog: { [relationId]: { at: iso, bucket: string } }
 */
export function passesFreshness(rel, cooldownLog, now, cfg = GATE_DEFAULTS) {
  const entry = (cooldownLog || {})[rel.id];
  if (!entry) return true;
  const ageDays = (now.getTime() - new Date(entry.at).getTime()) / 86_400_000;
  if (ageDays >= cfg.cooldownDays) return true;
  // 冷却期内:仅当强度实质变化(桶变了)才允许重出
  return strengthBucket(rel.strength, cfg.materialDeltaRho) !== entry.bucket;
}

/**
 * 主门控:一批跨区/先后洞察 → 可投递子集(已过同意 + 新鲜度 + 可打断性 + 预算)。
 * @param rels     [{id, kind, strength, pValue, n, domainA, domainB, ...}]
 * @param opts.consentedDomains  已授权敏感域
 * @param opts.cooldownLog       去重日志
 * @param opts.now               Date
 * @param opts.acceptProb        当前情境的可打断性 P(受纳)(0..1);未提供=1(放行)
 * @returns 存活关系(按 |strength| 降序,封顶 budgetK)+ 各自应记的 cooldown 桶
 */
export function gateDeliverables(rels, opts = {}) {
  const cfg = { ...GATE_DEFAULTS, ...(opts.config || {}) };
  const now = opts.now || new Date();
  const acceptProb = typeof opts.acceptProb === 'number' ? opts.acceptProb : 1;
  const consent = opts.consentedDomains;
  const cooldownLog = opts.cooldownLog || {};

  // 可打断性门(整批一次判:非 critical 情境不合适就都不推)
  if (acceptProb < cfg.interruptThreshold) return [];

  const survivors = (rels || [])
    .filter((r) => passesConsent(r, consent))
    .filter((r) => passesFreshness(r, cooldownLog, now, cfg))
    .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
    .slice(0, cfg.budgetK);

  return survivors.map((r) => ({ ...r, cooldownBucket: strengthBucket(r.strength, cfg.materialDeltaRho) }));
}

export const CROSS_REGION_GATE_DEFAULTS = GATE_DEFAULTS;
export const CROSS_REGION_SENSITIVE_DOMAINS = SENSITIVE_DOMAINS;
