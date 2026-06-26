/**
 * Life Graph — local-first storage for LifeNodes.
 * Nodes are stored in localStorage under a single key.
 * This is the foundation for Reasoning Engine and Today Feed.
 */

export type LifeNodeType =
  | 'person'
  | 'object'
  | 'place'
  | 'event'
  | 'commitment'
  | 'health_state'
  | 'preference';

export type LifeNodeSource = 'manual' | 'photo' | 'calendar' | 'email' | 'system' | 'voice';

export interface LifeNode {
  id: string;
  type: LifeNodeType;
  name: string;
  attributes: Record<string, string | number | boolean | null>;
  source: LifeNodeSource;
  confidence: number; // 0-1
  createdAt: string; // ISO
  lastConfirmedAt?: string;
  relations: Array<{ targetId: string; relation: string }>;
  tags?: string[];
  rawInput?: string;
}

const STORAGE_KEY = 'nesio-life-graph-v1';

function loadAll(): LifeNode[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LifeNode[];
  } catch {
    return [];
  }
}

function saveAll(nodes: LifeNode[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  } catch {
    /* storage full or unavailable */
  }
}

export function getLifeGraph(): LifeNode[] {
  return loadAll();
}

export function addLifeNode(node: Omit<LifeNode, 'id' | 'createdAt'>): LifeNode {
  const nodes = loadAll();
  const newNode: LifeNode = {
    ...node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  nodes.unshift(newNode);
  saveAll(nodes);
  return newNode;
}

export function updateLifeNode(id: string, patch: Partial<LifeNode>): boolean {
  const nodes = loadAll();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return false;
  nodes[idx] = { ...nodes[idx], ...patch };
  saveAll(nodes);
  return true;
}

export function deleteLifeNode(id: string): boolean {
  const nodes = loadAll();
  const filtered = nodes.filter((n) => n.id !== id);
  if (filtered.length === nodes.length) return false;
  saveAll(filtered);
  return true;
}

export function searchLifeGraph(query: string): LifeNode[] {
  const q = query.toLowerCase().trim();
  if (!q) return loadAll();
  return loadAll().filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      Object.values(n.attributes).some((v) => String(v).toLowerCase().includes(q)) ||
      n.tags?.some((t) => t.toLowerCase().includes(q)),
  );
}

export function getRecentNodes(limit = 8): LifeNode[] {
  return loadAll()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** Parse natural language into a LifeNode — rule-based, no LLM required for MVP */
export function parseManualCapture(text: string): Omit<LifeNode, 'id' | 'createdAt'> {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Person names: "记住 Linda 的娃娃..."
  const personMatch = t.match(/(\S+)\s*的/);
  const personName = personMatch?.[1] || '';

  // Object
  const objectMatch = t.match(/记住\s+(.+?)(?:在|放|存|位于|$)/);
  const locationMatch = t.match(/(?:在|放在|存在|位于)\s*(.+?)(?:里|中|$)/);

  const name = objectMatch?.[1]?.trim() || t.slice(0, 20);
  const location = locationMatch?.[1]?.trim() || '';

  const node: Omit<LifeNode, 'id' | 'createdAt'> = {
    type: location ? 'object' : personName ? 'person' : 'object',
    name,
    attributes: {},
    source: 'voice',
    confidence: 0.8,
    relations: [],
    rawInput: t,
    tags: [],
  };

  if (location) node.attributes['location'] = location;
  if (personName) {
    node.relations.push({ targetId: personName, relation: 'owned_by' });
    node.attributes['owner'] = personName;
  }

  // Commitment detection
  if (lower.includes('提醒') || lower.includes('别忘') || lower.includes('记得')) {
    node.type = 'commitment';
  }

  return node;
}
