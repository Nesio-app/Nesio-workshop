/**
 * POST /api/portal/mirror-letter
 *
 * 多面镜月度信(v1 规格 §2.3):选一面镜子,基于用户本地档案摘要写一封
 * 第二人称的信。多视角综合 + 文笔是云 LLM 不可替代处 —— Pro 卖点;
 * 老友视角免费试读(客户端放行,匿名仍被 guardAiRoute 挡住 → 匿名云调用=0)。
 *
 * 硬规则(镜子共同的纪律,人格 prompt 之外强制):
 * - 只回看不预测;可以写"这三个月你如何变化"(演化),不可写"你将会…"
 * - 每段附证据(来自用户记录的具体行为),低置信(<60)整段不写
 * - 第二人称对"你"说话;严禁"用户是一个…的个体"实验报告腔
 * - 批量导入的数据(通讯录等)客户端已剔除,不在摘要里
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MIRROR_PROMPTS: Record<string, string> = {
  friend: '你是用户认识了十年的老友。温暖、直白、不客套;会指出对方自己没看见的好,也会毫不留情地点破对方在绕开什么。像深夜长谈后第二天写来的信。\n本镜硬约束:至少两段直接引用对方记录的原话(用「」括起样本里的条目);可以温柔地不客气;结尾不总结、不祝福,留一句真实的牵挂或一个具体的提醒。',
  socratic: '你是苏格拉底。你从不下结论 —— 你把用户记录里的矛盾之处变成一个个具体的问题,让用户自己回答。\n本镜硬约束:每段 = 一个来自记录的具体观察 + 以一个真诚的问题收尾;全信至多一句陈述性结论(最好一句都没有);问题必须指向记录里真实存在的张力,不许问「你有没有想过人生的意义」这类空题。',
  jung: '你以荣格的眼光读这些记录:反复出现的意象、被回避的主题、影子里的东西。指认模式,不做诊断。\n本镜硬约束:意象必须从记录原文里长出来(引用对方写过的词),不许空降术语;「阴影/原型/个体化」这类词全信至多出现一次;每段落至多谈一个意象。',
  blindspot: '你是盲区侦探。你最关心的是用户**从不记什么**。\n本镜硬约束:每段的证据必须是「缺席证据」——用对照说话(如「记了 14 条要做的事,记做完之后感受的是 0 条」);不许把记录里出现过的东西说成盲区;指出缺席之后必须说清它**可能**意味着什么(用「可能」,不下诊断)。',
  stoic: '你是斯多葛学派的信友(如塞内加写给卢基里乌斯)。\n本镜硬约束:每段明确点名记录里的哪件事可控、哪件不可控,判定要落在具体条目上;每段给一个具体的注意力搬运动作(把花在 X 上的心力搬到 Y),不许只说「专注于你能控制的」这种空话。',
};

/**
 * 出口过滤:通用大模型套话的确定性黑名单 —— prompt 会失效,过滤器不会。
 * 命中任何一条的段落直接丢弃(不是改写):套话段落没有抢救价值。
 */
const SLOP_PATTERNS: RegExp[] = [
  /亲爱的|敬爱的/,                                    // 称呼套话(信纸 UI 自带日期头,不需要称呼行)
  /作为(你的)?(老友|朋友|镜子|AI|人工智能|助手)/,      // 自我介绍腔
  /^(首先|其次|再者|最后)[,,、]/,                     // 报告腔分点
  /总而言之|综上所述|总之[,,]/,
  /希望(这封信|以上|我的话|这些观察)/,                 // 信尾客套
  /加油|你很棒|继续保持|为你(感到)?骄傲|你已经做得很好/, // 空洞鼓励
  /人生的(旅程|道路|篇章)|成长的(道路|旅程)|更好的(自己|你)/, // 大词抽象
  /^As your (old )?friend|I hope this (letter|finds)/i,
  /you('re| are) doing great|keep it up|proud of you|journey of (life|growth)/i,
];

function isSlop(text: string): boolean {
  return SLOP_PATTERNS.some((re) => re.test(text));
}

interface MirrorLetterRequest {
  mirrorId: string;
  locale?: string;
  monthLabel?: string;
  /** 主题镜:把整封信聚焦到某一面生活(情绪/关系/事业/成长/健康);'全部' 或空 = 不设限。 */
  focusTopic?: string;
  nodeCount: number;
  typeBreakdown: Record<string, number>;
  topDomains: Array<{ domain: string; count: number }>;
  recentSample: string[];
  completionRate: number;
  topHour: number;
  dominantDomains: string[];
  userName?: string;
  feedbackSamples?: Array<{ text: string; verdict: 'yes' | 'no' }>;
}

interface RawParagraph { text: string; evidence: string[]; confidence: number }

async function generateLetter(body: MirrorLetterRequest): Promise<RawParagraph[]> {
  const persona = MIRROR_PROMPTS[body.mirrorId] ?? MIRROR_PROMPTS.friend;
  const isEn = body.locale === 'en';
  const typeStr = Object.entries(body.typeBreakdown).map(([t, c]) => `${t}:${c}`).join(', ');
  const domainStr = body.topDomains.slice(0, 6).map((d) => `${d.domain}(${d.count})`).join('、');
  const sampleStr = body.recentSample.slice(0, 24).join('、');
  const fbStr = (body.feedbackSamples ?? [])
    .map((f) => `「${f.text}」→ ${f.verdict === 'yes' ? '用户确认说得对' : '用户说不像我'}`)
    .join('\n') || '无';

  const focus = body.focusTopic && body.focusTopic !== '全部' && body.focusTopic.toLowerCase() !== 'all'
    ? body.focusTopic
    : '';

  const prompt = `${persona}

## 你要给谁写信
${body.userName ? `对方叫 ${body.userName}。` : ''}这是 ta ${body.monthLabel ? `${body.monthLabel}` : '最近'}记录的生活档案摘要(批量导入的数据已剔除,以下全部是 ta 亲手记的):
- 总记录:${body.nodeCount} 条;类型分布:${typeStr}
- 最活跃领域:${domainStr || '暂无'}
- 最近记录样本:${sampleStr || '暂无'}
- 承诺完成率:${body.completionRate}%;最常记录的时段:${body.topHour} 点前后
${focus ? `\n## 本封信的主题镜\n只从与「${focus}」相关的记录里取证、只谈这一面;与该主题无关的观察一律不写。若这个主题在档案里几乎没有痕迹,就诚实地只写 1 段说清「这个月关于${focus}你几乎没留下什么」,不硬凑。` : ''}

## 过往信件的读者反馈(写作时尊重这些校正)
${fbStr}

## 写作纪律(违反任何一条整段作废)
1. **只回看,不预测。** 可以写"这段时间你如何变化",严禁"你将会/你未来/预计你"。
2. **第二人称。** 对"你"说话;严禁"用户/该个体/分析显示"这类实验报告腔。
3. **每段都要落在具体记录上。** 至少一段直接引用样本里的条目原文(用「」);evidence 里写 1-3 条来自上方样本的具体行为;没有证据支撑的话不写。
4. **confidence 低于 60 的内容不要输出。**
5. 写 3-5 段,每段 2-4 句;是一封信,不是清单;不写称呼行、不写署名;${isEn ? '用英文写。' : '用中文写,全角标点。'}
6. 如果档案太薄写不出真话,就只写 1-2 段,坦白说"这个月能读到的还不多"。

## 口吻红线(写出任何一种,该段作废——服务端有过滤器,别试)
- 称呼与自我介绍:「亲爱的」「作为你的老友/AI」
- 报告腔:「首先/其次/总之/综上所述」、分点列表、小标题、emoji
- 空洞鼓励:「加油」「你很棒」「继续保持」「为你骄傲」
- 大词抽象:「人生的旅程」「成长的道路」「更好的自己」
- 信尾客套:「希望这封信对你有帮助」${isEn ? '\n- English equivalents: "As your friend", "I hope this letter finds you well", "You\'re doing great", "keep it up", "journey of growth".' : ''}

## 好坏对照(以老友镜为例,其他镜同理)
坏(通用大模型腔):「作为你的老朋友,我注意到你这个月记录了很多搬家相关的内容,这说明你正在经历人生的重要转变,加油!」
好:「四条都是搬家:看房、联系公司、约验房。事推得很快,可一句关于新家的期待都没有——你是真想搬,还是不得不搬?」
好在哪:引用具体记录、有一个别人给不了的真观察、结尾是牵挂不是口号。写不出"好"这一档的段落,宁可少写一段。

## 输出格式(严格 JSON,不加解释)
{"paragraphs":[{"text":"...","evidence":["..."],"confidence":75}]}`;

  const { text: raw } = await completeText({
    prompt,
    maxTokens: 1800,
    temperature: 0.4,
    responseFormat: 'json',
    model: envValue('CLAUDE_MODEL') || 'claude-3-5-sonnet-latest',
  });
  const parsed = parseJsonBlock<{ paragraphs: RawParagraph[] }>(raw);
  if (!parsed || !Array.isArray(parsed.paragraphs)) throw new Error('no JSON in response');
  return parsed.paragraphs
    .filter((p) => p && typeof p.text === 'string' && p.text.trim() && (p.confidence ?? 0) >= 60)
    // 出口过滤:套话段落直接丢弃 —— 宁可信短,不可信水
    .filter((p) => !isSlop(p.text))
    .slice(0, 5)
    .map((p) => ({
      text: p.text.trim(),
      evidence: Array.isArray(p.evidence) ? p.evidence.slice(0, 3).map(String) : [],
      confidence: Math.min(100, Math.max(0, Math.round(p.confidence ?? 60))),
    }));
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'mirror_letter', { limit: 6 });
  if (guard) return guard;

  const body = await req.json() as MirrorLetterRequest;

  // 档案太薄写不出真话 —— 与认知模型同门槛,别给 3 条记录的新用户编一封笃定的信。
  if (!body || typeof body.mirrorId !== 'string' || body.nodeCount < 10) {
    return NextResponse.json({ ok: true, paragraphs: [], reason: 'insufficient_data' });
  }
  if (!aiProviderAvailable()) {
    return NextResponse.json({ ok: true, paragraphs: [], reason: 'no_api_key' });
  }

  try {
    const paragraphs = await generateLetter(body);
    return NextResponse.json({ ok: true, paragraphs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mirror-letter] error:', msg);
    // 配额耗尽单列:这不是"AI 忙",是服务端没配付费 key —— 给用户准话
    const quota = msg.includes('quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
    return NextResponse.json({ ok: true, paragraphs: [], reason: quota ? 'quota' : 'api_error' });
  }
}
