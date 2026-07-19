/**
 * Project — user-controlled named aggregation of LifeNodes.
 *
 * Project is the only unit in Memory that the user defines.
 * Everything else (Domain, type, time) is system-defined.
 * A Project is: name + emoji + a set of node IDs + lifecycle status.
 */

import type { LifeNode } from './life-graph';
import { reportStorageDropped } from './storage-health';

// 批次 178:加 'planned'(计划中)—— 项目聚合统计按 进行中/计划中/已完成 分。'archived' 保留兼容旧数据。
export type ProjectStatus = 'active' | 'planned' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  emoji: string;
  nodeIds: string[];
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
}

export interface ProjectInsights {
  nodeCount: number;
  commitmentCount: number;
  topTags: string[];
  lastActivity: string; // ISO
}

const STORAGE_KEY = 'nesio-projects-v1';

// ── CRUD ────────────────────────────────────────────────────────────────────

export function getProjects(): Project[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function persist(projects: Project[]): void {
  // Project 是唯一用户亲手定义的记忆单元;配额满丢了必须可见(红线),失败就别再发 updated 骗 UI。
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    reportStorageDropped();
    return;
  }
  window.dispatchEvent(new Event('nesio-projects-updated'));
}

export function createProject(name: string, emoji = '📁'): Project {
  const project: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    emoji,
    nodeIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  };
  persist([project, ...getProjects()]);
  return project;
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'emoji' | 'status'>>): void {
  const projects = getProjects().map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
  );
  persist(projects);
}

export function deleteProject(id: string): void {
  persist(getProjects().filter((p) => p.id !== id));
}

export function addNodeToProject(projectId: string, nodeId: string): void {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return;
  if (projects[idx].nodeIds.includes(nodeId)) return;
  projects[idx] = {
    ...projects[idx],
    nodeIds: [...projects[idx].nodeIds, nodeId],
    updatedAt: new Date().toISOString(),
  };
  persist(projects);
}

export function removeNodeFromProject(projectId: string, nodeId: string): void {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return;
  projects[idx] = {
    ...projects[idx],
    nodeIds: projects[idx].nodeIds.filter((id) => id !== nodeId),
    updatedAt: new Date().toISOString(),
  };
  persist(projects);
}

// ── Insights ────────────────────────────────────────────────────────────────

export function getProjectInsights(project: Project, allNodes: LifeNode[]): ProjectInsights {
  const nodes = allNodes.filter((n) => project.nodeIds.includes(n.id));
  const commitmentCount = nodes.filter((n) => n.type === 'commitment').length;

  const tagFreq = nodes
    .flatMap((n) => n.tags ?? [])
    .reduce<Record<string, number>>((acc, t) => { acc[t] = (acc[t] ?? 0) + 1; return acc; }, {});
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const lastActivity = nodes.length > 0
    ? nodes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].createdAt
    : project.updatedAt;

  return { nodeCount: nodes.length, commitmentCount, topTags, lastActivity };
}
