/**
 * 行为契约:跟练播放器**绝不碰任何设备硬件**(修真机「一点跟拍做永久卡死」)。
 * 真机事实链:放声音 → 一点跟拍就永久冻死;去掉声音、只留「轻震动」→ 仍会卡死。
 * 结论:这台壳内 WebView 任何硬件激活(音频、震动马达…)都可能同步阻塞主线程且不返回
 * (是阻塞非抛错,错误边界接不住)。所以跟练只用**纯界面反馈**:大号次数的视觉脉冲(.nesio-wp-beat)。
 * 锁死:WorkoutPlayer 源码里不得出现任何音频播放 API,也不得出现震动(navigator.vibrate)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');

// 不得碰任何硬件:音频(WebAudio + HTMLMediaElement)与震动马达都不行。
// 注释里也不得出现这些字面量,避免误锁松动。
for (const forbidden of ['AudioContext', 'webkitAudioContext', 'createOscillator', 'createGain', '.resume(', 'new Audio', '<audio', '.play(', 'vibrate']) {
  assert.ok(!src.includes(forbidden), `WorkoutPlayer 绝不碰设备硬件(本机任何硬件激活都会同步卡死主线程):发现 ${forbidden}`);
}

// 必须有不碰硬件的纯视觉节拍:大号次数每拍放大回弹(.nesio-wp-beat)。
assert.match(src, /nesio-wp-beat/, '节拍必须是纯视觉脉冲(.nesio-wp-beat,每拍数字放大回弹,纯 React+CSS)');

console.log('workout-audio-nonblocking: OK(纯视觉节拍,绝不碰任何硬件)');
