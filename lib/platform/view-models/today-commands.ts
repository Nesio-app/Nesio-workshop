/**
 * Today 命令层 —— 架构审查 #9(读写分离)。
 * view-model 是纯查询侧;所有 Today 的写操作收敛到这里,统一走合法写入门
 * (ingestLifeNode / updateLifeNode —— 后者已由 node-fact-sink 接进事实库)。
 * 每个命令负责自己的 UI 失效广播(nesio-life-graph-updated)。
 */

import { ingestLifeNode } from '../../life-domain/ingest-node';
import { getLifeGraph, updateLifeNode, deleteLifeNode } from '../../portal/life-graph';
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

  // ⓪ 闭环(用户定):会议记录挂到对应的日历日程记忆上 —— Granola 的会议本来就
  // 来自日历,按「会议时间落在日程窗口内(前 30min 후 60min 宽容)+ 标题吻合;
  // 窗口内唯一候选则放宽标题」找日历节点,下面创建记录时带上双向可见的关联。
  const meetingT = new Date(recordedAt).getTime();
  const norm = (s: string) => (s || '').toLowerCase().replace(/[\s·:：\-—_,,。.]/g, '');
  const mName = norm(meetingName);
  const calCandidates = Number.isFinite(meetingT) ? getLifeGraph().filter((n) => {
    if (n.source !== 'calendar') return false;
    const s = n.attributes?.start ? new Date(String(n.attributes.start)).getTime() : NaN;
    if (!Number.isFinite(s)) return false;
    const e = n.attributes?.end ? new Date(String(n.attributes.end)).getTime() : s + 60 * 60_000;
    return meetingT >= s - 30 * 60_000 && meetingT <= e + 60 * 60_000;
  }) : [];
  const calNode = calCandidates.find((n) => {
    const cName = norm(n.name);
    return cName && mName && (cName.includes(mName) || mName.includes(cName));
  }) || (calCandidates.length === 1 ? calCandidates[0] : undefined);

  // ① 会议记录节点:留转写原文,并把总结/推断项/人名收进 attributes(详情页可读)。
  const record = ingestLifeNode({
    name: `${en ? 'Meeting notes' : '会议记录'} · ${meetingName}`,
    type: 'commitment',
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

  // ② To do(显式指派)→ 各成一条 commitment 节点,钉进今天页;承诺了截止日的带 date(走倒计时)。
  const today = localDayKey();
  for (const t of extraction?.todo ?? []) {
    const text = (t.text || '').trim();
    if (!text) continue;
    const deadline = typeof t.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline) ? t.deadline : null;
    ingestLifeNode({
      name: text,
      type: 'commitment',
      tags: [en ? 'Meeting to-do' : '会议待办', 'meeting-todo', ...extraTags],
      attributes: {
        fromMeeting: meetingName,
        meetingRecordId: record.id,
        focusPinnedOn: today, // 刚开完会,行动项直接进今天页注意力
        ...(prov?.granolaMeetingId ? { granolaMeetingId: prov.granolaMeetingId } : {}),
        ...(deadline ? { date: deadline } : {}),
      },
      rawInput: text,
      confidence: 1, // 显式指派 = 高置信,不进「待确认」
      source: 'voice',
      relations: record.id ? [{ targetId: record.id, relation: en ? 'from meeting' : '来自会议' }] : [],
    });
  }
  broadcast();
  return calNode?.id ?? null;
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
  const node = ingestLifeNode({ name, type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: attrs, relations: [] });
  // 操作类动作不冒充 useful(2026-07-27);真正的卡反馈仍走 emitFeedback。
  // 不再补发 broadcast:ingestLifeNode → saveAll 已派发 nesio-life-graph-updated,
  // 这里再发一次 = 整条 Today 重算管线跑两遍(QA 速记提交冻结的一半成本)。
  return { id: node.id, name: node.name, type: node.type, rawInput: node.rawInput, createdAt: node.createdAt, attributes: node.attributes };
}
