/**
 * 行为契约:备份目的地选择器(Google Drive 免费 / Nesio 云兜底)。
 * 锁死(源码级,逻辑在 React 组件内):选择器二选一 + 偏好持久化(nesio-backup-dest);
 * 备份/恢复按所选目的地分发;Drive 未连接自动落回 Nesio 云兜底。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const s = fs.readFileSync(new URL('../components/portal/SettingsSheets.tsx', import.meta.url), 'utf8');

// 选择器 + 偏好持久化
assert.ok(/backupDest/.test(s) && /'drive'\s*\|\s*'nesio'/.test(s), '目的地状态 drive|nesio');
assert.ok(s.includes("localStorage.getItem('nesio-backup-dest')"), '读回上次选择');
assert.ok(s.includes("localStorage.setItem('nesio-backup-dest'"), '选择持久化');
assert.ok(s.includes('pickBackupDest'), '选择器切换 handler');
assert.ok(s.includes('Google Drive') && s.includes('Nesio 云'), '两个云选项都在选择器');

// 按所选目的地分发
assert.ok(/handleBackupChosen\s*=\s*\(\)\s*=>\s*\(backupDest === 'drive' \? handleDriveBackup\(\) : handleCloudBackup\(\)\)/.test(s), '备份按目的地分发');
assert.ok(/handleRestoreChosen\s*=\s*\(\)\s*=>\s*\(backupDest === 'drive' \? handleDriveRestore\(\) : handleCloudRestore\(\)\)/.test(s), '恢复按目的地分发');
assert.ok(s.includes('onClick={handleBackupChosen}') && s.includes('onClick={handleRestoreChosen}'), '统一按钮接线');

// Drive 未连接 → 兜底 Nesio 云
const driveFn = s.slice(s.indexOf('async function handleDriveBackup'), s.indexOf('async function handleDriveBackup') + 900);
assert.ok(driveFn.includes("r.error === 'not_connected'") && driveFn.includes('handleCloudBackup()'), 'Drive 未连接自动落回 Nesio 云兜底');

// 单独的旧「备份到 Google Drive」独立按钮已并入选择器(不再各按各的)
assert.ok(!s.includes('免费备份到 Google Drive · 换机不丢'), '旧独立 Drive 备份按钮已并入选择器');

console.log('backup-dest: OK');
