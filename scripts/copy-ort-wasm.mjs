// 把 onnxruntime-web 的 wasm 运行时拷到 public/ort/(CSP connect-src 'self',
// 不能走 CDN;产物不进 git,dev/build 前自动执行)
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dst = join(root, 'public', 'ort');
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
    copyFileSync(join(src, f), join(dst, f));
    n += 1;
  }
}
console.log(`[ort] ${n} 个运行时文件 → public/ort/`);
