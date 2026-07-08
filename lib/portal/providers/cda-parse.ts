/**
 * Apple Health export_cda.xml(HL7 CDA)解析(批次 48 / D2)—— 化验单 / 用药 / 诊断。
 *
 * export_cda.xml 来自「Apple 健康记录」(医院同步),含临床文档。它通常远小于 export.xml
 * (临床记录条数少),故 ConnectorsHub 把它整体缓冲后交给这里一次性块解析(内存安全,有上限)。
 * 防御式提取:不同医院/系统的 CDA 结构有差异,只抓最通用的模式,抓不到就留空,绝不抛。
 * 纯函数、可单测。临床数据属敏感:仅 lab 模式渲染、本机存储(见 clinical-store.ts)。
 */

export interface LabResult {
  name: string;
  value: number;
  unit: string;
  date: string;                 // YYYY-MM-DD
  low?: number; high?: number;  // 参考范围
  flag?: 'low' | 'high' | 'normal';
}

export interface ClinicalRecords {
  labs: LabResult[];
  medications: string[];
  conditions: string[];
}

/** CDA effectiveTime value="20240115..." → "2024-01-15"(容错)。 */
function cdaDate(v: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '';
}

const HTML_ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
function decode(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENT[m] || m).trim();
}

export function parseCda(xml: string): ClinicalRecords {
  const labs: LabResult[] = [];
  const conditions: string[] = [];
  const medications: string[] = [];
  const seenLab = new Set<string>();
  const seenCond = new Set<string>();
  const seenMed = new Set<string>();

  // ── 化验单 / 诊断:遍历 <observation> 块 ──
  const obsRe = /<observation\b[\s\S]*?<\/observation>/g;
  let m: RegExpExecArray | null;
  while ((m = obsRe.exec(xml))) {
    const block = m[0];
    const name = decode(block.match(/<code\b[^>]*\bdisplayName="([^"]*)"/)?.[1] || '');
    if (!name) continue;
    const date = cdaDate(block.match(/<effectiveTime\b[^>]*\bvalue="([^"]*)"/)?.[1] || attr(block.match(/<effectiveTime\b[^>]*\/?>/)?.[0] || '', 'value'));

    // 数值型化验(xsi:type="PQ"):有 value + unit
    const pq = block.match(/<value\b[^>]*\bxsi:type="PQ"[^>]*>/) || block.match(/<value\b[^>]*\bunit="[^"]*"[^>]*\bvalue="[^"]*"[^>]*>/);
    if (pq) {
      const vtag = pq[0];
      const val = Number(attr(vtag, 'value'));
      const unit = attr(vtag, 'unit');
      if (Number.isFinite(val)) {
        const key = `${name}|${date}|${val}`;
        if (!seenLab.has(key)) {
          seenLab.add(key);
          // 注意:Number('') === 0(非 NaN)—— 必须先判匹配存在,否则缺参考范围会被当 0/0 误标异常。
          const lowM = block.match(/<low\b[^>]*\bvalue="([^"]*)"/)?.[1];
          const highM = block.match(/<high\b[^>]*\bvalue="([^"]*)"/)?.[1];
          const low = lowM != null ? Number(lowM) : NaN;
          const high = highM != null ? Number(highM) : NaN;
          const lab: LabResult = { name, value: val, unit, date };
          if (Number.isFinite(low)) lab.low = low;
          if (Number.isFinite(high)) lab.high = high;
          if (Number.isFinite(low) && val < low) lab.flag = 'low';
          else if (Number.isFinite(high) && val > high) lab.flag = 'high';
          else if (Number.isFinite(low) || Number.isFinite(high)) lab.flag = 'normal';
          labs.push(lab);
        }
        continue;
      }
    }

    // 编码型 value(xsi:type="CD"):多为诊断/问题
    const cd = block.match(/<value\b[^>]*\bxsi:type="CD"[^>]*>/);
    if (cd) {
      const diag = decode(attr(cd[0], 'displayName') || name);
      if (diag && !seenCond.has(diag.toLowerCase())) { seenCond.add(diag.toLowerCase()); conditions.push(diag); }
    }
  }

  // ── 用药:<manufacturedMaterial> 里的药名 ──
  const matRe = /<manufacturedMaterial\b[\s\S]*?<\/manufacturedMaterial>/g;
  while ((m = matRe.exec(xml))) {
    const block = m[0];
    const name = decode(block.match(/<code\b[^>]*\bdisplayName="([^"]*)"/)?.[1] || block.match(/<name\b[^>]*>([^<]+)<\/name>/)?.[1] || '');
    if (name && !seenMed.has(name.toLowerCase())) { seenMed.add(name.toLowerCase()); medications.push(name); }
  }

  labs.sort((a, b) => b.date.localeCompare(a.date));
  return {
    labs: labs.slice(0, 300),
    medications: medications.slice(0, 60),
    conditions: conditions.slice(0, 60),
  };
}
