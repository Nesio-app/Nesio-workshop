/**
 * local-decompose — 纯本地拆任务兜底(批次 56)。
 *
 * AI 不在线时用它。不假装聪明,做两件确定有用的事:
 *   1) 任务本身写了多件事(顿号/逗号/换行/"和""然后")→ 就按它拆成几步。
 *   2) 单件事拆不动 → 给一个 ADHD 友好的"先起步"脚手架:两分钟起步 → 推进 → 收尾。
 * 关键价值:哪怕彻底离线,「拆一下」也永远能给你一个能开始的第一步,不再整个失败。
 */

export interface LocalStep { name: string; emoji: string }

const SPLIT_RE = /[、,，;；\n]+|(?:\s+(?:然后|接着|再|and|then)\s+)/i;

function cleanStep(s: string): string {
  return s.replace(/^\s*[-*·•\d.]+\s*/, '').trim();
}

export function decomposeLocally(taskName: string, locale: string = 'zh'): LocalStep[] {
  const zh = locale !== 'en';
  const t = (taskName || '').trim();

  // 1) 任务里本来就列了多件事 → 直接拆
  const parts = t.split(SPLIT_RE).map(cleanStep).filter((p) => p.length >= 2);
  if (parts.length >= 2) {
    return parts.slice(0, 3).map((p, i) => ({ name: p, emoji: ['①', '②', '③'][i] || '·' }));
  }

  // 2) 单件事 → 两分钟起步 / 推进 / 收尾脚手架
  const short = t.length > 14 ? t.slice(0, 14) + '…' : (t || (zh ? '这件事' : 'this task'));
  return zh
    ? [
        { name: `先花 2 分钟,把「${short}」需要的东西摊在面前`, emoji: '▶' },
        { name: `只做最小的一步,做完就算赢`, emoji: '◆' },
        { name: `停下来看看进度,决定要不要再来一轮`, emoji: '✓' },
      ]
    : [
        { name: `Spend 2 minutes laying out what "${short}" needs`, emoji: '▶' },
        { name: `Do just the smallest step — finishing it counts as a win`, emoji: '◆' },
        { name: `Pause, check progress, decide if you want another round`, emoji: '✓' },
      ];
}
