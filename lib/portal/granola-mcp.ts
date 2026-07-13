/**
 * Granola MCP 客户端(批次 156)—— Nesio 服务端作为 Granola 远程 MCP 的客户端。
 *
 * Granola 暴露一个 Streamable HTTP 的远程 MCP(https://mcp.granola.ai/mcp),
 * 每用户 OAuth 2.0 拿 bearer token。这里用官方 @modelcontextprotocol/sdk 连上去,
 * 调 list_meetings + get_meeting_transcript,归一成 Nesio 能吃的会议对象。
 *
 * 仅服务端使用(SDK 依赖 Node)。OAuth 换 token 在 granola/connect|callback 路由,
 * 这里只消费已拿到的 bearer token。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const GRANOLA_MCP_URL = 'https://mcp.granola.ai/mcp';

export type GranolaTimeRange = 'this_week' | 'last_week' | 'last_30_days';

export interface GranolaMeetingMeta {
  id: string;
  title: string;
  date?: string; // ISO
}

export interface GranolaMeetingFull extends GranolaMeetingMeta {
  transcript: string;
}

// ── 结果解析(list_meetings 返回 XML 式文本,不是 JSON)────────────────────────
// 实测形状:<meetings_data ...><meeting id="UUID" title="…" date="Jul 13, 2026 10:00 AM EDT">…</meeting>…

type ToolContent = { type?: string; text?: string };
type ToolResult = { content?: ToolContent[]; isError?: boolean };

function textOf(result: ToolResult): string {
  return (result.content || [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isoOf(human: string): string | undefined {
  if (!human) return undefined;
  const d = new Date(human);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseMeetingList(xml: string): GranolaMeetingMeta[] {
  const out: GranolaMeetingMeta[] = [];
  // 属性顺序固定为 id → title → date(见实测),但用宽松匹配防其顺序/空白变化。
  const re = /<meeting\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    const title = decodeEntities(/\btitle="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const date = isoOf(/\bdate="([^"]*)"/.exec(attrs)?.[1] ?? '');
    out.push({ id, title, date });
  }
  return out;
}

// ── MCP 会话 ──────────────────────────────────────────────────────────────────

async function withClient<T>(bearer: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), {
    // sync 路径已握有 token —— 直接把 Bearer 塞进请求头,不走完整 OAuthClientProvider。
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client({ name: 'nesio-granola', version: '1.0.0' }, {});
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => { /* 关闭失败无妨 */ });
  }
}

/**
 * 拉一批会议(列表 + 逐个转写)。skipIds 跳过已入库的会议;maxTranscripts 限流
 * (Granola 约 100 req/min,单场会议 = 1 次 transcript 调用)。
 */
export async function fetchGranolaMeetings(bearer: string, opts?: {
  timeRange?: GranolaTimeRange;
  maxTranscripts?: number;
  skipIds?: Set<string>;
}): Promise<GranolaMeetingFull[]> {
  const timeRange = opts?.timeRange ?? 'last_30_days';
  const maxTranscripts = Math.max(1, Math.min(opts?.maxTranscripts ?? 10, 20));
  const skipIds = opts?.skipIds ?? new Set<string>();

  return withClient(bearer, async (client) => {
    const listRes = await client.callTool({ name: 'list_meetings', arguments: { time_range: timeRange } }) as ToolResult;
    const metas = parseMeetingList(textOf(listRes));
    const fresh = metas.filter((m) => !skipIds.has(m.id)).slice(0, maxTranscripts);

    const out: GranolaMeetingFull[] = [];
    for (const meta of fresh) {
      try {
        const tRes = await client.callTool({ name: 'get_meeting_transcript', arguments: { meeting_id: meta.id } }) as ToolResult;
        const transcript = textOf(tRes).trim();
        if (transcript) out.push({ ...meta, transcript });
      } catch {
        // 单场会议取转写失败 → 跳过它,继续其余(不整批失败)。
      }
    }
    return out;
  });
}

/** 只拉列表(不取转写),供 UI 让用户勾选要同步哪些会议。 */
export async function listGranolaMeetings(bearer: string, timeRange: GranolaTimeRange = 'last_30_days'): Promise<GranolaMeetingMeta[]> {
  return withClient(bearer, async (client) => {
    const listRes = await client.callTool({ name: 'list_meetings', arguments: { time_range: timeRange } }) as ToolResult;
    return parseMeetingList(textOf(listRes));
  });
}
