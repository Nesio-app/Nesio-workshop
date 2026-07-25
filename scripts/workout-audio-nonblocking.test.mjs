/**
 * 行为契约:跟练播放器的音频绝不在点击同步路径里创建 AudioContext(修真机「一点跟拍做永久卡死」)。
 * 根因:移动端 WebView 首个 `new AudioContext()` 会同步激活共享音频会话、可能永久阻塞主线程(是阻塞
 * 非抛错,错误边界接不住)。锁死:tone() 只发声不创建;创建走 setTimeout 挪出点击线程。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');

// tone() 函数体里绝不能有 `new AudioContext` / `new AC(`(创建挪出发声路径)。
const toneStart = src.indexOf('function tone(');
assert.ok(toneStart >= 0, '找不到 tone()');
const toneBody = src.slice(toneStart, src.indexOf('\n}', toneStart) + 2);
assert.doesNotMatch(toneBody, /new\s+AC\s*\(|new\s+AudioContext/, 'tone() 绝不能同步 new AudioContext(会阻塞主线程 = 跟拍做卡死)');
assert.match(toneBody, /if\s*\(\s*!ctx\s*\)\s*return/, 'tone():AudioContext 未就绪 → 直接跳过这一声,不创建');

// 创建必须走 setTimeout(挪出点击/手势同步路径),且用一次性 started 标志防重复。
const initStart = src.indexOf('function initAudioDeferred(');
assert.ok(initStart >= 0, '需有 initAudioDeferred() 延迟创建');
const initBody = src.slice(initStart, src.indexOf('\n}', initStart) + 2);
assert.match(initBody, /setTimeout\(/, 'AudioContext 创建必须在 setTimeout 里(挪出点击线程)');
assert.match(initBody, /new\s+AC\s*\(/, 'AudioContext 在延迟初始化里创建');
assert.match(initBody, /_audioInitStarted/, '一次性标志防重复初始化');

// 挂载时预热(不在点击路径)。
assert.match(src, /useEffect\(\(\) => \{ initAudioDeferred\(\); \}, \[\]\)/, '挂载即在宏任务里预热音频(不落点击线程)');

console.log('workout-audio-nonblocking: OK');
