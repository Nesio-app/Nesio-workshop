/**
 * 通用域规则引擎 —— health 范式(引擎/知识分离)的引擎层(A 计划 Layer 1)。
 *
 * health-clinical 首创该结构并自注「引擎抽公共层等有第二个板块再做(避免过早抽象)」;
 * 地图(place-insight)就是那个第二板块 —— 据此抽出。每个域 = 一份声明式 RULES(知识,
 * 带阈值/出处/文案)+ 这个 ~20 行运行时:逐条跑、单条出错不影响其余、按严重度排序。
 *
 * finding 形态由域自定(健康带 source 出处、财务带 kind、地图轻量),只约束
 * { id, severity } 两个公共字段 —— 不为统一而磨平域知识。
 */

export type RuleSeverity = 'info' | 'attention' | 'flag'; // info=正常/达标, attention=可关注, flag=真实风险

const SEVERITY_RANK: Record<RuleSeverity, number> = { flag: 0, attention: 1, info: 2 };

export interface DomainRule<I, F extends { id: string; severity: RuleSeverity }> {
  id: string;
  /** 规则对当前输入的判定;null = 不适用/无发现。 */
  run: (input: I) => Omit<F, 'id'> | null;
}

/** 通用运行时:逐条评估(try/catch 隔离),红旗 > 可关注 > 正常 排序。 */
export function evaluateRules<I, F extends { id: string; severity: RuleSeverity }>(
  rules: ReadonlyArray<DomainRule<I, F>>,
  input: I,
): F[] {
  const out: F[] = [];
  for (const rule of rules) {
    let res: Omit<F, 'id'> | null = null;
    try { res = rule.run(input); } catch { res = null; } // 单条规则出错不影响其余
    if (res) out.push({ id: rule.id, ...res } as F);
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
