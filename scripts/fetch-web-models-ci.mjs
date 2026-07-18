/**
 * 构建时拉端上模型进 public/lab/models/(照 bundle:ort 的路子填静态资源)。
 *
 * 从 nesio-ml 私有 Release 用 GitHub API 下载(不依赖 gh CLI,Vercel 构建里能跑)。
 * 认证:环境变量 GH_TOKEN(在 Vercel 项目设置里配一次,对 nesio-ml 有读权限即可)。
 * 没配 token → 打印告警并跳过(exit 0):端上照片/文字搜索本次部署不可用(功能降级),
 * 但绝不让构建失败。CLIP 分词器 public/lab/tokenizer.json 已入库,不在此拉。
 *
 * 本地实测:GH_TOKEN=$(gh auth token) node scripts/fetch-web-models-ci.mjs
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'Nesio-app/nesio-ml';
const DEST = 'public/lab/models';
const SPEC = [
  { tag: 'web-models-mobileclip2-s0-v1', names: ['ImageEncoder.fp16.onnx', 'TextEncoder.fp16.onnx'] },
  { tag: 'web-models-e5-small-v1', names: ['TextEmbedder.fp16.onnx', 'e5-tokenizer.json'] },
];

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.warn('[bundle:models] 未设 GH_TOKEN —— 跳过模型拉取。端上照片/文字搜索本次部署将降级为不可用(不影响构建)。');
  process.exit(0);
}

const headers = (extra = {}) => ({ Authorization: `Bearer ${token}`, 'User-Agent': 'nesio-build', ...extra });

async function getRelease(tag) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: headers({ Accept: 'application/vnd.github+json' }),
  });
  if (!r.ok) throw new Error(`取 release ${tag} 失败:HTTP ${r.status}(token 是否有 ${REPO} 读权限?)`);
  return r.json();
}

async function download(asset, dest) {
  // 资产下载:Accept octet-stream → 302 到签名 URL;签名 URL 别带 Authorization(否则 S3 拒)
  const r = await fetch(asset.url, { headers: headers({ Accept: 'application/octet-stream' }), redirect: 'manual' });
  let res = r;
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location');
    if (!loc) throw new Error(`${asset.name}:重定向缺 Location`);
    res = await fetch(loc);
  }
  if (!res.ok) throw new Error(`下载 ${asset.name} 失败:HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

mkdirSync(DEST, { recursive: true });
let total = 0;
for (const { tag, names } of SPEC) {
  const rel = await getRelease(tag);
  for (const name of names) {
    const asset = rel.assets.find((a) => a.name === name);
    if (!asset) throw new Error(`${tag} 缺资产 ${name}`);
    const dest = join(DEST, name);
    if (existsSync(dest) && statSync(dest).size === asset.size) {
      console.log(`  = ${name}(已在,${(asset.size / 1e6).toFixed(0)}MB)`);
      total += asset.size;
      continue;
    }
    const n = await download(asset, dest);
    console.log(`  ✓ ${name}(${(n / 1e6).toFixed(0)}MB)`);
    total += n;
  }
}
console.log(`[bundle:models] 完成,共 ${(total / 1e6).toFixed(0)}MB → ${DEST}/`);
