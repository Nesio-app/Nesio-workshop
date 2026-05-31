/**
 * Composio integration — Gmail (纪念日提醒) + Notion (追思留言同步)
 * Requires: COMPOSIO_API_KEY, connected account IDs in .env
 * Docs: https://docs.composio.dev
 */

const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

type ComposioResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function composioFetch<T>(
  path: string,
  init?: RequestInit
): Promise<ComposioResult<T>> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    return { ok: false, error: "COMPOSIO_API_KEY not configured" };
  }
  try {
    const res = await fetch(`${COMPOSIO_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        ...(init?.headers as Record<string, string>),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: (body as { message?: string }).message || res.statusText,
      };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Composio request failed" };
  }
}

export async function sendGmailReminder(params: {
  to: string;
  memorialName: string;
  eventLabel: string;
  eventDate: string;
  memorialUrl: string;
}): Promise<ComposioResult<unknown>> {
  const accountId = process.env.COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID;
  if (!accountId) {
    return { ok: false, error: "COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID not set" };
  }

  const from = process.env.MEMORIAL_EMAIL_FROM || "念归处 <noreply@localhost>";
  const subject = `有一个日子，家人或许会想再来看看 — ${params.memorialName}`;
  const body = `${params.eventDate}，是${params.memorialName}的${params.eventLabel}。

若您方便，纪念馆的门一直开着：
${params.memorialUrl}

不必回复这封邮件。`;

  return composioFetch("/tools/execute/GMAIL_SEND_EMAIL", {
    method: "POST",
    body: JSON.stringify({
      connected_account_id: accountId,
      arguments: {
        recipient_email: params.to,
        subject,
        body,
        is_html: false,
        extra_recipients: [],
      },
    }),
  });
}

export async function syncFragmentToNotion(params: {
  memorialName: string;
  slug: string;
  author: string;
  relation?: string | null;
  year?: string | null;
  content: string;
  status: string;
}): Promise<ComposioResult<unknown>> {
  const accountId = process.env.COMPOSIO_NOTION_CONNECTED_ACCOUNT_ID;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!accountId || !databaseId) {
    return {
      ok: false,
      error: "COMPOSIO_NOTION_CONNECTED_ACCOUNT_ID or NOTION_DATABASE_ID not set",
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return composioFetch("/tools/execute/NOTION_CREATE_DATABASE_ITEM", {
    method: "POST",
    body: JSON.stringify({
      connected_account_id: accountId,
      arguments: {
        database_id: databaseId,
        properties: [
          {
            name: "纪念馆",
            type: "title",
            value: `${params.memorialName} (${params.slug})`,
          },
          {
            name: "留言者",
            type: "rich_text",
            value: params.author,
          },
          {
            name: "关系",
            type: "rich_text",
            value: params.relation || "",
          },
          {
            name: "年份",
            type: "rich_text",
            value: params.year || "",
          },
          {
            name: "内容",
            type: "rich_text",
            value: params.content.slice(0, 2000),
          },
          {
            name: "状态",
            type: "rich_text",
            value: params.status,
          },
          {
            name: "链接",
            type: "url",
            value: `${appUrl}/index.html#profile-${params.slug}`,
          },
        ],
      },
    }),
  });
}

export function composioConfigured() {
  return {
    gmail: Boolean(
      process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID
    ),
    notion: Boolean(
      process.env.COMPOSIO_API_KEY &&
        process.env.COMPOSIO_NOTION_CONNECTED_ACCOUNT_ID &&
        process.env.NOTION_DATABASE_ID
    ),
  };
}
