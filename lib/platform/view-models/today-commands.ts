/**
 * Today 命令层 —— 架构审查 #9(读写分离)。
 * view-model 是纯查询侧;所有 Today 的写操作收敛到这里,统一走合法写入门
 * (ingestLifeNode / updateLifeNode —— 后者已由 node-fact-sink 接进事实库)。
 * 每个命令负责自己的 UI 失效广播(nesio-life-graph-updated)。
 */

import { ingestLifeNode } from '../../life-domain/ingest-node';
import { getLifeGraph, updateLifeNode, deleteLifeNode, type LifeNode } from '../../portal/life-graph';
import { localDayKey, type SubTask, type FocusNode } from './today-view-model';

function broadcast(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}

function parseSubtasks(attrs: Record<string, unknown>): SubTask[] | undefined {
  const raw = attrs.subtasksJson;
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw) as SubTask[]; } catch { return undefined; }
}

export function saveSubtasks(nodeId: string, subtasks: SubTask[]): void {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return;
  updateLifeNode(nodeId, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(subtasks) } });
  broadcast();
}

export function toggleSubtask(nodeId: string, subtaskId: string): void {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return;
  const subtasks = parseSubtasks(node.attributes) ?? [];
  const next = subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s);
  updateLifeNode(nodeId, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(next) } });
  broadcast();
}

export function markFocusNodeDone(id: string): void {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return;
  updateLifeNode(id, { attributes: { ...node.attributes, done: true, doneAt: new Date().toISOString() } });
  broadcast();
}

// 真·删除今日焦点节点(不是「从今日移除」的软隐藏)。今日表面组件不得直连 life-graph
// (平台边界),删除必须走命令层——所以放这里,由 TodayFeed 以回调下传给焦点卡。
export function deleteFocusNode(id: string): void {
  if (deleteLifeNode(id)) broadcast();
}

// 批次 154:会议行动项抽取结果(meeting-notes 路由返回)。To do=显式指派(可带截止日),
// Inferred=隐含推断(无日期)。
export interface MeetingExtraction {
  summary?: string;
  todo?: Array<{ text: string; deadline?: string | null }>;
  inferred?: string[];
  people?: string[];
}

// 批次 155:会议来源溯源 —— 让批次154 的抽取对「任何外部会议源」可复用(麦克风 / Granola / …)。
interface MeetingProvenance {
  granolaMeetingId?: string;   // 去重锚:同一场 Granola 会议不重复入库
  recordedAt?: string;         // 会议真实日期(ISO);缺省用现在
  extraTags?: string[];        // 追加标签,如 ['Granola']
}

// 共享写入:会议记录节点 + To do 各成 commitment 节点。麦克风保存与 Granola 同步都走这里。
// 返回挂上的日历日程节点 id(没匹配到对应日程 → null),供上游统计「挂到日程几场」。
function writeMeetingExtraction(
  meetingNodeId: string,
  meetingName: string,
  notes: string,
  locale: string,
  extraction?: MeetingExtraction,
  prov?: MeetingProvenance,
): string | null {
  const en = locale.toLowerCase().startsWith('en');
  const inferred = (extraction?.inferred ?? []).filter((s) => s.trim());
  const people = (extraction?.people ?? []).filter((s) => s.trim());
  const extraTags = prov?.extraTags ?? [];
  const recordedAt = prov?.recordedAt || new Date().toISOString();

  // ⓪ 闭环:挂到对应日历日程。Granola 常只给日期(没有时刻)—— 那种按「同一天 + 标题」
  // 匹配;有时刻的仍走窗口(前 30min / 后 60min)。窗口外不硬凑。
  const calNode = findCalendarForMeeting(meetingName, recordedAt);

  // ① 会议记录节点:留转写原文,并把总结/推断项/人名收进 attributes(详情页可读)。
  const record = ingestLifeNode({
    name: `${en ? 'Meeting notes' : '会议记录'} · ${meetingName}`,
    type: 'event',
    tags: [en ? 'Meeting notes' : '会议记录', 'meeting-notes', ...extraTags],
    attributes: {
      meetingNodeId,
      notes,
      recordedAt,
      ...(prov?.granolaMeetingId ? { granolaMeetingId: prov.granolaMeetingId } : {}),
      ...(extraction?.summary ? { summary: extraction.summary } : {}),
      ...(inferred.length ? { inferredJson: JSON.stringify(inferred) } : {}),
      ...(people.length ? { people: people.join(en ? ', ' : '、') } : {}),
      ...(calNode ? { calendarNodeId: calNode.id, calendarName: calNode.name } : {}),
      // source: 'voice' 落 LifeNodeSource 会跟随手一句语音记的东西混在一起 ——
      // 会议记录有专属 SignalSource('meeting_notes'),标出来才认得出是转写不是随口一句。
      signalSource: 'meeting_notes',
    },
    rawInput: notes,
    confidence: 1,
    source: 'voice',
    relations: calNode ? [{ targetId: calNode.id, relation: en ? 'calendar event' : '对应日程' }] : [],
  });

  // 反向可见:日历日程节点也记住会议记录(详情页从日程一侧就能跳到记录/待办)。
  if (calNode && record?.id) {
    updateLifeNode(calNode.id, {
      attributes: {
        ...calNode.attributes,
        meetingRecordId: record.id,
        ...(prov?.granolaMeetingId ? { granolaMeetingId: prov.granolaMeetingId } : {}),
      },
    });
  }

  // ② To do → 会议记录节点上的清单项(subtasksJson),不再各成一条今天页提醒。
  // 用户:行动项应出现在会议记录列表里,不该冒充独立提醒。
  const subtasks = (extraction?.todo ?? [])
    .map((t, i) => {
      const text = (t.text || '').trim();
      if (!text) return null;
      const deadline = typeof t.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline) ? t.deadline : null;
      return {
        id: `mtodo-${Date.now()}-${i}`,
        text: deadline ? `${text} · ${deadline}` : text,
        done: false,
      };
    })
    .filter((s): s is { id: string; text: string; done: boolean } => Boolean(s));
  if (record?.id && subtasks.length) {
    updateLifeNode(record.id, {
      attributes: {
        ...record.attributes,
        ...(calNode ? { calendarNodeId: calNode.id, calendarName: calNode.name } : {}),
        subtasksJson: JSON.stringify(subtasks),
        checklist: true,
      },
    });
  }
  broadcast();
  return calNode?.id ?? null;
}

function isDateOnlyIso(iso: string): boolean {
  const s = (iso || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(s);
}

function titleNorm(s: string): string {
  return (s || '').toLowerCase().replace(/[\s·:：\-—_,,。.]/g, '');
}

function titleMatches(meetingName: string, calendarName: string): boolean {
  const a = titleNorm(meetingName);
  const b = titleNorm(calendarName);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function sameMeetingDay(eventStartMs: number, recordedAt: string): boolean {
  const day = recordedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(eventStartMs);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return local === day || d.toISOString().slice(0, 10) === day;
}

function pickCalendar(cands: LifeNode[], meetingName: string): LifeNode | undefined {
  return cands.find((n) => titleMatches(meetingName, n.name)) || (cands.length === 1 ? cands[0] : undefined);
}

/** 会议 → 日历节点。有时刻走时间窗;Granola 只有日期时走同一天。 */
function findCalendarForMeeting(meetingName: string, recordedAt: string): LifeNode | undefined {
  const meetingT = new Date(recordedAt).getTime();
  const calendars = getLifeGraph().filter((n) => n.source === 'calendar');
  const windowed = Number.isFinite(meetingT) && !isDateOnlyIso(recordedAt)
    ? calendars.filter((n) => {
      const s = n.attributes?.start ? new Date(String(n.attributes.start)).getTime() : NaN;
      if (!Number.isFinite(s)) return false;
      const e = n.attributes?.end ? new Date(String(n.attributes.end)).getTime() : s + 60 * 60_000;
      return meetingT >= s - 30 * 60_000 && meetingT <= e + 60 * 60_000;
    })
    : [];
  const fromWindow = pickCalendar(windowed, meetingName);
  if (fromWindow) return fromWindow;
  if (!isDateOnlyIso(recordedAt)) return undefined;
  const sameDay = calendars.filter((n) => {
    const s = n.attributes?.start ? new Date(String(n.attributes.start)).getTime() : NaN;
    return Number.isFinite(s) && sameMeetingDay(s, recordedAt);
  });
  return pickCalendar(sameDay, meetingName);
}

/** 日历同步之后补挂:Granola 常先到、当时图里还没有过去的日程。 */
export function relinkMeetingNotesToCalendar(): number {
  const graph = getLifeGraph();
  let linked = 0;
  for (const n of graph) {
    if (!(n.tags || []).includes('meeting-notes')) continue;
    if (typeof n.attributes?.calendarNodeId === 'string' && n.attributes.calendarNodeId) continue;
    const meetingName = (n.name || '').replace(/^(会议记录|Meeting notes)\s*·\s*/, '').trim() || n.name;
    const recordedAt = typeof n.attributes?.recordedAt === 'string' ? n.attributes.recordedAt : n.createdAt;
    const cal = findCalendarForMeeting(meetingName, recordedAt);
    if (!cal) continue;
    const relations = [...(n.relations || [])];
    if (!relations.some((r) => r.targetId === cal.id)) {
      relations.push({ targetId: cal.id, relation: '对应日程' });
    }
    updateLifeNode(n.id, {
      attributes: { ...n.attributes, calendarNodeId: cal.id, calendarName: cal.name },
      relations,
    });
    updateLifeNode(cal.id, {
      attributes: {
        ...cal.attributes,
        meetingRecordId: n.id,
        ...(typeof n.attributes?.granolaMeetingId === 'string'
          ? { granolaMeetingId: n.attributes.granolaMeetingId }
          : {}),
      },
    });
    linked += 1;
  }
  if (linked) broadcast();
  return linked;
}

export function addMeetingNotes(
  meetingNodeId: string,
  meetingName: string,
  notes: string,
  locale: string = 'zh',
  extraction?: MeetingExtraction,
): void {
  writeMeetingExtraction(meetingNodeId, meetingName, notes, locale, extraction);
}

// 批次 155:Granola 会议落地函数 —— 原生连接器(下一步)拿到转写后调这只手。
// 去重(granolaMeetingId)→ 调批次154 抽取(To do/Inferred)→ 写入。抽取失败降级只存原文。
export interface GranolaMeetingInput {
  id: string;            // Granola meeting UUID(去重锚)
  title: string;
  transcript: string;
  startedAt?: string;    // ISO,会议真实时间
}

export async function ingestGranolaMeeting(
  meeting: GranolaMeetingInput,
  locale: string = 'zh',
): Promise<{ status: 'created' | 'skipped' | 'stored_raw'; linked: boolean }> {
  const id = (meeting.id || '').trim();
  const transcript = (meeting.transcript || '').trim();
  if (!id || !transcript) return { status: 'skipped', linked: false };

  // 去重:同一场会议已入库就跳过(重复同步不再造重节点)。
  if (getLifeGraph().some((n) => n.attributes?.granolaMeetingId === id)) return { status: 'skipped', linked: false };

  // 批次154 抽取:把转写喂 meeting-notes 路由拿 To do/Inferred。会议真实日期作截止日锚点。
  let extraction: MeetingExtraction | undefined;
  try {
    const res = await fetch('/api/portal/meeting-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, duration: '', calendarEvent: meeting.title, meetingDate: meeting.startedAt || '' }),
    });
    const data = await res.json() as { ok?: boolean; summary?: string; todo?: MeetingExtraction['todo']; inferred?: string[]; people?: string[] };
    if (res.ok && data.ok) {
      extraction = { summary: data.summary, todo: data.todo, inferred: data.inferred, people: data.people };
    }
  } catch { /* 抽取失败 → 降级只存原文,不丢会议 */ }

  const linkedCalId = writeMeetingExtraction('', meeting.title, transcript, locale, extraction, {
    granolaMeetingId: id,
    recordedAt: meeting.startedAt,
    extraTags: ['Granola'],
  });
  return { status: extraction ? 'created' : 'stored_raw', linked: Boolean(linkedCalId) };
}

/** 批次 50:记忆页长按「加入今日焦点」—— 钉进今天(明天自然过期)。
 *  操作类动作不冒充 `useful` 反馈(2026-07-27 信任缺口)。 */
export function pinNodeToTodayFocus(nodeId: string): boolean {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return false;
  updateLifeNode(nodeId, { attributes: { ...node.attributes, focusPinnedOn: localDayKey(), done: false } });
  broadcast();
  return true;
}

/**
 * @param attrs 额外属性。2026-07-31 加:首页设的提醒也要在**时间线**上留一条
 *   (用户原话「设好的提醒进入时间线」)—— 带上 dueDate/dueTime 它才排得进去,
 *   带上 reminderId 才能在撤销时把这条影子一起收走。
 *   提醒本身的真源仍是 schedule-reminders,这里只是它在记忆里的一条身影。
 */
export function addCommitmentNode(name: string, attrs: Record<string, string> = {}): FocusNode {
  const node = ingestLifeNode({ name, type: 'task', source: 'manual', confidence: 1, tags: [], attributes: attrs, relations: [] });
  // 操作类动作不冒充 useful(2026-07-27);真正的卡反馈仍走 emitFeedback。
  // 不再补发 broadcast:ingestLifeNode → saveAll 已派发 nesio-life-graph-updated,
  // 这里再发一次 = 整条 Today 重算管线跑两遍(QA 速记提交冻结的一半成本)。
  return { id: node.id, name: node.name, type: node.type, rawInput: node.rawInput, createdAt: node.createdAt, attributes: node.attributes };
}
