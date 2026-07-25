/**
 * 契约:闭环「日历家务 → 分派给家人 → 做完回响到今天页」。
 * 钉死三条红线:
 *  ① 分派是互相的 —— 任何家庭成员都能派活(requireMember),但外人一律拒(fail-closed)。
 *     被分派人也必须是本家庭成员。
 *  ② 一事件一实例 —— 按 (family_id, source_event_id) upsert,再点即改派,不重复生成。
 *  ③ 路由存在且各挂鉴权(assign/members 均需 session + membership)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── 服务端 op ──
const server = read('lib/family/family-server.ts');
assert.match(server, /export async function assignChoreFromEventOp/, 'assignChoreFromEventOp must be exported.');
assert.match(server, /export async function listFamilyMembersOp/, 'listFamilyMembersOp must be exported.');
// 分派互相:成员即可(requireMember),但不得对分派额外要求 can_approve(否则就不是互相了)
assert.match(server, /assignChoreFromEventOp[\s\S]*?requireMember\(actor, input\.familyId\)/, 'assign must require family membership.');
assert.doesNotMatch(
  server.slice(server.indexOf('assignChoreFromEventOp'), server.indexOf('recordPayoutOp')),
  /memberCan\([^)]*'assign'\)/,
  'assign must NOT be gated by can_approve — any member can assign (mutual).',
);
// 一事件一实例:按来源去重(upsert / patch existing by source_event_id)
assert.match(server, /source_event_id=eq\.\$\{sourceEventId\}/, 'assign must look up existing instance by source_event_id (one-per-event).');
// 被分派人必须是本家庭成员(不给外人塞活)
assert.match(server, /family_members[^\n]*user_id=eq\.\$\{assigneeId\}/, 'assign must verify assignee is a family member.');

// ── 路由 ──
const assignRoute = read('app/api/portal/family/assign/route.ts');
assert.match(assignRoute, /resolveActor/, 'assign route must resolve the signed-in actor.');
assert.match(assignRoute, /assignChoreFromEventOp/, 'assign route must call assignChoreFromEventOp.');

const membersRoute = read('app/api/portal/family/members/route.ts');
assert.match(membersRoute, /listFamilyMembersOp/, 'members route must call listFamilyMembersOp.');

// ── 客户端封装(纯 fetch,不 import 服务端)──
const client = read('lib/family/family-client.ts');
assert.match(client, /export function assignChoreFromEvent/, 'client must expose assignChoreFromEvent.');
assert.match(client, /export function listFamilyMembers/, 'client must expose listFamilyMembers.');
assert.doesNotMatch(client, /family-server/, 'client must NOT import the server module.');

console.log('family-assign-contract: OK');
