/**
 * 行为契约:Health/Finance 家人数据切换卡(人缘 3)。
 * 锁死:FamilyDataCard 按 kind 过滤分类(health=医疗/药物/健康;spend=消费)、汇家庭成员、
 * 点进详情、无数据返回 null;HealthDashboard 与 FinanceTab(含空态)都挂载它。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const card = fs.readFileSync(new URL('../components/portal/relationships/FamilyDataCard.tsx', import.meta.url), 'utf8');
assert.ok(card.includes('buildFamilyDigest'), '复用家庭汇总');
assert.ok(/HEALTH_CATS[^\n]*medical[^\n]*medication[^\n]*health/.test(card), '健康类=医疗/药物/健康');
assert.ok(/SPEND_CATS[^\n]*spending/.test(card), '消费类=spending');
assert.ok(card.includes("kind: 'health' | 'spend'") && card.includes("kind === 'health'"), '两种 kind(health/spend)');
assert.ok(card.includes('if (!members.length) return null'), '无相关数据 → null(不打扰原版面)');
assert.ok(card.includes('RelationshipDetailSheet') && card.includes('setOpenKey'), '点成员切换进详情');
assert.ok(card.includes("'nesio-person-records-updated'"), '挂数据后刷新');

// ── Health 版面挂载(空态 + 主渲染都要,家人有数据但本人没上传也能看)──
const health = fs.readFileSync(new URL('../components/portal/health/HealthDashboard.tsx', import.meta.url), 'utf8');
assert.ok(health.includes("import FamilyDataCard"), 'Health 引入家人卡');
assert.ok((health.match(/<FamilyDataCard kind="health"/g) || []).length >= 2, 'Health 空态 + 主渲染都挂(本人无数据也能看家人)');

// ── Finance 版面挂载(空态 + 总览)──
const fin = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(fin.includes("import FamilyDataCard"), 'Finance 引入家人卡');
assert.ok((fin.match(/<FamilyDataCard kind="spend"/g) || []).length >= 2, 'Finance 空态 + 总览都挂');

console.log('family-data-card: OK');
