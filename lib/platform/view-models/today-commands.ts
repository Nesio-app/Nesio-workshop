/**
 * Today 命令层 —— 架构审查 #9(读写分离)。
 * view-model 是纯查询侧;所有 Today 的写操作收敛到这里,统一走合法写入门
 * (ingestLifeNode / updateLifeNode —— 后者已由 node-fact-sink 接进事实库)。
 * 每个命令负责自己的 UI 失效广播(nesio-life-graph-updated)。
 */

import { emitFeedback } from '../personalization/feedback-bus';
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

export function addMeetingNotes(
  meetingNodeId: string,
  meetingName: string,
  notes: string,
  locale: string = 'zh',
  extraction?: MeetingExtraction,
): void {
  const en = locale.toLowerCase().startsWith('en');
  const inferred = (extraction?.inferred ?? []).filter((s) => s.trim());
  const people = (extraction?.people ?? []).filter((s) => s.trim());

  // ① 会议记录节点:留转写原文,并把总结/推断项/人名收进 attributes(详情页可读)。
  const record = ingestLifeNode({
    name: `${en ? 'Meeting notes' : '会议记录'} · ${meetingName}`,
    type: 'commitment',
    tags: [en ? 'Meeting notes' : '会议记录', 'meeting-notes'],
    attributes: {
      meetingNodeId,
      notes,
      recordedAt: new Date().toISOString(),
      ...(extraction?.summary ? { summary: extraction.summary } : {}),
      ...(inferred.length ? { inferredJson: JSON.stringify(inferred) } : {}),
      ...(people.length ? { people: people.join(en ? ', ' : '、') } : {}),
    },
    rawInput: notes,
    confidence: 1,
    source: 'voice',
    relations: [],
  });

  // ② To do(显式指派)→ 各成一条 commitment 节点,钉进今天页;承诺了截止日的带 date(走倒计时)。
  const today = localDayKey();
  for (const t of extraction?.todo ?? []) {
    const text = (t.text || '').trim();
    if (!text) continue;
    const deadline = typeof t.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline) ? t.deadline : null;
    ingestLifeNode({
      name: text,
      type: 'commitment',
      tags: [en ? 'Meeting to-do' : '会议待办', 'meeting-todo'],
      attributes: {
        fromMeeting: meetingName,
        meetingRecordId: record.id,
        focusPinnedOn: today, // 刚开完会,行动项直接进今天页注意力
        ...(deadline ? { date: deadline } : {}),
      },
      rawInput: text,
      confidence: 1, // 显式指派 = 高置信,不进「待确认」
      source: 'voice',
      relations: record.id ? [{ targetId: record.id, relation: en ? 'from meeting' : '来自会议' }] : [],
    });
  }
  broadcast();
}

/** 批次 50:记忆页长按「加入今日焦点」—— 钉进今天(明天自然过期)。
 *  与 manual_add 同级的强正信号:用户亲手把一条记忆拉回今天的注意力,
 *  ranker/偏好据此学「这类记忆值得主动浮现」。 */
export function pinNodeToTodayFocus(nodeId: string): boolean {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return false;
  updateLifeNode(nodeId, { attributes: { ...node.attributes, focusPinnedOn: localDayKey(), done: false } });
  try { emitFeedback({ surface: 'memory', dimension: 'pin_to_focus', key: node.type, reaction: 'useful', at: new Date().toISOString() }); } catch { /* 反馈失败不拦动作 */ }
  broadcast();
  return true;
}

export function addCommitmentNode(name: string): FocusNode {
  const node = ingestLifeNode({ name, type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });
  // 批次 37:用户亲手把事放进焦点 = 最强的正信号 —— 进统一反馈总线,
  // ranker/偏好据此学「这类事对我重要」。
  try { emitFeedback({ surface: 'today', dimension: 'manual_add', key: 'commitment', reaction: 'useful', at: new Date().toISOString() }); } catch { /* 反馈失败不拦记录 */ }
  broadcast();
  return { id: node.id, name: node.name, type: node.type, rawInput: node.rawInput, createdAt: node.createdAt, attributes: node.attributes };
}
