/**
 * 行为契约:跟练播放器**绝不播放任何声音**(修真机「一点跟拍做永久卡死」)。
 * 两次真机验证得出的事实:去掉全部声音 → 跟拍做正常;只要放声音(WebAudio 或普通 <audio> 皆然)→
 * 一点跟拍做就永久冻死。根因:这台壳内 WebView 首次激活音频硬件会同步阻塞主线程且不返回(是阻塞
 * 非抛错,错误边界接不住)。所以锁死:WorkoutPlayer 源码里不得出现任何音频播放 API。
 * 节拍改为不碰音频硬件的反馈:震动(navigator.vibrate)+ 视觉脉冲(.nesio-wp-beat),两者瞬时返回不阻塞。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');

// 1) 不得出现任何音频播放 API —— WebAudio 与 HTMLMediaElement 都不行(本机任何出声都会卡死)。
//    注释也不得出现这些字面量,避免误锁松动。
for (const forbidden of ['AudioContext', 'webkitAudioContext', 'createOscillator', 'createGain', '.resume(', 'new Audio', '<audio', '.play(']) {
  assert.ok(!src.includes(forbidden), `WorkoutPlayer 绝不播放任何声音(本机任何出声都会同步卡死主线程):发现 ${forbidden}`);
}

// 2) 必须提供不碰音频硬件的无声节拍:震动 + 视觉脉冲。
assert.match(src, /navigator[^\n]*vibrate|\.vibrate\(/, '无声节拍需用 navigator.vibrate(不支持的设备静默跳过)');
assert.match(src, /nesio-wp-beat/, '无声节拍需有视觉脉冲(.nesio-wp-beat,每拍数字放大回弹)');

console.log('workout-audio-nonblocking: OK(无声节拍,绝不播放声音)');
