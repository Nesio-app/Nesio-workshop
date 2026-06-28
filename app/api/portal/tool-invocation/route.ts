import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

import * as stage5ToolInvocation from '@/lib/intelligence/tool-invocation-runtime.mjs';

type ToolInvocationBody = {
  actionKey?: string;
  executionMode?: 'dry_run' | 'execute';
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

type CalendarEventPayload = {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  timeZone?: string;
};

type Stage5PolicyDecision = Record<string, any>;
const buildStage5InvocationEnvelope = stage5ToolInvocation.buildStage5InvocationEnvelope as (options: Record<string, any>) => Record<string, any>;
const createStage5AuditId = stage5ToolInvocation.createStage5AuditId as () => string;
const evaluateStage5ToolInvocationPolicy = stage5ToolInvocation.evaluateStage5ToolInvocationPolicy as (options: Record<string, any>) => Stage5PolicyDecision;

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function googleCalendarAccessToken(): string {
  return cookies().get('nesio_google_calendar_access')?.value || '';
}

function hasInvocationSecret(request: Request): boolean {
  const expected = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = request.headers.get('x-nesio-stage5-secret')?.trim() || '';
  return Boolean(expected && provided && provided === expected);
}

function sanitizeCalendarPayload(raw: Record<string, unknown> | undefined) {
  const payload = (raw || {}) as CalendarEventPayload;
  const summary = String(payload.summary || '').trim();
  const start = String(payload.start || '').trim();
  const end = String(payload.end || '').trim();
  if (!summary || !start || !end) {
    return {
      ok: false as const,
      error: 'calendar_event_requires_summary_start_end',
    };
  }
  return {
    ok: true as const,
    event: {
      summary,
      description: String(payload.description || '').trim(),
      location: String(payload.location || '').trim(),
      start: {
        dateTime: start,
        timeZone: String(payload.timeZone || 'America/New_York').trim(),
      },
      end: {
        dateTime: end,
        timeZone: String(payload.timeZone || 'America/New_York').trim(),
      },
    },
  };
}

async function executeCalendarEventCreate(payload: Record<string, unknown> | undefined, accessToken: string) {
  const sanitized = sanitizeCalendarPayload(payload);
  if (!sanitized.ok) {
    return { ok: false, status: 400, error: sanitized.error };
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(sanitized.event),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error?.message || `google_calendar_create_failed:${response.status}`,
    };
  }
  return {
    ok: true,
    status: 200,
    result: {
      provider: 'google_calendar',
      eventId: data?.id || null,
      htmlLink: data?.htmlLink || null,
      rollback: data?.id
        ? {
            actionKey: 'calendar.event.delete',
            endpoint: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${data.id}`,
            automatic: false,
          }
        : null,
    },
  };
}

async function executeNotificationWebhook(payload: Record<string, unknown> | undefined, auditId: string) {
  const webhookUrl = envValue('NESIO_NOTIFICATION_WEBHOOK_URL') || envValue('FLOMO_WEBHOOK_URL');
  const bearer = envValue('NESIO_NOTIFICATION_WEBHOOK_BEARER');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      auditId,
      source: 'nesio_stage5_tool_invocation',
      payload: payload || {},
      sentAt: new Date().toISOString(),
    }),
    cache: 'no-store',
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `notification_webhook_failed:${response.status}`,
      responsePreview: text.slice(0, 200),
    };
  }
  return {
    ok: true,
    status: 200,
    result: {
      provider: 'notification_webhook',
      responsePreview: text.slice(0, 200),
    },
  };
}

export async function POST(request: Request) {
  const auditId = createStage5AuditId();
  const body = (await request.json().catch(() => ({}))) as ToolInvocationBody;
  const actionKey = String(body.actionKey || '').trim();
  const executionMode = body.executionMode === 'execute' ? 'execute' : 'dry_run';
  const accessToken = googleCalendarAccessToken();
  const policyDecision = evaluateStage5ToolInvocationPolicy({
    actionKey,
    executionMode,
    env: process.env,
    runtimeContext: {
      hasInvocationSecret: hasInvocationSecret(request),
      hasGoogleCalendarAccessToken: Boolean(accessToken),
    },
  });

  if (!policyDecision.allowed) {
    const envelope = buildStage5InvocationEnvelope({
      actionKey,
      executionMode,
      status: 'blocked',
      auditId,
      policyDecision,
      error: policyDecision.blockedReason,
      idempotencyKey: body.idempotencyKey || null,
    });
    return NextResponse.json(envelope, { status: policyDecision.blockedReason === 'unknown_action' ? 404 : 403 });
  }

  if (executionMode === 'dry_run') {
    const envelope = buildStage5InvocationEnvelope({
      actionKey,
      executionMode,
      status: 'dry_run',
      auditId,
      policyDecision,
      result: {
        wouldExecute: policyDecision.wouldExecuteWithRuntimeEnabled,
        delegatedEndpoint: policyDecision.delegated ? policyDecision.provider : null,
      },
      idempotencyKey: body.idempotencyKey || null,
    });
    return NextResponse.json(envelope, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }

  let executionResult:
    | Awaited<ReturnType<typeof executeCalendarEventCreate>>
    | Awaited<ReturnType<typeof executeNotificationWebhook>>;
  if (actionKey === 'calendar.event.create') {
    executionResult = await executeCalendarEventCreate(body.payload, accessToken);
  } else if (actionKey === 'notification.webhook.send') {
    executionResult = await executeNotificationWebhook(body.payload, auditId);
  } else {
    const envelope = buildStage5InvocationEnvelope({
      actionKey,
      executionMode,
      status: 'blocked',
      auditId,
      policyDecision,
      error: 'delegated_action_must_use_declared_endpoint',
      idempotencyKey: body.idempotencyKey || null,
    });
    return NextResponse.json(envelope, { status: 409 });
  }

  const envelope = buildStage5InvocationEnvelope({
    actionKey,
    executionMode,
    status: executionResult.ok ? 'executed' : 'failed',
    auditId,
    policyDecision,
    result: executionResult.ok ? executionResult.result : null,
    error: executionResult.ok ? null : executionResult.error,
    idempotencyKey: body.idempotencyKey || null,
  });
  return NextResponse.json(envelope, {
    status: executionResult.status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
