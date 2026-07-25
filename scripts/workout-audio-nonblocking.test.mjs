/**
 * 行为契约:跟练播放器**绝不触碰 WebAudio**(修真机「一点跟拍做永久卡死」)。
 * 根因:移动端 WebView 里首次任何 WebAudio 操作(new AudioContext / resume / oscillator.start)都可能在
 * 主线程同步阻塞且不返回(是阻塞非抛错,错误边界接不住)→ 永久冻死。节拍音是次要功能,已完全移除。
 * 锁死:WorkoutPlayer 源码里不得出现任何 WebAudio API。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');

for (const forbidden of ['AudioContext', 'createOscillator', 'webkitAudioContext', '.resume(', 'createGain']) {
  assert.ok(!src.includes(forbidden), `WorkoutPlayer 不得触碰 WebAudio(移动端首次操作会同步阻塞主线程 = 跟拍做卡死):发现 ${forbidden}`);
}

// tone() 仍在(供 ping 调用点保留),但必须是 no-op(不做任何会阻塞的事)。
assert.match(src, /function tone\([^)]*\)\s*:\s*void\s*\{\s*\/\*[^}]*\*\/\s*\}/, 'tone() 必须是 no-op(不触碰 WebAudio)');

console.log('workout-audio-nonblocking: OK');
