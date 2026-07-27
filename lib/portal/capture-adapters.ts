/**
 * capture-adapters — 按内容类型分流的入库适配器契约。
 * 相机/文件/语音最终应走 register → adapter.ingest,而不是各 Sheet 各写一套。
 * 本文件先立接口 + 内置注册表;具体实现仍可委托现有 CameraSheet / intake 路径。
 */

export type CaptureContentType =
  | 'receipt'
  | 'food'
  | 'document'
  | 'scene'
  | 'person'
  | 'inventory'
  | 'booking-confirm'
  | 'dish-photo'
  | 'unknown';

export interface CaptureInput {
  contentType: CaptureContentType;
  /** 原始文件或 data URL(可选) */
  sourceHint?: string;
  /** 已结构化的候选节点(视觉模型输出) */
  candidates?: Array<{
    name: string;
    type?: string;
    price?: string | number;
    attributes?: Record<string, unknown>;
  }>;
  meta?: {
    tripId?: string;
    placeId?: string;
    takenAt?: string;
    lat?: number;
    lon?: number;
  };
}

export interface CaptureResult {
  ok: boolean;
  contentType: CaptureContentType;
  /** 写入的实体 id 列表 */
  entityIds: string[];
  /** 若产生支出 */
  expenseId?: string;
  message?: string;
}

export interface CaptureAdapter {
  type: CaptureContentType;
  /** 是否认领该输入 */
  match: (input: CaptureInput) => boolean;
  /** 入库;默认实现可 no-op 返回骨架结果 */
  ingest: (input: CaptureInput) => Promise<CaptureResult> | CaptureResult;
}

const registry: CaptureAdapter[] = [];

export function registerCaptureAdapter(adapter: CaptureAdapter): void {
  const i = registry.findIndex((a) => a.type === adapter.type);
  if (i >= 0) registry[i] = adapter;
  else registry.push(adapter);
}

export function listCaptureAdapters(): CaptureAdapter[] {
  return [...registry];
}

export function resolveCaptureAdapter(input: CaptureInput): CaptureAdapter | null {
  const typed = registry.find((a) => a.type === input.contentType && a.match(input));
  if (typed) return typed;
  return registry.find((a) => a.match(input)) || null;
}

export async function ingestCapture(input: CaptureInput): Promise<CaptureResult> {
  const adapter = resolveCaptureAdapter(input);
  if (!adapter) {
    return {
      ok: false,
      contentType: input.contentType,
      entityIds: [],
      message: 'no_adapter',
    };
  }
  return adapter.ingest(input);
}

function stub(type: CaptureContentType): CaptureAdapter {
  return {
    type,
    match: (input) => input.contentType === type,
    ingest: (input) => ({
      ok: true,
      contentType: type,
      entityIds: [],
      message: `stub:${type}:${(input.candidates || []).length}`,
    }),
  };
}

/** 启动时注册骨架适配器(可被真实实现覆盖)。 */
export function ensureDefaultCaptureAdapters(): void {
  if (registry.length) return;
  for (const t of [
    'receipt',
    'food',
    'document',
    'scene',
    'person',
    'inventory',
    'booking-confirm',
    'dish-photo',
    'unknown',
  ] as CaptureContentType[]) {
    registerCaptureAdapter(stub(t));
  }
}

ensureDefaultCaptureAdapters();
