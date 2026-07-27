/**
 * POST /api/portal/mirror-letter
 *
 * 多面镜月度信(v1 规格 §2.3):选一面镜子,基于用户本地档案摘要写一封
 * 第二人称的信。人格来自五层 Mirror Skill(表达DNA/心智模型/启发式/反模式/诚实边界);
 * 老友 + 暖教练免费试读,其余挂 Pro(客户端门);匿名仍被 guardAiRoute 挡住。
 *
 * 硬规则(镜子共同的纪律,人格 prompt 之外强制):
 * - 只回看不预测;可以写"这三个月你如何变化"(演化),不可写"你将会…"
 * - 每段附证据(来自用户记录的具体行为),低置信(<60)整段不写
 * - 第二人称对"你"说话;严禁"用户是一个…的个体"实验报告腔
 * - 批量导入的数据(通讯录等)客户端已剔除,不在摘要里
 * - 优先采用三重验证过关的线索;弱线索勿当铁证
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { envValue } from '@/lib/portal/env';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';
import { getMirrorSkill, isKnownMirrorId, renderMirrorSkillPrompt } from '@/lib/portal/mirror-skills';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * 出口过滤:通用大模型套话的确定性黑名单 —— prompt 会失效,过滤器不会。
 * 命中任何一条的段落直接丢弃(不是改写):套话段落没有抢救价值。
 */
const SLOP_PATTERNS: RegExp[] = [
  /亲爱的|敬爱的/,                                    // 称呼套话(信纸 UI 自带日期头,不需要称呼行)
  /作为(你的)?(老友|朋友|镜子|AI|人工智能|助手|教练)/, // 自我介绍腔
  /^(首先|其次|再者|最后)[,,、]/,                     // 报告腔分点
  /总而言之|综上所述|总之[,,]/,
  /希望(这封信|以上|我的话|这些观察)/,                 // 信尾客套
  /加油|你很棒|继续保持|为你(感到)?骄傲|你已经做得很好/, // 空洞鼓励
  /人生的(旅程|道路|篇章)|成长的(道路|旅程)|更好的(自己|你)/, // 大词抽象
  /你将会|你未来会|预计你|注定/,                       // 预测腔(产品红线)
  /^As your (old )?friend|I hope this (letter|finds)/i,
  /you('re| are) doing great|keep it up|proud of you|journey of (life|growth)/i,
  /you will (soon|definitely)|you're destined/i,
];

function isSlop(text: string): boolean {
  return SLOP_PATTERNS.some((re) => re.test(text));
}

/** 保真度弱闸:有文本却零证据 → 丢(来源不透明)。 */
function failsFidelity(p: RawParagraph): boolean {
  if (!Array.isArray(p.evidence) || p.evidence.filter(Boolean).length === 0) return true;
  // 预测红线双保险(过滤器已盖一层)
  if (/你将会|你未来|预计你|注定失败|you will soon/i.test(p.text)) return true;
  return false;
}

interface MirrorLetterRequest {
  mirrorId: string;
  locale?: string;
  monthLabel?: string;
  /** 主题镜:把整封信聚焦到某一面生活;'全部' 或空 = 不设限。 */
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
  verifiedLenses?: Array<{ label: string; score: number; note: string }>;
  weakClues?: Array<{ label: string; score: number; note: string }>;
}

interface RawParagraph { text: string; evidence: string[]; confidence: number }

async function generateLetter(body: MirrorLetterRequest): Promise<RawParagraph[]> {
  const mirrorId = isKnownMirrorId(body.mirrorId) ? body.mirrorId : 'friend';
  const skill = getMirrorSkill(mirrorId);
  const persona = renderMirrorSkillPrompt(skill);
  const isEn = body.locale === 'en';
  const typeStr = Object.entries(body.typeBreakdown).map(([t, c]) => `${t}:${c}`).join(', ');
  const domainStr = body.topDomains.slice(0, 6).map((d) => `${d.domain}(${d.count})`).join('、');
  const sampleStr = body.recentSample.slice(0, 24).join('、');
  const fbStr = (body.feedbackSamples ?? [])
    .map((f) => `「${f.text}」→ ${f.verdict === 'yes' ? '用户确认说得对' : '用户说不像我'}`)
    .join('\n') || '无';
  const verifiedStr = (body.verifiedLenses ?? [])
    .map((l) => `- [${l.label}·${l.score}重] ${l.note}`)
    .join('\n') || '无(本月线索未过三重验证——写短、写诚实)';
  const weakStr = (body.weakClues ?? [])
    .map((l) => `- [${l.label}] ${l.note}`)
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

## 本地三重验证线索(优先采用「过关」项;「弱线索」勿当铁证)
过关:
${verifiedStr}
弱线索:
${weakStr}
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
7. **保留矛盾。** 时间演化/领域分叉/本质张力都如实写,禁止编一个假调和。
8. 过关线索能支撑的观察优先写;只有弱线索时降低笃定语气。

## 口吻红线(写出任何一种,该段作废——服务端有过滤器,别试)
- 称呼与自我介绍:「亲爱的」「作为你的老友/AI/教练」
- 报告腔:「首先/其次/总之/综上所述」、分点列表、小标题、emoji
- 空洞鼓励:「加油」「你很棒」「继续保持」「为你骄傲」
- 大词抽象:「人生的旅程」「成长的道路」「更好的自己」
- 预测腔:「你将会」「注定」
- 信尾客套:「希望这封信对你有帮助」${isEn ? '\n- English equivalents: "As your friend", "I hope this letter finds you well", "You\'re doing great", "keep it up", "journey of growth", "you will soon".' : ''}

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
    .filter((p) => !isSlop(p.text))
    .filter((p) => !failsFidelity(p))
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
