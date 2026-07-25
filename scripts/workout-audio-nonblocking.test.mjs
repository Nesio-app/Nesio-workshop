/**
 * 行为契约:跟练播放器**绝不触碰 WebAudio**(修真机「一点跟拍做永久卡死」)。
 * 根因:移动端 WebView 里首次任何 WebAudio 操作(new AudioContext / resume / oscillator.start)都可能在
 * 主线程同步阻塞且不返回(是阻塞非抛错,错误边界接不住)→ 永久冻死。
 * 修法:节拍音改用普通 <audio> 元素(HTMLAudioElement.play(),异步、不阻塞),而不是 WebAudio。
 * 锁死两条:
 *   1) WorkoutPlayer 源码里不得出现任何 WebAudio API。
 *   2) 音频必须走预加载的 <audio> 元素,且 play() 必须被 try/catch + .catch() 兜住(失败绝不影响跟练)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');

// 1) 绝不出现 WebAudio API(这些才是真机同步阻塞主线程 = 跟拍做卡死的元凶)。
//    注:允许注释里出现这些词以说明历史,所以只检查「带调用/构造语义」的写法。
for (const forbidden of ['new AudioContext', 'new webkitAudioContext', '.createOscillator(', '.createGain(', 'AudioContext(', '.resume(']) {
  assert.ok(!src.includes(forbidden), `WorkoutPlayer 不得触碰 WebAudio(移动端首次操作会同步阻塞主线程 = 跟拍做卡死):发现 ${forbidden}`);
}

// 2) 音频必须走 HTMLAudioElement:预加载的 <audio> 元素 + play() 兜底。
assert.match(src, /<audio\b[^>]*\bpreload=/, '节拍音必须用预加载的 <audio> 元素(HTMLAudioElement,不阻塞主线程)');
assert.match(src, /\.play\(\)/, '节拍音必须通过 HTMLAudioElement.play() 播放(异步、不阻塞)');
assert.ok(src.includes('.catch(() => {})') || /\.catch\(\s*\(\s*\)\s*=>/.test(src), 'play() 必须被 .catch() 兜住,声音失败绝不影响跟练');
assert.match(src, /catch\s*\{[^}]*\}/, 'ping/播放必须包在 try/catch 里,任何音频异常都不能冒泡打断跟练');

console.log('workout-audio-nonblocking: OK');
