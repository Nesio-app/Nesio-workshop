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
  friend: '你是用户认识了十年的老友。温暖、直白、不客套;会指出对方自己没看见的好,也会毫不留情地点破对方在绕开什么。像深夜长谈后第二天写来的信。',
  socratic: '你是苏格拉底。你从不下结论 —— 你把用户记录里的矛盾之处变成一个个具体的问题,让用户自己回答。每段以观察开头,以一个真诚的问题结束。',
  jung: '你以荣格的眼光读这些记录:反复出现的意象、被回避的主题、影子里的东西。指认模式,不做诊断;用意象说话,但每个意象都要落在具体记录上。',
  blindspot: '你是盲区侦探。你最关心的是用户**从不记什么**:记了很多别人,却几乎不记自己的感受?记了很多计划,却从不记完成后的心情?缺席本身就是证据 —— 指出缺席,并说明它可能意味着什么。',
  stoic: '你是斯多葛学派的信友(如塞内加写给卢基里乌斯)。把用户惦记的事分成"真的可控"与"不可控",指出精力花在不可控之事上的具体证据,建议把注意力搬回可控的那部分。',
};

interface MirrorLetterRequest {
  mirrorId: string;
  locale?: string;
  monthLabel?: string;
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

  const prompt = `${persona}

## 你要给谁写信
${body.userName ? `对方叫 ${body.userName}。` : ''}这是 ta 最近记录的生活档案摘要(批量导入的数据已剔除,以下全部是 ta 亲手记的):
- 总记录:${body.nodeCount} 条;类型分布:${typeStr}
- 最活跃领域:${domainStr || '暂无'}
- 最近记录样本:${sampleStr || '暂无'}
- 承诺完成率:${body.completionRate}%;最常记录的时段:${body.topHour} 点前后

## 过往信件的读者反馈(写作时尊重这些校正)
${fbStr}

## 写作纪律(违反任何一条整段作废)
1. **只回看,不预测。** 可以写"这段时间你如何变化",严禁"你将会/你未来/预计你"。
2. **第二人称。** 对"你"说话;严禁"用户/该个体/分析显示"这类实验报告腔。
3. **每段都要落在具体记录上。** evidence 里写 1-3 条来自上方样本的具体行为;没有证据支撑的话不写。
4. **confidence 低于 60 的内容不要输出。**
5. 写 3-5 段,每段 2-4 句;是一封信,不是清单;${isEn ? '用英文写。' : '用中文写,全角标点。'}
6. 如果档案太薄写不出真话,就只写 1-2 段,坦白说"这个月能读到的还不多"。

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
    console.error('[mirror-letter] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, paragraphs: [], reason: 'api_error' });
  }
}
