/**
 * Today 命令层 —— 架构审查 #9(读写分离)。
 * view-model 是纯查询侧;所有 Today 的写操作收敛到这里,统一走合法写入门
 * (ingestLifeNode / updateLifeNode —— 后者已由 node-fact-sink 接进事实库)。
 * 每个命令负责自己的 UI 失效广播(nesio-life-graph-updated)。
 */

import { ingestLifeNode } from '../../life-domain/ingest-node';
import { getLifeGraph, updateLifeNode, deleteLifeNode } from '../../portal/life-graph';
import type { SubTask, FocusNode } from './today-view-model';

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

export function addMeetingNotes(meetingNodeId: string, meetingName: string, notes: string, locale: string = 'zh'): void {
  const en = locale.toLowerCase().startsWith('en');
  ingestLifeNode({
    name: `${en ? 'Meeting notes' : '会议记录'} · ${meetingName}`,
    type: 'commitment',
    tags: [en ? 'Meeting notes' : '会议记录', 'meeting-notes'],
    attributes: {
      meetingNodeId,
      notes,
      recordedAt: new Date().toISOString(),
    },
    rawInput: notes,
    confidence: 1,
    source: 'voice',
    relations: [],
  });
  broadcast();
}

export function addCommitmentNode(name: string): FocusNode {
  const node = ingestLifeNode({ name, type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });
  broadcast();
  return { id: node.id, name: node.name, type: node.type, rawInput: node.rawInput, createdAt: node.createdAt, attributes: node.attributes };
}
