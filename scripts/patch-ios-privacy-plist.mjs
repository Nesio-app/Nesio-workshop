#!/usr/bin/env node
/**
 * 在 `npx cap sync ios` / `cap add ios` 之后写入隐私用途串。
 * 缺 NSCameraUsageDescription 时，WKWebView 调 getUserMedia / capture 会直接闪退。
 * 与 codemagic.yaml 里的 PlistBuddy 文案保持一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');

if (!fs.existsSync(plistPath)) {
  console.log('patch-ios-privacy-plist: skip (ios/App/App/Info.plist missing — run cap add ios first)');
  process.exit(0);
}

const keys = {
  NSCameraUsageDescription: '用于「拍一下」记录物品与场景。',
  NSMicrophoneUsageDescription: '用于「说一句」语音记录。',
  NSPhotoLibraryUsageDescription: '用于从相册选取照片记录。',
  NSPhotoLibraryAddUsageDescription: '用于把识别结果相关图片保存到相册。',
  NSLocationWhenInUseUsageDescription: '用于给记忆和天气建议加上大致位置；可随时在系统设置关闭。',
  NSLocationAlwaysAndWhenInUseUsageDescription:
    '用于在后台轻轻记录足迹与天气上下文（例如通勤途中）；可随时在系统设置改为「使用 App 期间」或关闭。',
  NSLocationAlwaysUsageDescription: '用于在后台轻轻记录足迹与天气上下文；可随时在系统设置关闭。',
  NSHealthShareUsageDescription:
    '用于读取你授权的步数、睡眠、心率等，在本机生成健康洞察；数据默认留在手机。',
  NSHealthUpdateUsageDescription: 'Nesio 目前只读取健康数据，不会写入 Apple 健康。',
};

let xml = fs.readFileSync(plistPath, 'utf8');
let added = 0;
for (const [key, value] of Object.entries(keys)) {
  if (xml.includes(`<key>${key}</key>`)) continue;
  const block = `\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  if (!xml.includes('</dict>\n</plist>')) {
    console.error('patch-ios-privacy-plist: unexpected Info.plist shape');
    process.exit(1);
  }
  xml = xml.replace('</dict>\n</plist>', `${block}</dict>\n</plist>`);
  added += 1;
}

if (!xml.includes('<key>ITSAppUsesNonExemptEncryption</key>')) {
  xml = xml.replace(
    '</dict>\n</plist>',
    '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>\n</plist>',
  );
  added += 1;
}

if (!xml.includes('<key>UIBackgroundModes</key>')) {
  const bg = `\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>\n`;
  xml = xml.replace('</dict>\n</plist>', `${bg}</dict>\n</plist>`);
  added += 1;
} else if (!xml.includes('<string>location</string>')) {
  xml = xml.replace(
    /<key>UIBackgroundModes<\/key>\s*<array>/,
    '<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>',
  );
  added += 1;
}

fs.writeFileSync(plistPath, xml);
console.log(`patch-ios-privacy-plist: ok (+${added} keys → ${plistPath})`);
