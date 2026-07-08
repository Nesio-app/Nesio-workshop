/**
 * 物品②:CSV 批量导入(对标参考 App 的 Import Data)。
 *
 * 规则:仅 Name 必填,其余列全可选、有就用;表头大小写不敏感、中英对照;
 * Space+Bin 拼成 location(与 LocationPicker 同一分隔词);物品一律新建
 * (同文件导两次会重复——与参考 App 同语义,规则写在导入入口的说明里);
 * 坏行跳过并计数,错误样本可见展示,不静默吞。
 */
import { addInventoryItem, LOC_SEP } from './inventory';

/** RFC4180 子集:引号包裹、双引号转义("")、引号内的逗号与换行。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** 表头别名(全小写比较)→ 规范字段。 */
const HEADER_ALIASES: Record<string, string> = {
  'name': 'name', '物品': 'name', '名称': 'name', '物品名': 'name', 'item': 'name',
  'value': 'price', 'price': 'price', '价值': 'price', '估值': 'price', '价格': 'price',
  'category': 'category', '分类': 'category', '类别': 'category',
  'space': 'space', '空间': 'space', '场所': 'space', 'location': 'space', '位置': 'space',
  'bin': 'bin', 'container': 'bin', '容器': 'bin', '箱': 'bin', '收纳箱': 'bin',
  'tags': 'tags', 'tag': 'tags', '标签': 'tags',
  'quantity': 'quantity', 'qty': 'quantity', '数量': 'quantity',
  'expires': 'expiry', 'expiry': 'expiry', 'expiration': 'expiry', '效期': 'expiry', '有效期': 'expiry', '到期': 'expiry',
  'notes': 'note', 'note': 'note', '备注': 'note',
  'purchase date': 'purchaseDate', '购买日期': 'purchaseDate',
  'serial number': 'serial', 'serial': 'serial', '序列号': 'serial',
  'model number': 'model', 'model': 'model', '型号': 'model',
  'barcode/upc': 'barcode', 'barcode': 'barcode', 'upc': 'barcode', '条码': 'barcode',
};

function normDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export interface ImportResult {
  imported: number;
  skipped: number;   // 缺名称的行
  errors: string[];  // 前 5 条样本(行号 + 原因),用于可见展示
}

export function importInventoryCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
  if (rows.length < 2) {
    result.errors.push('文件为空或只有表头');
    return result;
  }
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] || '');
  if (!header.includes('name')) {
    result.errors.push('缺少 Name/名称 列(唯一必填列)');
    return result;
  }
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (field: string): string => {
      const idx = header.indexOf(field);
      return idx >= 0 ? (cells[idx] || '').trim() : '';
    };
    const name = get('name');
    if (!name) {
      result.skipped++;
      if (result.errors.length < 5) result.errors.push(`第 ${r + 1} 行:缺名称,已跳过`);
      continue;
    }
    const space = get('space');
    const bin = get('bin');
    const location = space ? (bin ? `${space}${LOC_SEP}${bin}` : space) : '';
    const priceRaw = get('price').replace(/[$,¥,\s]/g, '');
    const price = priceRaw ? parseFloat(priceRaw) : NaN;
    const qtyRaw = get('quantity');
    const qty = qtyRaw ? parseInt(qtyRaw, 10) : NaN;
    const expiry = normDate(get('expiry'));
    const noteParts = [get('note')];
    // 无独立字段的列并进备注(不丢数据,详情页可见可搜)
    for (const [field, label] of [['purchaseDate', '购于'], ['serial', 'SN'], ['model', '型号'], ['barcode', '条码']] as const) {
      const v = field === 'purchaseDate' ? (normDate(get(field)) || get(field)) : get(field);
      if (v) noteParts.push(`${label} ${v}`);
    }
    addInventoryItem({
      name,
      location: location || undefined,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : undefined,
      expiry: expiry || undefined,
      note: noteParts.filter(Boolean).join(' · ') || undefined,
      category: get('category') || undefined,
      tags: get('tags') ? get('tags').split(/[,,、;;]/).map((t) => t.trim()).filter(Boolean) : undefined,
      price: Number.isFinite(price) ? price : undefined,
    });
    result.imported++;
  }
  return result;
}
