/**
 * 行为契约:被中止的手势不是一次点击(2026-07-30 用户实锤)。
 *
 * 原话:「日程里的上下滑动,很容易打开某个具体的条目,而我并没有想打开」。
 * 根因是两个洞叠在一起,都在 SchedulePanel 的 SwipeRow 里:
 *
 *   ① 纵向锁定时只做了 `start.current = null; setDx(0)`,没留下「这次是滚动」的记号。
 *      松手时 onUp 看到 dx === 0,于是 `Math.abs(0) < 6` 成立 → 当成点击,打开条目。
 *      也就是:任何在条目上起手的上下滑,只要手指最后抬在这一条上,就会打开它。
 *   ② `onPointerCancel={onUp}` —— cancel 的语义是「这个手势被系统接管/中止了」,
 *      浏览器接管滚动时正是发它。同样 dx === 0 → 又一次误开。
 *
 * 所以钉两件事:
 *   A. 「打开」必须来自**真正的 click**,不能从 pointerup 的分支里推断出来
 *      (顺带保证键盘 Enter/Space 也能打开 —— 那个 <button> 此前根本没有 onClick);
 *   B. onPointerCancel 不许和 onPointerUp 接同一个处理函数 —— 除非它只做清理、
 *      不提交任何用户可见的动作(那种要写进下面的名单,并说明理由)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── A. 日程行:打开来自 click,不来自 pointerup ──
{
  const src = strip(read('components/portal/insights/SchedulePanel.tsx'));
  const rowStart = src.indexOf('function SwipeRow');
  assert.ok(rowStart > 0, 'SwipeRow 不见了 —— 这条契约钉的就是它的手势收尾');
  const row = src.slice(rowStart, src.indexOf('\n}\n', rowStart));

  const onUp = row.slice(row.indexOf('const onUp'), row.indexOf('const onCancel'));
  assert.ok(
    onUp.length > 0 && !/onOpen\(\)/.test(onUp),
    '「打开」不许写在 pointerup 的分支里 —— 上下滑动时 dx 是 0,' +
    '任何「位移很小就算点击」的判断都会把滚动当成点击(用户实锤:一滑就打开条目)',
  );
  assert.match(row, /onClick=\{onClickRow\}/, '打开必须挂在真正的 click 上(键盘 Enter/Space 也才有效)');
  assert.match(row, /swiped\.current/, '必须记住「这一次已经不是点击了」,并据此吃掉随后的 click');
}

// ── B. cancel 不许和 up 共用处理函数(除非只做清理) ──
{
  // 已知且可接受的例外:写清楚是哪一个、为什么。
  const ALLOW = new Map([
    [
      'components/portal/MemoryTab.tsx',
      '记忆卡:该处理器(clearTimer)只清掉待触发的长按定时器,不提交任何动作 —— ' +
      'up 与 cancel 在这里的语义确实相同(都是「别再等长按了」)。',
    ],
    [
      'components/portal/NesioChatSheet.tsx',
      '聊天气泡:该处理器(cancelBubbleLongPress)只清掉待触发的长按定时器,不提交任何动作。' +
      '⚠️ 同一文件里「按住说话」是另一处接法(cancel 走内联箭头 → stopRecording → 送出),' +
      '本契约的正则不覆盖它 —— 那是「取消手势要不要发出去」的产品决定,不在这条规则里替它拍板。',
    ],
    [
      'components/portal/cooking/CookingSheet.tsx',
      '想做清单的菜卡:该处理器(cancelHold)只清掉待触发的长按定时器,不提交任何动作。',
    ],
    [
      'components/portal/insights/MemoryMapSheet.tsx',
      '地图画布:该处理器只做指针簿记与捏合缩放收尾,不会打开任何条目;' +
      '缩放是可逆的,误提交的代价远低于「点开一条不想点的记忆」。',
    ],
  ]);

  const files = fs.readdirSync(new URL('../components/portal', import.meta.url), { recursive: true })
    .filter((f) => String(f).endsWith('.tsx'))
    .map((f) => `components/portal/${String(f).replace(/\\/g, '/')}`);

  const offenders = [];
  for (const f of files) {
    const src = strip(read(f));
    // 只抓「cancel 与 up 接的是同一个标识符」这种写法;内联箭头函数各写各的,不算共用。
    for (const m of src.matchAll(/onPointerUp=\{(\w+)\}[\s\S]{0,200}?onPointerCancel=\{(\w+)\}/g)) {
      if (m[1] === m[2]) offenders.push(f);
    }
    for (const m of src.matchAll(/onPointerCancel=\{(\w+)\}[\s\S]{0,200}?onPointerUp=\{(\w+)\}/g)) {
      if (m[1] === m[2]) offenders.push(f);
    }
  }

  for (const f of new Set(offenders)) {
    assert.ok(
      ALLOW.has(f),
      `${f}:onPointerCancel 和 onPointerUp 接了同一个处理函数。` +
      'cancel 的意思是「这次手势被系统接管/中止了」(滚动接管时就发它)—— ' +
      '它绝不能触发用户可见的动作。要么分开写,要么把它加进本契约的例外名单并说明理由。',
    );
  }
}

console.log('gesture-cancel-not-tap: OK(打开只来自 click / cancel 不与 up 共用)');
