/**
 * 行为契约:免费最大化·Google 扩展授权 58b —— Tasks + People 消费路由。
 * 锁死:tasks 拉列表→每列表未完成任务、映射 title/due/notes/status/listTitle;
 * people 拉 connections(personFields 含 names/emails/photos/birthdays)、映射
 * name/emails/photo(去默认灰头像)/birthday(无年份 --MM-DD);未连接 401、上游 502。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadRoute(path, token, fetchImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, fetch: fetchImpl,
    require: (p) => p === 'next/server' ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200 }) } }
      : p.includes('gmail-access') ? { resolveGmailAccessToken: async () => token }
      : p.includes('api-auth') ? { guardAiRoute: async () => null }
      : ({}),
  });
  return mod.exports;
}

// ── Tasks ──
{
  // 未连接 401
  const un = loadRoute('../app/api/portal/tasks/route.ts', null, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await un.GET({})).__status, 401, 'tasks 未连接 401');

  // 正常:列表 + 任务映射
  const route = loadRoute('../app/api/portal/tasks/route.ts', 'tkn', async (url) => {
    if (String(url).includes('/users/@me/lists')) return { ok: true, json: async () => ({ items: [{ id: 'L1', title: '待办' }] }) };
    if (String(url).includes('/lists/L1/tasks')) {
      assert.ok(String(url).includes('showCompleted=false'), '只拉未完成');
      return { ok: true, json: async () => ({ items: [{ id: 't1', title: '交房租', due: '2026-07-10T00:00:00Z', status: 'needsAction', notes: '记得' }] }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
  const res = await route.GET({});
  assert.equal(res.__json.ok, true);
  assert.equal(res.__json.tasks.length, 1);
  // 跨 vm realm 对象,deepStrictEqual 因原型不同引用会失败 → 逐字段断言
  const t0 = res.__json.tasks[0];
  assert.equal(t0.id, 't1'); assert.equal(t0.title, '交房租'); assert.equal(t0.due, '2026-07-10T00:00:00Z');
  assert.equal(t0.notes, '记得'); assert.equal(t0.status, 'needsAction'); assert.equal(t0.listTitle, '待办');

  // 上游列表失败 502
  const bad = loadRoute('../app/api/portal/tasks/route.ts', 'tkn', async () => ({ ok: false, status: 503, json: async () => ({}) }));
  assert.equal((await bad.GET({})).__status, 502, 'tasks 上游失败 502');
}

// ── People ──
{
  const un = loadRoute('../app/api/portal/people/route.ts', null, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await un.GET({})).__status, 401, 'people 未连接 401');

  let capturedUrl = '';
  const route = loadRoute('../app/api/portal/people/route.ts', 'tkn', async (url) => {
    capturedUrl = String(url);
    return { ok: true, json: async () => ({ connections: [
      { names: [{ displayName: 'Alice Wang' }], emailAddresses: [{ value: 'alice@x.com' }],
        photos: [{ url: 'https://g/default', default: true }, { url: 'https://g/real.jpg' }],
        birthdays: [{ date: { month: 3, day: 5 } }] },
      { emailAddresses: [{ value: 'noname@x.com' }] },  // 无名 → name 退邮箱
      { names: [{ displayName: '空' }] },               // 无邮箱但有名 → 保留
      {},                                               // 全空 → 丢弃
    ] }) };
  });
  const res = await route.GET({});
  assert.ok(capturedUrl.includes('personFields=names') && capturedUrl.includes('birthdays'), '请求 personFields 含生日');
  assert.equal(res.__json.contacts.length, 3, '全空条目丢弃');
  const c0 = res.__json.contacts[0];
  assert.equal(c0.name, 'Alice Wang'); assert.deepEqual([...c0.emails], ['alice@x.com']);
  assert.equal(c0.photo, 'https://g/real.jpg', '去掉默认灰头像'); assert.equal(c0.birthday, '--03-05', '无年份生日 --MM-DD');
  assert.equal(res.__json.contacts[1].name, 'noname@x.com', '无名退邮箱');

  const bad = loadRoute('../app/api/portal/people/route.ts', 'tkn', async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal((await bad.GET({})).__status, 502, 'people 上游失败 502');
}

console.log('tasks-people: OK');
