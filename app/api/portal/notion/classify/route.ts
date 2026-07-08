/**
 * POST /api/portal/notion/classify
 * N-5:AI 辅助结构映射 —— 让大模型看一眼各表的列结构,给每张表猜结构角色 + 主表候选。
 *
 * 定位:纯启发式 classifyDatabase(N-2)已能认结构,AI 只做「确认/微调」——
 * 对启发式没把握的表(混合信号)提供第二意见。拿不到 AI(未配 key / 解析失败 / 超时)
 * 时**回落纯启发式**,功能不降级。这是治「库异构」的那一步(LLMATCH/KBS 范式)。
 *
 * Body: { schemas: [{ id, title, properties:[{name,type,relationTargetId?}], rowCount? }] }
 * Returns: { ok, roles: { [id]: role }, source: 'ai'|'heuristic' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { classifyDatabase, type NotionSourceSchema, type StructureRole } from '@/lib/portal/notion-classify';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const ROLES: StructureRole[] = ['hub-entity', 'parent-child', 'log', 'kanban', 'calendar-dim', 'dimension', 'plain'];

function heuristicRoles(schemas: NotionSourceSchema[]): Record<string, StructureRole> {
  const out: Record<string, StructureRole> = {};
  for (const c of classifyDatabase(schemas)) out[c.id] = c.role;
  return out;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, 'notion-classify', { limit: 20 });
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { schemas?: NotionSourceSchema[] };
  const schemas = Array.isArray(body.schemas) ? body.schemas.filter((s) => s && s.id && Array.isArray(s.properties)) : [];
  if (!schemas.length) return NextResponse.json({ ok: false, error: 'no_schemas' }, { status: 400 });

  // 纯启发式先算(也是 AI 不可用时的回落)
  const heuristic = heuristicRoles(schemas);

  if (!aiProviderAvailable()) {
    return NextResponse.json({ ok: true, roles: heuristic, source: 'heuristic' });
  }

  const tablesDesc = schemas.slice(0, 12).map((s) => {
    const cols = s.properties.slice(0, 30).map((p) => `${p.name}(${p.type}${p.relationTargetId ? `→${p.relationTargetId}` : ''})`).join(', ');
    return `表「${s.title}」[id=${s.id}] 行数≈${s.rowCount ?? '?'} 列: ${cols}`;
  }).join('\n');

  const prompt = `你是 Nesio 的 Notion 结构分析器。下面是用户 Notion 库里几张表的列结构与关系。
给每张表判一个「结构角色」,从这些里选一个:
- hub-entity:枢纽实体(被多表关联、字段丰富,如"书/人/项目",是主表)
- parent-child:父子明细(多对一关联到某表、且自己有内容列,如"划线/笔记",要折进父表)
- log:流水表(带日期、多行、无父无子,如习惯/健康打卡)
- kanban:任务看板(有状态列 + 截止日期)
- calendar-dim:日历维度(标题就是日期,如 日/周/月/年,应丢弃)
- dimension:通用维度(被别的表关联但自己几乎没内容,如 章节/分类/标签,应丢弃)
- plain:其它

只输出 JSON,形如 {"roles":{"<表id>":"<角色>", ...}}。不要解释。

表结构:
${tablesDesc}`;

  try {
    const { text } = await completeText({ prompt, maxTokens: 512 });
    const jsonStr = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || text.trim();
    const parsed = JSON.parse(jsonStr) as { roles?: Record<string, string> };
    const aiRoles = parsed.roles || {};
    // 合并:AI 给了合法角色就用 AI,否则用启发式(逐表兜底)
    const roles: Record<string, StructureRole> = {};
    for (const s of schemas) {
      const ai = aiRoles[s.id];
      roles[s.id] = (typeof ai === 'string' && ROLES.includes(ai as StructureRole)) ? (ai as StructureRole) : heuristic[s.id];
    }
    return NextResponse.json({ ok: true, roles, source: 'ai' });
  } catch {
    // 解析/网络失败 → 回落纯启发式,不降级
    return NextResponse.json({ ok: true, roles: heuristic, source: 'heuristic' });
  }
}
