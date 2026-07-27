/**
 * 行为契约:跟练节拍音**安全恢复** —— 有声但不卡死。
 *
 * 历史:壳内 WebView 首次激活音频硬件(WebAudio / HTMLAudio / vibrate)可能同步阻塞主线程
 * 且不返回。修法:
 *  1) WorkoutPlayer 本身绝不直接碰音频/震动 API;视觉节拍(.nesio-wp-beat)必须保留。
 *  2) 声音走独立模块 workout-tempo-sound:仅 HTMLAudioElement + 宏任务 play + 不安全环境静音。
 *  3) 该模块不得出现 WebAudio / vibrate。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wp = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');
const sound = fs.readFileSync(path.join(root, 'lib', 'portal', 'workout-tempo-sound.ts'), 'utf8');

// 1) 播放器本体:不得直接碰硬件音频/震动(实现全在独立模块,便于闸门+契约)。
for (const forbidden of [
  'AudioContext',
  'webkitAudioContext',
  'createOscillator',
  'createGain',
  'new Audio',
  '<audio',
  'vibrate',
]) {
  assert.ok(!wp.includes(forbidden), `WorkoutPlayer 不得直接碰音频/震动 API(发现 ${forbidden});须走 workout-tempo-sound`);
}

// 2) 必须保留纯视觉节拍 + 接线到安全播音模块。
assert.match(wp, /nesio-wp-beat/, '节拍必须保留纯视觉脉冲(.nesio-wp-beat)');
assert.match(wp, /playWorkoutTempo/, 'WorkoutPlayer 须调用 playWorkoutTempo(异步短 WAV)');
assert.match(wp, /unlockWorkoutTempoSound/, '跟拍/计时点击须 unlockWorkoutTempoSound(手势解锁)');
assert.match(wp, /warmupWorkoutTempoSound/, '挂载须 warmupWorkoutTempoSound(宏任务预热)');

// 3) 播音模块:HTMLAudio + 宏任务 + 不安全环境闸门;禁 WebAudio/震动。
assert.match(sound, /new Audio\(/, '节拍音须用 HTMLAudioElement(new Audio),不走 WebAudio');
assert.match(sound, /setTimeout\(/, 'play/warmup 须丢进宏任务,不挡点击路径上的 setState');
assert.match(sound, /isNativePlatform/, '原生壳须默认静音(历史卡死主场)');
assert.match(sound, /; wv\\\)/, 'Android WebView(; wv)须默认静音');
assert.match(sound, /\.catch\(/, 'play() Promise 须 .catch 兜底');
for (const forbidden of [
  'new AudioContext',
  'new webkitAudioContext',
  'webkitAudioContext',
  '.createOscillator(',
  '.createGain(',
  'navigator.vibrate',
  '.vibrate(',
]) {
  assert.ok(!sound.includes(forbidden), `workout-tempo-sound 不得碰 ${forbidden}`);
}

// 4) 短 WAV 资源必须在仓库里(离线可播)。
assert.ok(
  fs.existsSync(path.join(root, 'public', 'assets', 'sounds', 'workout-tick.wav')),
  '缺少 public/assets/sounds/workout-tick.wav',
);
assert.ok(
  fs.existsSync(path.join(root, 'public', 'assets', 'sounds', 'workout-ding.wav')),
  '缺少 public/assets/sounds/workout-ding.wav',
);

console.log('workout-audio-nonblocking: OK(视觉节拍 + 安全 HTMLAudio,壳内默认静音)');
