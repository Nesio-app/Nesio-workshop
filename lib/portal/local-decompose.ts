/**
 * local-decompose — 纯本地拆任务兜底(批次 56,QA 修订)。
 *
 * AI 不在线时用它。不假装聪明,做两件确定有用的事:
 *   1) 任务本身写了多件事(顿号/分号/换行/"然后";逗号要 ≥3 段才算列表)→ 按它拆。
 *   2) 单件事拆不动 → 给一个 ADHD 友好的"先起步"脚手架:两分钟起步 → 推进 → 收尾。
 *
 * QA 实锤修的两个坑:
 *   - 普通逗号在中文里绝大多数是**子句停顿**不是并列任务:"先花2分钟,把X摊开"是
 *     一句话。此前按逗号硬劈 → "先花 2 分钟" / "把X摊在面前" 两个碎片子任务。
 *     现在逗号只在切出 ≥3 段时才当列表("买菜,做饭,洗碗"仍能拆)。
 *   - 对脚手架句自身"再拆"会递归进同一函数产出垃圾。现在识别脚手架句,给
 *     对应的确定性微步骤(定计时/放手边/关干扰…),不再嚼自己的话。
 */

export interface LocalStep { name: string; emoji: string }

// 强分隔:这些几乎总是并列("、" 分号 换行 然后/接着/and/then)
const STRONG_SPLIT_RE = /[、;；\n]+|(?:\s*(?:然后|接着|再然后)\s*)|(?:\s+(?:and|then)\s+)/i;
// 弱分隔:逗号 —— 只有切出 ≥3 段才可信是列表
const COMMA_SPLIT_RE = /[,，]+/;

function cleanStep(s: string): string {
  return s.replace(/^\s*[-*·•\d.]+\s*/, '').trim();
}

function splitIfList(t: string): string[] | null {
  // 批次 71(用户实锤):「列出必带清单(证件/充电器/药)」—— 括号里就是内容清单,
  // 此前不认「/」分隔,整句拆不动 → 掉进通用脚手架三句(二级拆解看着很差)。
  // 括号清单优先:每一项变成一个可勾的真步骤。
  const paren = /[((]([^))]+)[))]/.exec(t);
  if (paren) {
    const inner = paren[1].split(/[/、,,]+/).map(cleanStep).filter((p) => p.length >= 1);
    if (inner.length >= 2) {
      const verb = cleanStep(t.slice(0, paren.index)) || '';
      return inner.map((x) => (verb ? `${verb}:${x}` : x));
    }
  }
  const strong = t.split(STRONG_SPLIT_RE).map(cleanStep).filter((p) => p.length >= 2);
  if (strong.length >= 2) return strong;
  // 斜杠列表:「证件/充电器/药」直接是并列项
  const bySlash = t.split(/\s*\/\s*/).map(cleanStep).filter((p) => p.length >= 1);
  if (bySlash.length >= 2 && bySlash.every((p) => p.length <= 12)) return bySlash;
  const byComma = t.split(COMMA_SPLIT_RE).map(cleanStep).filter((p) => p.length >= 2);
  if (byComma.length >= 3) return byComma; // 两段的逗号句当整句看,不劈
  return null;
}

// 脚手架句 → 再拆时的确定性微步骤(中/英)。识别按前缀,宽松匹配。
const SCAFFOLD_DRILLS: Array<{ zh: RegExp; en: RegExp; zhSteps: string[]; enSteps: string[] }> = [
  {
    zh: /先花 ?2 ?分钟|摊在面前/, en: /^Spend 2 minutes|within reach/i,
    zhSteps: ['定一个 2 分钟的计时器', '把要用的东西放到手边', '关掉无关的窗口和通知'],
    enSteps: ['Set a 2-minute timer', 'Put what you need within reach', 'Close unrelated windows and notifications'],
  },
  {
    zh: /只做最小|做完就算赢|做完最小/, en: /smallest step|done beats perfect/i,
    zhSteps: ['挑一个 5 分钟内能做完的小块', '开始做,不求完美', '做完给自己打个勾'],
    enSteps: ['Pick a piece you can finish in 5 minutes', 'Start — done beats perfect', 'Check it off when finished'],
  },
  {
    zh: /看看进度|再来一轮/, en: /check progress|another round/i,
    zhSteps: ['看一眼已经完成的部分', '还值得再来一轮吗?值得就再拆一波'],
    enSteps: ['Glance at what you already finished', 'Worth another round? If yes, break down the next wave'],
  },
];

export function decomposeLocally(taskName: string, locale: string = 'zh'): LocalStep[] {
  const zh = locale !== 'en';
  const t = (taskName || '').trim();

  // 0) 对脚手架句自身「再拆」→ 给对应微步骤,绝不递归嚼自己的话
  for (const s of SCAFFOLD_DRILLS) {
    if (s.zh.test(t) || s.en.test(t)) {
      const steps = zh ? s.zhSteps : s.enSteps;
      return steps.map((name, i) => ({ name, emoji: ['▸', '▸', '▸'][i] || '·' }));
    }
  }

  // 1) 任务里本来就列了多件事 → 直接拆(逗号需 ≥3 段,见文件头)
  const parts = splitIfList(t);
  if (parts) {
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
