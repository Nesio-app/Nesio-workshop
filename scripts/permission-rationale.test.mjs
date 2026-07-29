/**
 * 行为契约:权限前置说明(上线就绪 C,批次216)。
 * - 4 类权限都有文案,body 自带隐私安抚(端上/不上传/只存本机)—— 兼「端上=私密标注」。
 * - once-flag:第一次 shouldExplainPermission=true,标记后=false(不每次打扰)。
 * - VoiceInputSheet 麦克风首点走前置说明(handleMicTap→primer),允许后才 start;拒绝降级已在别处。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 纯逻辑 ──
const js = ts.transpileModule(read('../lib/portal/permission-rationale.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), window: {}, localStorage, Object });
const m = mod.exports;

for (const kind of ['microphone', 'camera', 'location', 'notification']) {
  const r = m.permissionRationale(kind);
  assert.ok(r.icon && r.title[0] && r.title[1] && r.body[0] && r.body[1], `${kind} 文案完整(双语)`);
}
// 隐私安抚(端上/不上传)—— 兼 C 的「端上=私密标注」
assert.match(m.permissionRationale('microphone').body[0], /不.*上传|端上|你的?设备/, 'mic 讲清「不上传/端上」');
assert.match(m.permissionRationale('camera').body[0], /只存.*手机|本机|设备/, 'camera 讲清「只存本机」');
assert.match(m.permissionRationale('location').body[0], /只存本机|不上传/, 'location 讲清「只存本机」');

// once-flag
assert.equal(m.shouldExplainPermission('microphone'), true, '首次 → 该解释');
m.markPermissionExplained('microphone');
assert.equal(m.shouldExplainPermission('microphone'), false, '标记后 → 不再解释');
assert.equal(m.shouldExplainPermission('camera'), true, '别的权限互不影响');

// ── 接线契约:VoiceInputSheet ──
const vis = read('../components/portal/VoiceInputSheet.tsx');
assert.match(vis, /import \{ permissionRationale, shouldExplainPermission, markPermissionExplained \} from '@\/lib\/portal\/permission-rationale'/, '引入前置说明助手');
assert.match(vis, /shouldExplainPermission\('microphone'\)[\s\S]{0,40}setMicPrimer\(true\)/, '首点麦克风先弹说明,不直接 start');
assert.match(vis, /onClick=\{listening \? stopListening : handleMicTap\}/, '麦克风按钮走 handleMicTap(前置说明门)');
// 「允许」那一步:先记下已说明,再去听。原先卡死了两者之间只准隔 60 字符,
// 后来中间插进了「先要原生麦权限(getUserMedia)再启 Web Speech」那段就误报了 ——
// 真正要锁的是**顺序**和**只在这条路径上 start**,不是间距。
{
  const at = vis.indexOf('function allowMicAndStart');
  assert.ok(at >= 0, '「允许」入口 allowMicAndStart 不见了');
  const body = vis.slice(at, vis.indexOf('\n  }', at));
  const marked = body.indexOf("markPermissionExplained('microphone')");
  const started = body.indexOf('startListening()');
  assert.ok(marked >= 0, '允许后要标记已说明,否则每次都弹');
  assert.ok(started > marked, '必须先标记再 start —— 反了会出现「说明还没确认就开录」');
}

console.log('permission-rationale: OK');
