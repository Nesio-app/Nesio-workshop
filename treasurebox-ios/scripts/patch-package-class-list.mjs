/**
 * cap sync 只扫 npm 插件包里的 @objc(…),扫不到 App/ 下自研 Swift。
 * 结果:每次 sync 把 packageClassList 写成 [] —— 插件已编译进包却永不注册,
 * 真机表现「这版壳没带上定位插件 / 通知」。
 *
 * 本脚本在 sync 之后把六个自研类名写回 capacitor.config.json。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iosRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(iosRoot, 'ios', 'App', 'App');
const configPath = join(appDir, 'capacitor.config.json');

const REQUIRED = [
  'NesioGeolocationPlugin',
  'NesioLocalNotifyPlugin',
  'NesioHealthKitPlugin',
  'NesioVisionPlugin',
  'NesioSpeechPlugin',
  'NesioSpotlightPlugin',
];

function discoverFromSwift() {
  if (!existsSync(appDir)) return [];
  const found = [];
  for (const name of readdirSync(appDir)) {
    if (!name.endsWith('Plugin.swift')) continue;
    const src = readFileSync(join(appDir, name), 'utf8');
    const m = src.match(/@objc\(([A-Za-z0-9_]+)\)/);
    if (m?.[1] && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

if (!existsSync(configPath)) {
  console.error('❌ 找不到', configPath, '—— 先跑 npx cap sync ios');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const fromSwift = discoverFromSwift();
const merged = [...new Set([...REQUIRED, ...fromSwift])].sort();

for (const cls of REQUIRED) {
  if (!merged.includes(cls)) {
    console.error('❌ 缺插件类', cls);
    process.exit(1);
  }
}

cfg.packageClassList = merged;
writeFileSync(configPath, `${JSON.stringify(cfg, null, '\t')}\n`);
console.log('✅ packageClassList =', merged.join(', '));
