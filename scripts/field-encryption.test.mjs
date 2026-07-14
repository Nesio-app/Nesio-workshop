/**
 * 行为契约:云端敏感字段静态加密(数据审计 #2 —— 应用层字段加密,非 E2E)。
 * 锁死:
 *  - 休眠(未开启)时 encryptField 原样返回明文(passthrough,现网零变化)。
 *  - 开启后 encrypt→decrypt 往返还原(字符串 / JSON 对象 / 数组 都保真)。
 *  - 混合模式:decryptField 对非信封值(旧明文行)原样透传。
 *  - fail-closed:篡改密文 / 错密钥 → 解密抛错,绝不返回错数据。
 *  - 开启但无密钥 → 加密抛错,绝不静默落明文。
 *  - signals 列助手:只加密内容列(title/payload/entities/evidence/embedding_text),
 *    元数据列(source/type/embedding_vector...)保持明文可查询。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

function compile(path, env) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require: (p) => (p === 'node:crypto' ? { default: crypto, ...crypto } : {}),
    console, Buffer, JSON, Number, Array, Object, String, Set, Map, RegExp,
    process: { env },
  });
  return mod.exports;
}

// ── 休眠:passthrough ──
const off = compile('../lib/portal/cloud/field-encryption.ts', {});
assert.equal(off.isFieldEncryptionEnabled(), false, '默认休眠');
assert.equal(off.encryptField('secret'), 'secret', '休眠时明文原样返回');
assert.deepEqual(off.encryptField({ a: 1 }), { a: 1 }, '休眠时对象原样返回');
assert.equal(off.isEncryptedField('secret'), false);

// ── 开启:往返 ──
const env = { NESIO_FIELD_ENCRYPTION: '1', NESIO_FIELD_ENCRYPTION_KEY: 'test-secret-key-123' };
const on = compile('../lib/portal/cloud/field-encryption.ts', env);
assert.equal(on.isFieldEncryptionEnabled(), true);

const encStr = on.encryptField('张三的病历:高血压');
assert.ok(on.isEncryptedField(encStr), '产出信封');
assert.ok(encStr.startsWith('enc:v1:'), '带版本前缀');
assert.ok(!encStr.includes('张三'), '密文不含明文');
assert.equal(on.decryptField(encStr), '张三的病历:高血压', '字符串往返');

const obj = { note: '私密', amount: 42, nested: { x: [1, 2] } };
const encObj = on.encryptField(obj);
assert.ok(on.isEncryptedField(encObj), '对象加密后是信封字符串');
assert.deepEqual(on.decryptField(encObj), obj, 'JSON 对象往返');

const arr = [{ id: 'p1', name: '妈妈' }];
assert.deepEqual(on.decryptField(on.encryptField(arr)), arr, '数组往返');

// null/undefined 不加密
assert.equal(on.encryptField(null), null);
assert.equal(on.encryptField(undefined), undefined);
// 幂等:已是信封不重复加密
assert.equal(on.encryptField(encStr), encStr, '不重复加密信封');

// ── 混合模式:旧明文行原样透传 ──
assert.equal(on.decryptField('老明文标题'), '老明文标题', '非信封值原样透传');
assert.deepEqual(on.decryptField({ old: 'plain' }), { old: 'plain' }, '非信封对象原样');

// ── fail-closed ──
assert.throws(() => on.decryptField(encStr.slice(0, -4) + 'AAAA'), '篡改密文 → 抛错');
const otherKey = compile('../lib/portal/cloud/field-encryption.ts', { NESIO_FIELD_ENCRYPTION: '1', NESIO_FIELD_ENCRYPTION_KEY: 'different-key' });
assert.throws(() => otherKey.decryptField(encStr), '错密钥 → 抛错');
const noKey = compile('../lib/portal/cloud/field-encryption.ts', { NESIO_FIELD_ENCRYPTION: '1' });
assert.throws(() => noKey.encryptField('x'), '开启但无密钥 → 加密抛错(不落明文)');

// ── signals 列助手 ──
const row = {
  identity_key: 'idk', source: 'voice', type: 'observation',
  title: '看牙医', payload: { where: '诊所' }, entities: [{ id: 'e', type: 't', name: '牙医' }],
  evidence: { source: 'voice', raw: '今天去看牙医了' }, embedding_text: '看牙医 诊所',
  embedding_vector: [0.1, 0.2], occurred_at: '2026-07-01', sensitivity: 'health',
};
const encRow = on.encryptSignalRowColumns(row);
// 内容列加密
for (const col of ['title', 'payload', 'entities', 'evidence', 'embedding_text']) {
  assert.ok(on.isEncryptedField(encRow[col]), `${col} 已加密`);
}
// 元数据列保持明文可查询
assert.equal(encRow.source, 'voice', 'source 保持明文');
assert.equal(encRow.type, 'observation', 'type 保持明文');
assert.deepEqual(encRow.embedding_vector, [0.1, 0.2], 'embedding_vector 保持明文(不可逆数值,检索必需)');
assert.equal(encRow.sensitivity, 'health', 'sensitivity 保持明文');
// 落库序列化仍是合法 JSON(jsonb 列接受 JSON 字符串)
assert.doesNotThrow(() => JSON.stringify(encRow));
// 读回解密还原
const decRow = on.decryptSignalRowColumns(encRow);
assert.equal(decRow.title, '看牙医');
assert.deepEqual(decRow.payload, { where: '诊所' });
assert.deepEqual(decRow.evidence, { source: 'voice', raw: '今天去看牙医了' });
// 混合行(部分明文)也能读
const mixed = on.decryptSignalRowColumns({ title: on.encryptField('密'), payload: { plain: true } });
assert.equal(mixed.title, '密');
assert.deepEqual(mixed.payload, { plain: true }, '明文列原样');
// 休眠时 signals 助手 passthrough
assert.deepEqual(off.encryptSignalRowColumns(row), row, '休眠时行原样');

console.log('field-encryption: OK');
