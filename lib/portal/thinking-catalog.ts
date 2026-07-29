/**
 * thinking-catalog — 思维陷阱策展知识库(用户定:别让 LLM 随机编,靠专业策展 + 确定性算法)。
 *
 * 每条陷阱都来自成熟研究(行为经济学 Kahneman/Tversky、认知行为治疗 Beck、逻辑学、统计学、
 * 效应研究),含:一句话识破 / 为什么中招 / 典型场景 / 学科来源 / 逻辑谬误违反的规律。
 * 出题(buildChallenge)是**确定性**的:正确项=命中的这条,干扰项=同类里的其它陷阱,
 * 讲解直接取库 —— 不依赖大模型即成题。LLM 只在有真实记忆时做可选的「场景个性化」。
 *
 * 分类参照 en.wikipedia.org/wiki/List_of_cognitive_biases(250+ 偏差 8 类)与非形式逻辑谬误四类
 *(歧义/相关性/预设/弱归纳);中文逻辑三律 + 充足理由律作「违反的规律」轴。
 */

export type TrapCategory = 'logic' | 'cognition' | 'decision' | 'statistics' | 'distortion' | 'effect';

export interface ThinkingTrap {
  id: string;
  name: string; nameEn: string;
  category: TrapCategory;
  principle?: string;   // 逻辑谬误:违反的规律
  spot: string;         // 一句话识破
  why: string;          // 为什么这句话/这想法中招
  example: string;      // 典型场景(第一人称口语,可当练习题干)
  domain: string;       // 学科来源
}

export const CATEGORY_LABEL: Record<TrapCategory, { zh: string; en: string; icon: string }> = {
  logic: { zh: '逻辑谬误', en: 'Logical fallacy', icon: '<path d="M12 4v6M12 10l-5 10M12 10l5 10"/>' },
  cognition: { zh: '认知偏差', en: 'Cognitive bias', icon: '<path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5z"/><circle cx="12" cy="12" r="2.5"/>' },
  decision: { zh: '决策偏差', en: 'Decision bias', icon: '<path d="M12 21v-7M12 14L6 5M12 14l6-9"/>' },
  statistics: { zh: '统计偏差', en: 'Statistical bias', icon: '<path d="M4 20V6M4 20h16M8 20v-6M13 20v-9M18 20v-4"/>' },
  distortion: { zh: '认知扭曲', en: 'Cognitive distortion', icon: '<rect x="4" y="5" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 0 0 2-2V9"/>' },
  effect: { zh: '心理效应', en: 'Effect', icon: '<path d="M3 12h4l2-5 3 9 2-6 1 2h6"/>' },
};
export const CATEGORY_ORDER: TrapCategory[] = ['logic', 'cognition', 'decision', 'statistics', 'distortion', 'effect'];

export const THINKING_TRAPS: ThinkingTrap[] = [
  // ── 逻辑谬误(多违反「充足理由律」:理由撑不起结论)──
  { id: 'gambler', name: '赌徒谬误', nameEn: "Gambler's fallacy", category: 'logic', principle: '违反·充足理由律',
    spot: '「都这么多次了,该轮到我了」', why: '把彼此独立的事,当成会「找平」互相补偿 —— 前面的结果不改变下一次的概率。',
    example: '「投了 8 家都没回音…… 按概率,第 9 家总该轮到我了吧。」', domain: '概率论 / 逻辑学' },
  { id: 'slippery', name: '滑坡谬误', nameEn: 'Slippery slope', category: 'logic', principle: '违反·充足理由律',
    spot: '一步没做好,就断定会一路滑到最坏', why: '从「第一步」推到「最坏结局」,中间每一环都没论证,默认了「必然连锁」。',
    example: '「今天允许他质疑一句,明天他们就谁都不信、后天走火入魔,迟早办不下去。」', domain: '逻辑学' },
  { id: 'circular', name: '循环论证', nameEn: 'Circular reasoning', category: 'logic', principle: '违反·充足理由律',
    spot: '结论拿来当理由,绕回自己', why: '「A 因为 B,B 因为 A」—— 论据和结论是同一件事换了说法,等于没论证。',
    example: '「他说的一定对,因为他从不说错;他从不说错,因为他说的都对。」', domain: '逻辑学' },
  { id: 'bandwagon', name: '诉诸众人', nameEn: 'Bandwagon', category: 'logic', principle: '违反·充足理由律',
    spot: '「大家都信,所以是对的」', why: '多少人相信,和一件事真不真没关系 —— 真理不投票。',
    example: '「这么多人都在买,肯定错不了,跟着上就对了。」', domain: '逻辑学 / 社会心理学' },
  { id: 'equivocation', name: '偷换概念', nameEn: 'Equivocation', category: 'logic', principle: '违反·同一律',
    spot: '同一个词,前后悄悄换了意思', why: '同一律要求一个词在一次论证里意思不变;偷换了,结论就站不住。',
    example: '「你说要『自由』,那我不还钱也是我的自由,你管不着。」', domain: '逻辑学' },
  { id: 'strawman', name: '稻草人', nameEn: 'Straw man', category: 'logic', principle: '违反·充足理由律',
    spot: '把对方观点歪曲成好打的样子再打', why: '你反驳的是自己编的版本,不是对方真正说的 —— 赢了也没意义。',
    example: '「你说想少加班?哦,那你就是想让公司倒闭、大家都没饭吃咯。」', domain: '逻辑学' },
  { id: 'appeal-emotion', name: '诉诸情绪', nameEn: 'Appeal to emotion', category: 'logic', principle: '违反·充足理由律',
    spot: '用情绪代替论证来说服', why: '让你害怕/内疚/感动,不等于把道理讲通了 —— 情绪不是证据。',
    example: '「你要是真爱这个家,就不该反对我这个决定。」', domain: '逻辑学' },
  { id: 'ad-hominem', name: '人身攻击', nameEn: 'Ad hominem', category: 'logic', principle: '违反·充足理由律',
    spot: '不反驳观点,转头攻击说话的人', why: '「谁说的」和「说得对不对」是两件事;攻击人,反驳不了事。',
    example: '「这观点你也信?提出它的人连大学都没读过。」', domain: '逻辑学' },
  { id: 'appeal-tradition', name: '诉诸传统 / 自然', nameEn: 'Appeal to tradition', category: 'logic', principle: '违反·充足理由律',
    spot: '「一直这样」当成「就该这样」', why: '「自古如此 / 这才自然」不是理由 —— 「一直这样」和「本该这样」之间,缺一座论证的桥。',
    example: '「自古修行就是向内求清净,你那套『还要向外看世界』不合规矩。」', domain: '逻辑学' },
  { id: 'appeal-ignorance', name: '诉诸无知', nameEn: 'Appeal to ignorance', category: 'logic', principle: '违反·充足理由律',
    spot: '「没证据反对,所以它成立」', why: '举证责任在主张的一方;「你证明不了它是假的」推不出「它是真的」。',
    example: '「你也没法证明这不管用啊,那我就当它有效了。」', domain: '逻辑学' },
  { id: 'tu-quoque', name: '比烂 / 诉诸虚伪', nameEn: 'Tu quoque', category: 'logic', principle: '违反·充足理由律',
    spot: '「你还不是一样」来回避', why: '对方是否做到,和他说的对不对无关 —— 用「你也一样」堵嘴,躲过了真问题。',
    example: '「你凭什么说我拖延?你自己不也总迟交。」', domain: '逻辑学' },
  { id: 'cherry-picking', name: '樱桃挑选', nameEn: 'Cherry picking', category: 'logic', principle: '违反·充足理由律',
    spot: '只摆对自己有利的证据,藏起不利的', why: '挑出来的樱桃代表不了整棵树 —— 看到一面之词,先问:被砍掉的另一半呢?',
    example: '「你看这几个成功案例,就知道这个方法万能。」(失败的不提)', domain: '逻辑学 / 统计学' },
  { id: 'false-dilemma', name: '非黑即白 / 假两难', nameEn: 'False dilemma', category: 'logic', principle: '违反·排中律',
    spot: '只给两个极端选项,好像没有中间', why: '真实世界大多有第三、第四条路;把选项砍到两个,是为了逼你选。',
    example: '「你要么支持我们,要么就是敌人,没有中间地带。」', domain: '逻辑学' },
  { id: 'post-hoc', name: '事后归因', nameEn: 'Post hoc', category: 'logic', principle: '违反·充足理由律',
    spot: '「B 在 A 之后发生,所以 A 导致 B」', why: '先后不等于因果 —— 中间可能只是巧合,或另有真正的原因。',
    example: '「我换了这个手机壳之后就升职了,它一定带来了好运。」', domain: '逻辑学 / 统计学' },

  // ── 认知偏差(Kahneman / Tversky)──
  { id: 'anchoring', name: '锚定效应', nameEn: 'Anchoring', category: 'cognition',
    spot: '被第一个数字 / 印象拖着走', why: '第一眼看到的「锚」会拉着后面的判断;商家的「原价」就是这么用的。',
    example: '「原价 999,现价 399 —— 太划算了,买!」(它本来可能只值 200)', domain: '行为经济学' },
  { id: 'confirmation', name: '确认偏误', nameEn: 'Confirmation bias', category: 'cognition',
    spot: '只找支持自己的证据,忽略相反的', why: '我们倾向记住、寻找、相信合自己意的信息,自动过滤掉反例 —— 越看越觉得自己对。',
    example: '「我就说他不靠谱 —— 你看,又有一件事证明了。」(顺手的反例全没算)', domain: '认知心理学' },
  { id: 'availability', name: '可得性启发', nameEn: 'Availability heuristic', category: 'cognition',
    spot: '越容易想起来,就以为越常见 / 越可能', why: '好回忆的(新闻里、亲历过的)被高估;真实概率被生动画面盖过。',
    example: '「新闻天天报坠机,我还是别坐飞机了。」(其实开车危险得多)', domain: '行为经济学' },
  { id: 'representativeness', name: '代表性启发', nameEn: 'Representativeness', category: 'cognition',
    spot: '「像」就当成「是」,忽略基率', why: '光看像不像典型形象,不管这类人本来有多少 —— 忽略了背景概率。',
    example: '「他戴眼镜、爱看书,肯定是教授吧?」(其实普通职员多得多)', domain: '行为经济学' },
  { id: 'hindsight', name: '事后诸葛 / 后见之明', nameEn: 'Hindsight bias', category: 'cognition',
    spot: '「我早就知道会这样」', why: '结果出来后,大脑自动把它改写成「本来就明显」,高估了当时的可预测性。',
    example: '「这事儿我一开始就看出来了,肯定会黄。」(当时其实没这么笃定)', domain: '认知心理学' },

  // ── 决策偏差 ──
  { id: 'sunk-cost', name: '沉没成本', nameEn: 'Sunk cost', category: 'decision',
    spot: '「已经投这么多了,不能停」', why: '已经花掉、收不回的钱/时间,不该左右「接下来还值不值」的判断 —— 该止损时止损。',
    example: '「这条路我已经搭进去十年了,再不对也得走下去,不然十年就白费了。」', domain: '行为经济学' },
  { id: 'loss-aversion', name: '损失厌恶', nameEn: 'Loss aversion', category: 'decision',
    spot: '怕失去,远大过想得到', why: '同样金额,损失的痛约是获得之乐的两倍;于是宁可套牢也不肯认亏卖出。',
    example: '「这只股票亏着我不卖 —— 一卖就等于承认我错了。」', domain: '行为经济学' },
  { id: 'mental-accounting', name: '心理账户', nameEn: 'Mental accounting', category: 'decision',
    spot: '同样的钱,按来源分别对待', why: '钱本身没有标签;但我们把工资和意外之财放进不同「心理账户」,后者更容易挥霍。',
    example: '「工资我省着花,可这笔中奖的钱嘛 —— 花了也不心疼。」', domain: '行为经济学' },
  { id: 'overconfidence', name: '过度自信', nameEn: 'Overconfidence', category: 'decision',
    spot: '把估计当事实,不留余地', why: '人普遍高估自己的知识和预测力;越是频繁下注,越容易忽略系统性风险。',
    example: '「我看得准,这波我肯定能抄到底。」', domain: '行为经济学' },
  { id: 'status-quo', name: '现状偏好', nameEn: 'Status quo bias', category: 'decision',
    spot: '不改比改更「安全」,即使不划算', why: '维持现状让人觉得风险小、责任轻;于是明知更好也懒得动。',
    example: '「换个更便宜的套餐?算了,一直用这个,懒得折腾。」', domain: '行为经济学' },
  { id: 'endowment', name: '禀赋效应', nameEn: 'Endowment effect', category: 'decision',
    spot: '一旦拥有,就高估它的价值', why: '同一件东西,「我的」比「别人的」在心里更值钱 —— 拥有本身抬了价。',
    example: '「这旧手办我不卖,给多少都不够 —— 它对我可不一样。」', domain: '行为经济学' },

  // ── 统计偏差 ──
  { id: 'survivorship', name: '幸存者偏差', nameEn: 'Survivorship bias', category: 'statistics',
    spot: '只看见活下来的,没看见沉默的失败', why: '成功者会说话、失败者已消失;只统计幸存的样本,结论会过度乐观。',
    example: '「这些大佬都没读完大学,可见读书没用。」(退学失败的那一大批看不到)', domain: '统计学' },
  { id: 'selection', name: '选择性偏差', nameEn: 'Selection bias', category: 'statistics',
    spot: '样本不能代表整体', why: '取样的方式本身有偏(只问了愿意回答的人),结论就推不到全体。',
    example: '「我问了身边人,都说这产品好 —— 肯定卖得动。」(身边人本就相似)', domain: '统计学' },
  { id: 'omitted-variable', name: '遗漏变量', nameEn: 'Omitted variable', category: 'statistics',
    spot: '忽略了背后真正起作用的因素', why: '两件事一起变,可能是被同一个没算进来的第三因素推动的。',
    example: '「吃冰淇淋越多,溺水越多 —— 冰淇淋危险!」(真凶是『夏天』)', domain: '统计学 / 计量经济学' },
  { id: 'correlation-causation', name: '相关当因果', nameEn: 'Correlation ≠ causation', category: 'statistics',
    spot: '两件事一起出现,就当成一个导致另一个', why: '相关只是「一起动」,不代表谁导致谁;可能反过来,也可能都被第三方推动。',
    example: '「用了这个 App 的人成绩都好,所以它能提分。」(可能是好学生才会用)', domain: '统计学' },

  // ── 认知扭曲(CBT / Beck)──
  { id: 'overgeneralize', name: '以偏概全', nameEn: 'Overgeneralizing', category: 'distortion',
    spot: '一两件事 →「我这个人就是…」', why: '用一两次的表现,给「整个人、永远」下了定论;样本太小,结论太大。',
    example: '「这次汇报又卡壳了,我就是不擅长在人前说话,天生的。」', domain: '认知行为治疗' },
  { id: 'catastrophize', name: '灾难化', nameEn: 'Catastrophizing', category: 'distortion',
    spot: '把后果想到最坏、最远', why: '大脑抓住「万一」不放,直接跳到灾难结局,忽略了更可能的普通结果。',
    example: '「这封邮件他没回 —— 完了,他一定很生气,项目要黄,我要被开了。」', domain: '认知行为治疗' },
  { id: 'labeling', name: '贴标签', nameEn: 'Labeling', category: 'distortion',
    spot: '给自己 / 别人贴一个死标签', why: '把「做了某件事」偷换成「我就是某种人」;标签一贴,就不看具体、不给改的余地。',
    example: '「我又搞砸了,我就是个失败者。」', domain: '认知行为治疗' },
  { id: 'mind-reading', name: '读心术', nameEn: 'Mind reading', category: 'distortion',
    spot: '断定别人心里怎么想,却没问过', why: '把自己的猜测当成对方的事实,再为这个想象出来的态度难过。',
    example: '「他刚才没笑,肯定觉得我很烦。」(其实他只是累了)', domain: '认知行为治疗' },
  { id: 'emotional-reasoning', name: '情绪化推理', nameEn: 'Emotional reasoning', category: 'distortion',
    spot: '「我觉得糟,所以事情一定糟」', why: '把「感受」当成「事实的证据」;情绪很真实,但它不等于真相。',
    example: '「我现在特别焦虑,所以这件事肯定要出大问题。」', domain: '认知行为治疗' },
  { id: 'should', name: '应该式思维', nameEn: 'Should statements', category: 'distortion',
    spot: '满是「我应该 / 必须 / 本该」', why: '给自己立一堆硬性标准,做不到就自责;「应该」越多,内耗越重。',
    example: '「我本该早就做完的,现在才开始,太差劲了。」', domain: '认知行为治疗' },

  // ── 心理效应 ──
  { id: 'halo', name: '光环效应', nameEn: 'Halo effect', category: 'effect',
    spot: '一点好 → 觉得处处都好', why: '某个突出优点(长得好、名气大)会晕染到无关的方面,让整体评价失真。',
    example: '「他长得这么周正,人品肯定也好,业务也差不了。」', domain: '社会心理学' },
  { id: 'dunning-kruger', name: '达克效应', nameEn: 'Dunning-Kruger', category: 'effect',
    spot: '懂得越少,越觉得自己懂', why: '能力不足的人,恰恰缺少「看出自己不足」的能力;于是自信心和真实水平倒挂。',
    example: '「看了两篇文章,我觉得这行我已经门儿清了。」', domain: '认知心理学' },
];

export function trapById(id: string): ThinkingTrap | undefined { return THINKING_TRAPS.find((t) => t.id === id); }

// ── 确定性出题算法(不依赖 LLM)────────────────────────────────────────────────
export interface Challenge {
  trap: ThinkingTrap;
  scene: string;            // 题干场景(默认取库里的 example;可被真实记忆个性化替换)
  question: string;
  options: string[];        // 4 个陷阱名(1 正确 + 3 同类干扰)
  correctIndex: number;
  source?: string;          // 「照你 X 的记录改写」;纯库题为空
}

/** 稳定伪随机:同一 seed 出同一结果(日内幂等、可复现)。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hashStr(s: string): number { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** 为一条陷阱造题:干扰项优先同类,不足再从别类补;顺序按 seed 稳定打乱。 */
export function buildChallenge(trap: ThinkingTrap, seed: number): Challenge {
  const rnd = seeded(seed);
  const pick = (arr: ThinkingTrap[], n: number) => {
    const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n);
  };
  const sameCat = THINKING_TRAPS.filter((t) => t.id !== trap.id && t.category === trap.category);
  const others = THINKING_TRAPS.filter((t) => t.id !== trap.id && t.category !== trap.category);
  const distract = [...pick(sameCat, 3), ...pick(others, 3)].slice(0, 3);
  const all = [trap, ...distract];
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return {
    trap, scene: trap.example, question: '这句话犯了哪一种谬误?',
    options: all.map((t) => t.name), correctIndex: all.findIndex((t) => t.id === trap.id),
  };
}

/** 每日一练:按天确定性挑一条陷阱造题(日内幂等)。 */
export function pickDailyChallenge(now = Date.now()): Challenge {
  const day = Math.floor(now / 86_400_000);
  const trap = THINKING_TRAPS[day % THINKING_TRAPS.length];
  return buildChallenge(trap, day + 1);
}

/** 「再来一题」:换一条,避免与上一条同 id。 */
export function nextChallenge(prevId: string, seed: number): Challenge {
  const rnd = seeded(seed);
  let t = THINKING_TRAPS[Math.floor(rnd() * THINKING_TRAPS.length)];
  if (t.id === prevId) t = THINKING_TRAPS[(THINKING_TRAPS.indexOf(t) + 1) % THINKING_TRAPS.length];
  return buildChallenge(t, seed + 7);
}

/** 遇见状态:从回看流按陷阱名子串派生(答过里出现过 = 在生活里认出过它)。 */
export function trapsMet(history: Array<{ question?: string; answer?: string; context?: string }>): Set<string> {
  const hay = history.map((h) => `${h.question || ''} ${h.answer || ''} ${h.context || ''}`).join('\n');
  const met = new Set<string>();
  for (const t of THINKING_TRAPS) if (hay.includes(t.name)) met.add(t.id);
  return met;
}

/**
 * 每条陷阱的**原始出处**(2026-07-28,用户标注 图19「这些解释科学么」)。
 *
 * 图鉴一直是策展的、不是大模型现编的 —— 但屏幕上只显示学科名(「认知偏差」「逻辑学」),
 * 看不出是谁在哪篇提出的,所以看着像随口写的。这里把提出者 / 出处补上并显示在讲解里:
 * 有名有姓有年份,读者自己能去查。
 *
 * 编写口径:优先给**首次提出/命名**的那篇;心理学条目给经典实验,逻辑谬误给古典出处 +
 * 现代非形式逻辑教科书里的标准名。不确定的宁可写学科传统,也不编具体文献。
 */
export const TRAP_SOURCES: Record<string, string> = {
  // 逻辑谬误:古典出处 / 首次命名
  gambler: '拉普拉斯《概率的哲学随笔》(1814);现代表述见 Tversky & Kahneman《小数法则的信念》(1971)',
  slippery: '非形式逻辑标准谬误;系统分析见 Walton《Slippery Slope Arguments》(1992)',
  circular: '亚里士多德《前分析篇》—— 窃取论题(petitio principii)',
  bandwagon: '非形式逻辑「诉诸群众」;从众的实证基础见 Asch 线段判断实验(1951)',
  equivocation: '亚里士多德《辩谬篇》—— 歧义谬误',
  strawman: '非形式逻辑标准谬误;现代讨论见 Talisse & Aikin《Two Forms of the Straw Man》(2006)',
  'appeal-emotion': '亚里士多德《修辞学》中 pathos 的误用;Walton《Appeal to Pity》(1997)',
  'ad-hominem': '洛克《人类理解论》(1690) 首次命名 argumentum ad hominem',
  'appeal-tradition': '摩尔《伦理学原理》(1903) 的「自然主义谬误」—— 从「本来如此」推不出「就该如此」',
  'appeal-ignorance': '洛克《人类理解论》(1690) 命名 argumentum ad ignorantiam',
  'tu-quoque': '非形式逻辑;人身攻击(ad hominem)的一个子型,古典拉丁名 tu quoque',
  'cherry-picking': '统计学「选择性报告」;后果讨论见 Ioannidis《Why Most Published Research Findings Are False》(2005)',
  'false-dilemma': '非形式逻辑标准谬误 —— 假二分(false dichotomy)',
  'post-hoc': '拉丁 post hoc ergo propter hoc;因果判别方法见 Mill《逻辑体系》(1843)',
  // 认知偏差:经典实验
  anchoring: 'Tversky & Kahneman, Science (1974) —— 转盘实验',
  confirmation: 'Wason 四卡片选择任务(1960);综述见 Nickerson (1998)',
  availability: 'Tversky & Kahneman, Cognitive Psychology (1973)',
  representativeness: 'Kahneman & Tversky (1972);「Linda 问题」见 Tversky & Kahneman (1983)',
  hindsight: 'Fischhoff, J. Exp. Psychol.: HPP (1975) —— 「我早就知道会这样」效应',
  // 决策偏差:行为经济学
  'sunk-cost': 'Arkes & Blumer《The Psychology of Sunk Cost》(1985)',
  'loss-aversion': 'Kahneman & Tversky 前景理论, Econometrica (1979)',
  'mental-accounting': 'Thaler《Mental Accounting and Consumer Choice》, Marketing Science (1985)',
  overconfidence: 'Lichtenstein, Fischhoff & Phillips (1982);三种形态的区分见 Moore & Healy (2008)',
  'status-quo': 'Samuelson & Zeckhauser《Status Quo Bias in Decision Making》(1988)',
  endowment: 'Thaler (1980);马克杯实验见 Kahneman, Knetsch & Thaler (1990)',
  // 统计偏差
  survivorship: 'Wald 二战轰炸机弹孔分析(1943)—— 只看得到飞回来的那些',
  selection: 'Berkson (1946) 的入院率偏倚;流行病学标准偏倚之一',
  'omitted-variable': '计量经济学标准结果 —— 遗漏变量偏误(见 Wooldridge 教材)',
  'correlation-causation': 'Pearson (1897) 论虚假相关;因果判据见 Bradford Hill (1965)',
  // 认知扭曲:CBT
  overgeneralize: 'Beck 认知疗法(1963/1976);十大扭曲清单见 Burns《伯恩斯新情绪疗法》(1980)',
  catastrophize: 'Ellis 理性情绪行为疗法(1957);Beck 认知疗法',
  labeling: 'Burns《伯恩斯新情绪疗法》(1980) 十大认知扭曲',
  'mind-reading': 'Beck (1976);Burns (1980) 归入「妄下结论」',
  'emotional-reasoning': 'Burns《伯恩斯新情绪疗法》(1980)',
  should: 'Ellis 的「必须化」(musturbation), REBT (1957);Burns (1980)',
  // 心理效应
  halo: 'Thorndike《A Constant Error in Psychological Ratings》(1920)',
  'dunning-kruger': 'Kruger & Dunning, J. Personality and Social Psychology (1999)',
};

/** 取某条陷阱的出处;没登记就退回学科名(绝不编)。 */
export function trapSource(id: string): string | null {
  return TRAP_SOURCES[id] || null;
}
