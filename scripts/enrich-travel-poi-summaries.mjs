/**
 * Add bilingual summary/summaryEn to offline travel POI JSON packs.
 *
 * Usage: node scripts/enrich-travel-poi-summaries.mjs [--check]
 *   --check  exit 1 if any item still lacks summary (no writes)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  WORLD_CURATED, JAPAN_CURATED, JAPAN_PARTIAL, COUNTRY_ZH, TYPE_ZH,
} from './travel-poi-summaries-curated.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');

function typeLabelZh(type) {
  return TYPE_ZH[type] || '景点';
}

function typeLabelEn(type) {
  switch (type) {
    case 'museum': return 'museum';
    case 'unesco': return 'UNESCO site';
    case 'monument': return 'monument';
    case 'attraction': return 'attraction';
    default: return 'place';
  }
}

function countryZh(country) {
  if (!country) return '当地';
  return COUNTRY_ZH[country] || country;
}

function fallbackSummary(item) {
  const c = countryZh(item.country);
  const t = typeLabelZh(item.type);
  return `${item.name}：位于${c}的${t}，可加入行程离线导航。`;
}

function fallbackSummaryEn(item) {
  const c = item.country || 'the region';
  const t = typeLabelEn(item.type);
  return `${item.name}: a notable ${t} in ${c}.`;
}

function lookupCurated(name, curated, partial = []) {
  if (curated[name]) return curated[name];
  for (const [needle, val] of partial) {
    if (name.includes(needle)) return val;
  }
  return null;
}

function enrichItem(item, curated, partial = []) {
  if (item.summary) {
    return item;
  }
  const hit = lookupCurated(item.name, curated, partial);
  const summary = hit?.summary ?? fallbackSummary(item);
  const summaryEn = hit?.summaryEn ?? item.summaryEn ?? fallbackSummaryEn(item);
  return { ...item, summary, summaryEn };
}

function enrichFile(relPath, curated, partial = []) {
  const abs = path.join(root, relPath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  let added = 0;
  data.items = (data.items || []).map((item) => {
    const before = item.summary;
    const next = enrichItem(item, curated, partial);
    if (!before && next.summary) added += 1;
    return next;
  });
  if (!checkOnly) {
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  }
  const missing = data.items.filter((i) => !i.summary).length;
  return { path: relPath, count: data.items.length, added, missing };
}

const files = [
  { path: 'public/data/travel-poi/world-attractions.json', curated: WORLD_CURATED },
  { path: 'public/data/travel-poi/japan-attractions.json', curated: { ...WORLD_CURATED, ...JAPAN_CURATED }, partial: JAPAN_PARTIAL },
  { path: 'public/data/travel-poi/tokyo-attractions.json', curated: { ...WORLD_CURATED, ...JAPAN_CURATED }, partial: JAPAN_PARTIAL },
];

let totalMissing = 0;
for (const f of files) {
  const r = enrichFile(f.path, f.curated, f.partial || []);
  totalMissing += r.missing;
  console.log(`${checkOnly ? 'check' : 'enriched'} ${r.path}: ${r.count} items, +${r.added} summaries, missing=${r.missing}`);
}

if (totalMissing > 0) {
  console.error(`FAIL: ${totalMissing} items still lack summary`);
  process.exit(1);
}
console.log(checkOnly ? 'all items have summary' : 'done');
