/**
 * 备份打包口径:导出/导入一律 .zip(json + photos/*.jpg);旧 .json.gz / 明文 .json 仍可读。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const fflate = nodeRequire('fflate');

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: (p) => (p === 'fflate' || p.endsWith('fflate') ? fflate : {}),
    console, JSON, Object, Array, String, Number, Boolean, Uint8Array, atob, btoa,
    Blob: class {
      constructor(parts, opts) { this._parts = parts; this.type = opts?.type || ''; }
      async arrayBuffer() {
        const p = this._parts[0];
        if (p instanceof ArrayBuffer) return p.slice(0);
        if (ArrayBuffer.isView(p)) {
          return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength);
        }
        throw new Error('unsupported Blob part');
      }
    },
    File: class extends Blob {
      constructor(parts, name, opts) { super(parts, opts); this.name = name; }
    },
  });
  return mod.exports;
}

const P = loadTs('../lib/portal/backup-pack.ts');
const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
const sample = {
  format: 'nesio-full-backup',
  version: 1,
  exportedAt: '2026-08-14T00:00:00.000Z',
  entries: {
    a: '1',
    'local-image:photo1': tinyJpeg,
  },
};

{
  const { blob, bytes, photoCount } = await P.packBackupZip(sample);
  assert.ok(bytes > 40, 'zip 有体积');
  assert.equal(blob.type, 'application/zip');
  assert.equal(photoCount, 1, '抽出 1 张照片');
  const raw = new Uint8Array(await blob.arrayBuffer());
  const fake = {
    name: 'nesio-backup.zip',
    type: 'application/zip',
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  };
  const parsed = await P.parseBackupFile(fake);
  assert.equal(parsed.entries.a, '1');
  assert.ok(parsed.entries['local-image:photo1']?.startsWith('data:image/jpeg;base64,'), '照片从 zip 装回');
  // 解压结构契约:必须有独立 jpg,不能只剩嵌图 json
  const files = await new Promise((resolve, reject) => {
    fflate.unzip(raw, (err, out) => (err ? reject(err) : resolve(out)));
  });
  assert.ok(files['nesio-backup.json'], '含 nesio-backup.json');
  assert.ok(Object.keys(files).some((p) => p.startsWith('photos/') && p.endsWith('.jpg')), '含 photos/*.jpg');
  const json = JSON.parse(fflate.strFromU8(files['nesio-backup.json']));
  assert.ok(json.entries['local-image:photo1']?.startsWith('zip-photo:'), 'JSON 内是占位不是 base64');
}

{
  const { blob } = await P.packBackupGzip({ format: 'nesio-full-backup', version: 1, exportedAt: '2026-08-14T00:00:00.000Z', entries: { a: '1' } });
  const raw = new Uint8Array(await blob.arrayBuffer());
  const fake = {
    name: 'nesio-backup.json.gz',
    type: 'application/gzip',
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  };
  const parsed = await P.parseBackupFile(fake);
  assert.deepEqual(parsed.entries, { a: '1' }, '旧 gz 仍可读');
}

{
  const plain = {
    name: 'old.json',
    type: 'application/json',
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
      format: 'nesio-full-backup', version: 1, exportedAt: '2026-08-14T00:00:00.000Z', entries: { a: '1' },
    })).buffer,
  };
  const parsed = await P.parseBackupFile(plain);
  assert.equal(parsed.entries.a, '1', '旧明文 json 仍可读');
}

console.log('backup-pack: OK');
