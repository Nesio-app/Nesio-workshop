/**
 * 备份打包口径:导出/导入一律 .json.gz(内含 JSON);旧明文 .json 仍可读。
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
    console, JSON, Object, Array, String, Number, Boolean, Uint8Array, Blob: class {
      constructor(parts, opts) { this._parts = parts; this.type = opts?.type || ''; }
      async arrayBuffer() {
        const u8 = this._parts[0];
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      }
    },
    File: class extends Blob {
      constructor(parts, name, opts) { super(parts, opts); this.name = name; }
    },
  });
  return mod.exports;
}

const P = loadTs('../lib/portal/backup-pack.ts');
const sample = { format: 'nesio-full-backup', version: 1, exportedAt: '2026-08-14T00:00:00.000Z', entries: { a: '1' } };

{
  const { blob, bytes } = await P.packBackupGzip(sample);
  assert.ok(bytes > 20, 'gzip 有体积');
  assert.equal(blob.type, 'application/gzip');
  const file = new File([new Uint8Array(await blob.arrayBuffer())], 'nesio-backup.json.gz', { type: 'application/gzip' });
  // File polyfill above may not wire arrayBuffer from Blob — use raw bytes
  const raw = new Uint8Array(await blob.arrayBuffer());
  const fake = {
    name: 'nesio-backup.json.gz',
    type: 'application/gzip',
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  };
  const parsed = await P.parseBackupFile(fake);
  assert.deepEqual(parsed, sample, 'gz 往返一致');
}

{
  const plain = {
    name: 'old.json',
    type: 'application/json',
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(sample)).buffer,
  };
  const parsed = await P.parseBackupFile(plain);
  assert.deepEqual(parsed, sample, '旧明文 json 仍可读');
}

console.log('backup-pack: OK');
