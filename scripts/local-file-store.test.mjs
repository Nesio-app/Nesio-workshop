/**
 * 行为契约:记忆附件本机存储(lib/portal/local-file-store.ts)的**收口**。
 *
 * 这条测的不是「存得进去」,是「存进去之后别漏」。仓里踩过一模一样的坑:
 * 记忆照片当年放进独立 IDB(nesio-images),而「清空本地数据」只清了 blob store ——
 * 用户点了删除,照片还留在设备上。附件是同一个形状的新 IDB(nesio-files),
 * 所以同一批收口点一处都不能少,而且必须由测试盯着,不能靠记性。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const store = read('lib/portal/local-file-store.ts');

// ── 存储层本身:六个必须有的口 ──
for (const fn of ['putLocalFile', 'getLocalFile', 'deleteLocalFile', 'purgeLocalFiles', 'collectLocalFiles', 'restoreLocalFiles']) {
  assert.ok(new RegExp(`export (async )?function ${fn}\\b`).test(store), `local-file-store 缺 ${fn}`);
}

// ── 写失败必须可见(红线:绝不吞掉存储写入失败)──
assert.ok(store.includes('reportStorageDropped'), '写失败必须派发可见事件');
assert.ok(store.includes('logDropped'), '写失败必须落 grep 日志');
assert.ok(/MAX_FILE_BYTES/.test(store), '必须有体积上限');

// ── 五处收口,一处都不能漏 ──
// 判据必须是「真的被调用」而不是「文件里出现过这个词」——
// 第一版写成 includes(symbol),结果把 collectLocalFiles 的调用改成 {} 之后测试照样绿:
// import 行里那个词还在。松断言比没断言更坏,它给的是假信心。
const sites = [
  ['lib/portal/cloud-backup.ts', /await collectLocalFiles\(\)/, '导出漏附件 = 「导出你的全部数据」不完整'],
  ['lib/portal/cloud-backup.ts', /await restoreLocalFiles\(/, '恢复漏附件 = 导入回来附件没了'],
  ['lib/portal/local-owner.ts', /purgeLocalFiles\(\)/, '切账号/登出漏清 = 上一个人的附件留在设备上'],
  ['components/portal/SettingsSheets.tsx', /purgeLocalFiles\(\)/, '「删除全部数据」漏清 = 用户以为删了其实没删'],
];
for (const [file, re, why] of sites) {
  assert.ok(re.test(read(file)), `${file} 没真调用 ${re} —— ${why}`);
}
// local-owner 有**两条**清除路径(切账号 + 登出),只接一条等于漏一半
{
  const owner = read('lib/portal/local-owner.ts');
  assert.equal((owner.match(/purgeLocalFiles\(\)/g) || []).length, 2,
    'local-owner 必须两条路径都清(purgeAllLocalUserData + purgeLocalUserDataForLogout)');
}
// SettingsSheets 同理:两处删除入口
{
  const st = read('components/portal/SettingsSheets.tsx');
  assert.ok((st.match(/purgeLocalFiles\(\)/g) || []).length >= 2,
    'SettingsSheets 两处删除入口都要真调用');
}

// ── 上传侧:不许再退回「按类型白名单拒收」──
{
  const feed = read('components/portal/TodayFeed.tsx');
  assert.ok(/await putLocalFile\(/.test(feed), '今天页上传必须走附件 store,不能再拒收二进制');
  assert.ok(/MAX_FILE_BYTES/.test(feed), '拒收的判据必须是体积,不是类型');
}
// ── 详情侧:存了要看得见 ──
{
  const detail = read('components/portal/MemoryNodeDetail.tsx');
  assert.ok(detail.includes('LocalFileRow'), '记忆详情必须渲染附件行,否则存进去看不见');
  assert.ok(detail.includes('revokeObjectURL'), 'objectURL 必须 revoke,否则内存泄漏');
}

console.log('local-file-store: OK(六个口 + 五处收口 + 上传/详情两侧)');
