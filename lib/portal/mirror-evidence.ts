/**
 * mirror-evidence — 写信摘要的「三重验证」弱启发式(借鉴女娲心智模型收录纪律)。
 * 过关 → verifiedLenses;不过关但有信号 → weakClues。不替代 LLM,只给它更干净的线索。
 */

export interface EvidenceLens {
  label: string;
  /** 命中了几重验证(1–3) */
  score: number;
  note: string;
}

const DOMAIN_HINTS: Array<{ re: RegExp; domain: string }> = [
  { re: /情绪|心情|难过|焦虑|开心|累|压力|mood|anx/i, domain: 'emotion' },
  { re: /妈|爸|伴侣|朋友|同事|见面|约会|关系|家人/i, domain: 'relations' },
  { re: /工作|会议|项目|客户|创业|deadline|汇报/i, domain: 'work' },
  { re: /学|读|练|习惯|目标|反思|成长/i, domain: 'growth' },
  { re: /睡|跑|练|疼|病|药|吃|餐|血糖|体重|健康/i, domain: 'health' },
  { re: /钱|花|付|预算|工资|投资|账单/i, domain: 'money' },
  { re: /家|房|搬家|打扫|收纳/i, domain: 'home' },
];

function domainsOf(text: string): string[] {
  const hit = new Set<string>();
  for (const h of DOMAIN_HINTS) {
    if (h.re.test(text)) hit.add(h.domain);
  }
  return [...hit];
}

/**
 * 从近期样本 + 活跃域做轻量三重验证:
 * 1) 跨域复现 2) 有对照/张力可说 3) 非人人都有的空话
 */
export function buildEvidenceLenses(input: {
  recentSample: string[];
  topDomains: Array<{ domain: string; count: number }>;
  typeBreakdown: Record<string, number>;
}): { verifiedLenses: EvidenceLens[]; weakClues: EvidenceLens[] } {
  const verifiedLenses: EvidenceLens[] = [];
  const weakClues: EvidenceLens[] = [];
  const samples = (input.recentSample || []).map((s) => String(s).trim()).filter(Boolean);

  // —— 跨域词簇 ——
  const tokenDomains = new Map<string, Set<string>>();
  for (const s of samples) {
    const doms = domainsOf(s);
    const tokens = s
      .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && t.length <= 12);
    for (const t of tokens) {
      const set = tokenDomains.get(t) || new Set<string>();
      for (const d of doms) set.add(d);
      // 无域提示时仍记一次,用 '_'
      if (!doms.length) set.add('_');
      tokenDomains.set(t, set);
    }
  }
  const cross: string[] = [];
  for (const [tok, set] of tokenDomains) {
    const real = [...set].filter((d) => d !== '_');
    if (real.length >= 2) cross.push(tok);
  }
  if (cross.length) {
    verifiedLenses.push({
      label: '跨域复现',
      score: 2,
      note: `这些词在多个生活面出现:${cross.slice(0, 6).join('、')}`,
    });
  } else if (samples.length >= 8) {
    weakClues.push({
      label: '跨域不足',
      score: 1,
      note: '样本多但主题较单线——写信时别硬造「全面人生」叙事',
    });
  }

  // —— 类型张力(有生成力的对照) ——
  const types = input.typeBreakdown || {};
  const noteN = types.note || 0;
  const commitmentN = types.commitment || 0;
  const eventN = types.event || 0;
  if (commitmentN >= 3 && noteN === 0) {
    verifiedLenses.push({
      label: '缺席对照',
      score: 3,
      note: `承诺/待办 ${commitmentN} 条,感受类笔记 0 —— 适合盲区/教练镜`,
    });
  } else if (noteN >= 5 && commitmentN === 0 && eventN >= 3) {
    verifiedLenses.push({
      label: '缺席对照',
      score: 2,
      note: `事件 ${eventN}、笔记 ${noteN},承诺 0 —— 可能在经历但不立约`,
    });
  } else if (commitmentN >= 2 && noteN >= 2) {
    weakClues.push({
      label: '双边都有',
      score: 1,
      note: '既有承诺也有笔记——可问两边是否同向,勿假装一边缺席',
    });
  }

  // —— 排他性:头部域占比很高才算「独特偏斜」 ——
  const top = input.topDomains?.[0];
  const second = input.topDomains?.[1];
  if (top && top.count >= 5 && (!second || top.count >= second.count * 2)) {
    verifiedLenses.push({
      label: '主域偏斜',
      score: 2,
      note: `「${top.domain}」明显压过其他域(${top.count} vs ${second?.count ?? 0})——这是此人这个月的独特重心,不是人人都有的空话`,
    });
  } else if (top) {
    weakClues.push({
      label: '主域温和',
      score: 1,
      note: `最活跃是「${top.domain}」,但未形成压倒性偏斜`,
    });
  }

  return {
    verifiedLenses: verifiedLenses.slice(0, 5),
    weakClues: weakClues.slice(0, 4),
  };
}
