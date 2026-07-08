/**
 * Notion 结构识别引擎（N-2）——「认结构角色，不认业务类别」。
 *
 * 调研结论:业务类别无限、市场占比不可知,但结构模式有限、可检测。本模块是一个纯函数:
 * 输入一批数据源的 schema(列名+类型)+ 关系拓扑(relation 指向) + 采样元数据(行数/标题样本),
 * 输出每张表的「结构角色」与「每列去留」——供 N-3 的折叠映射按此决定主表/子表/丢弃。
 *
 * 6 种角色(纯启发式,property 类型 + 关系拓扑,与列名业务无关):
 *   hub-entity   枢纽实体:被多张表 relation 指向、自己字段丰富(书/人/项目)——主表
 *   parent-child 父子子表:多对一 relation 指向某表、行数远多于对方(划线→书)——折进父级
 *   log          流水表:带日期、行多、无父无子(习惯/健康/日记)
 *   kanban       看板态:status/select + due date(任务)——记忆价值低但可识别
 *   calendar-dim 日历维度:标题多为日期(日/周/月/年)——丢
 *   dimension    通用维度:被别的表指向、自己几乎没内容列(章节/分类)——丢
 *   plain        兜底
 */

export type NotionPropType =
  | 'title' | 'rich_text' | 'select' | 'status' | 'multi_select' | 'number'
  | 'date' | 'url' | 'email' | 'phone_number' | 'people' | 'files' | 'checkbox'
  | 'formula' | 'rollup' | 'relation' | 'created_time' | 'last_edited_time' | 'unique_id'
  | string;

export interface NotionPropSchema {
  name: string;
  type: NotionPropType;
  /** relation 列:目标数据源/库 id(用于关系拓扑)。 */
  relationTargetId?: string;
}

export interface NotionSourceSchema {
  id: string;
  title: string;
  properties: NotionPropSchema[];
  /** 采样行数(判定父子多对一 / log)。缺省 0。 */
  rowCount?: number;
  /** 标题列采样值(判定日历维度表:多数能 parse 成日期)。 */
  titleSamples?: string[];
}

export type StructureRole =
  | 'hub-entity' | 'parent-child' | 'log' | 'kanban' | 'calendar-dim' | 'dimension' | 'plain';

export interface ColumnDecision {
  name: string;
  type: NotionPropType;
  keep: boolean;
  reason: string;
}

export interface SourceClassification {
  id: string;
  title: string;
  role: StructureRole;
  /** 整表丢弃(日历维度 / 通用维度)。 */
  drop: boolean;
  /** parent-child 子表:折进的父表 id。 */
  foldInto?: string;
  /** 标题列名(名字来源)。 */
  titleColumn: string | null;
  columns: ColumnDecision[];
}

// ── 列级去留规则(按 property 类型 + 列名,与业务无关)──
const KEEP_TYPES = new Set<NotionPropType>([
  'title', 'rich_text', 'select', 'status', 'multi_select', 'date',
  'url', 'email', 'phone_number', 'people', 'checkbox', 'files', 'number',
]);
const DROP_TYPES = new Set<NotionPropType>([
  'formula', 'rollup', 'relation', 'created_time', 'last_edited_time', 'unique_id',
]);
/** 技术 ID 列名:同步工具的内部字段,任何类型都丢(blockId/bookId/bookVersion/chapterUid/reviewId/range/style/ISBN…)。 */
const TECH_NAME = /(^|[_\s])id$|id$|uid$|version$|hash|block|isbn|review|^range$|^style$/i;

/** 标题值像日期:2026年07月03日 / 2026-07-03 / 2026年6月 / 2026 / 2026年第23周。 */
function isDateish(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{4}$/.test(t) ||
    /\d{4}\s*[-/年]\s*\d{1,2}/.test(t) ||
    /^\d{4}\s*年/.test(t) ||
    /第\s*\d+\s*周/.test(t) ||
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)
  );
}

const DATE_DIM_TITLE = /^(日|周|月|年|day|week|month|year|date)s?$/i;
const PLUMBING_TITLE = /^(设置|配置|settings?|config|模板|template)$/i;

function decideColumn(p: NotionPropSchema): ColumnDecision {
  if (p.type === 'title') return { name: p.name, type: p.type, keep: true, reason: '名字' };
  if (DROP_TYPES.has(p.type)) return { name: p.name, type: p.type, keep: false, reason: `派生/关联(${p.type})` };
  if (TECH_NAME.test(p.name)) return { name: p.name, type: p.type, keep: false, reason: '技术ID' };
  if (KEEP_TYPES.has(p.type)) return { name: p.name, type: p.type, keep: true, reason: '语义字段' };
  return { name: p.name, type: p.type, keep: false, reason: '未知类型' };
}

function titleColumnOf(src: NotionSourceSchema): string | null {
  return src.properties.find((p) => p.type === 'title')?.name ?? null;
}

/** 标题多为日期 → 日历维度表。 */
function looksCalendarDim(src: NotionSourceSchema): boolean {
  const samples = (src.titleSamples || []).filter(Boolean);
  if (samples.length) {
    const hit = samples.filter(isDateish).length;
    return hit / samples.length >= 0.6;
  }
  return DATE_DIM_TITLE.test(src.title.trim());
}

/** 有语义内容列的数量(排除 title / 关联 / 技术ID / 派生)——判「通用维度表」用。 */
function contentColumnCount(src: NotionSourceSchema): number {
  return src.properties.filter((p) => {
    if (p.type === 'title') return false;
    const d = decideColumn(p);
    return d.keep;
  }).length;
}

/**
 * 结构识别主函数。纯函数,可单测。
 * @param sources 一批数据源的 schema(至少含 properties;rowCount/titleSamples 可选,缺省用名字启发)
 */
export function classifyDatabase(sources: NotionSourceSchema[]): SourceClassification[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const rows = (id: string) => byId.get(id)?.rowCount || 0;

  // 1) 关系拓扑:统计每个源被多少「其它源」relation 指向(in-degree)。
  const referencedBy = new Map<string, number>();
  for (const s of sources) {
    for (const p of s.properties) {
      if (p.type === 'relation' && p.relationTargetId && p.relationTargetId !== s.id) {
        referencedBy.set(p.relationTargetId, (referencedBy.get(p.relationTargetId) || 0) + 1);
      }
    }
  }

  // 2) 先按标题标死「日历维度 / 管道」——最强信号,优先于关系判定。
  const hardDim = new Map<string, StructureRole>(); // calendar-dim | dimension(plumbing)
  for (const s of sources) {
    if (looksCalendarDim(s)) hardDim.set(s.id, 'calendar-dim');
    else if (PLUMBING_TITLE.test(s.title.trim())) hardDim.set(s.id, 'dimension');
  }

  // 3) 父子候选:非硬维度源之间,relation 边 A→B 且 rows(A) > rows(B) → A 是「多方」,记最强父(按行数比)。
  //    双向 relation 由行数定向(多的一方是子)。指向硬维度表的边不算。
  const content = new Map(sources.map((s) => [s.id, contentColumnCount(s)]));
  const parentOf = new Map<string, { parent: string; ratio: number }>();
  for (const s of sources) {
    if (hardDim.has(s.id)) continue;
    for (const p of s.properties) {
      if (p.type !== 'relation' || !p.relationTargetId) continue;
      const target = p.relationTargetId;
      if (target === s.id || hardDim.has(target) || !byId.has(target)) continue;
      if (rows(s.id) > rows(target)) {
        const ratio = rows(target) ? rows(s.id) / rows(target) : Infinity;
        const cur = parentOf.get(s.id);
        if (!cur || ratio > cur.ratio) parentOf.set(s.id, { parent: target, ratio });
      }
    }
  }
  // 多方有内容列 → 真子表(划线/笔记,折叠);多方没内容列 → 只是查找/标签表(章节,丢)。
  const realChild = (id: string) => parentOf.has(id) && (content.get(id) || 0) >= 1;
  const thinChild = (id: string) => parentOf.has(id) && (content.get(id) || 0) === 0;
  const hasChildren = new Set<string>();
  for (const s of sources) if (realChild(s.id)) hasChildren.add(parentOf.get(s.id)!.parent);

  // 4) 定角色 + 组装(每源赋一次,优先级见下)。
  return sources.map((s) => {
    let role: StructureRole;
    let foldInto: string | undefined;
    let drop = false;

    if (hardDim.get(s.id) === 'calendar-dim') { role = 'calendar-dim'; drop = true; }
    else if (hardDim.get(s.id) === 'dimension') { role = 'dimension'; drop = true; }
    else if (realChild(s.id)) { role = 'parent-child'; foldInto = parentOf.get(s.id)!.parent; }
    else if (thinChild(s.id)) { role = 'dimension'; drop = true; }
    else if (hasChildren.has(s.id)) { role = 'hub-entity'; }
    else if ((referencedBy.get(s.id) || 0) > 0 && (content.get(s.id) || 0) <= 1) { role = 'dimension'; drop = true; }
    else {
      const types = new Set(s.properties.map((p) => p.type));
      // 看板信号:专门的 status 类型,或名字像「状态/阶段」的 select(区别于健身「部位」这类分类 select)。
      const hasStatus = types.has('status') ||
        s.properties.some((p) => p.type === 'select' && /状态|阶段|status|stage|phase/i.test(p.name));
      const hasDate = types.has('date');
      if (hasStatus && hasDate) role = 'kanban';
      else if (hasDate && (s.rowCount || 0) >= 5) role = 'log';
      else role = 'plain';
    }

    return {
      id: s.id,
      title: s.title,
      role,
      drop,
      ...(foldInto ? { foldInto } : {}),
      titleColumn: titleColumnOf(s),
      columns: s.properties.map(decideColumn),
    };
  });
}
