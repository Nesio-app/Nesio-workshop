/**
 * app/api/portal/diagnostics/route.ts
 *
 * 接收客户端上报的 IDB 诊断信息。
 * 用于监控存储健康状态、冲突检测、性能指标等。
 *
 * 调用者必须符合 guardAiRoute 的安全检查（CLAUDE.md 设计规则）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { isPortalRequestAuthorized } from '@/lib/portal/api-auth';
import { requireAdmin } from '@/lib/portal/auth/admin-gate';

interface DiagnosticEvent {
  timestamp: number;
  severity: 'info' | 'warning' | 'error';
  type: string;
  message: string;
  details?: Record<string, any>;
}

interface DiagnosticsPayload {
  events: DiagnosticEvent[];
  clientTime: string;
}

/**
 * POST /api/portal/diagnostics
 *
 * 接收并记录客户端的诊断事件。
 *
 * 请求体：
 * {
 *   events: [{ timestamp, severity, type, message, details }],
 *   clientTime: "2026-07-29T12:00:00Z"
 * }
 *
 * 响应：
 * { ok: true, recorded: number }
 */
export async function POST(request: NextRequest) {
  // 轻量会话检查（记录诊断事件）
  const authorized = await isPortalRequestAuthorized(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload: DiagnosticsPayload = await request.json();

    if (!Array.isArray(payload.events)) {
      return NextResponse.json(
        { error: 'events must be an array' },
        { status: 400 }
      );
    }

    // 验证事件格式
    const validEvents = payload.events.filter((event) => {
      return (
        typeof event.timestamp === 'number' &&
        ['info', 'warning', 'error'].includes(event.severity) &&
        typeof event.type === 'string' &&
        typeof event.message === 'string'
      );
    });

    // 记录诊断事件
    for (const event of validEvents) {
      const level = event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warn' : 'info';
      console[level as 'error' | 'warn' | 'info'](
        `[Diagnostics] ${event.type}: ${event.message}`,
        event.details || {}
      );

      // 这里可以添加持久化存储、告警等逻辑
      // 例如：
      // - 存储到数据库
      // - 发送告警通知
      // - 更新监控仪表板
      // - 触发自动回滚等

      // 示例：如果是错误级别，记录到日志系统
      if (event.severity === 'error' && process.env.SENTRY_DSN) {
        // 可在这里集成 Sentry 等错误追踪
        console.error(`[Sentry] Critical diagnostic event: ${event.type}`);
      }
    }

    return NextResponse.json({
      ok: true,
      recorded: validEvents.length,
      clientTime: payload.clientTime,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Diagnostics API] Error processing diagnostics:', error);

    // 不要泄露内部错误给客户端
    return NextResponse.json(
      { error: 'Failed to process diagnostics' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/portal/diagnostics
 *
 * 查询诊断统计信息（仅管理员）。
 *
 * 查询参数：
 * - ?type=xxx （过滤事件类型）
 * - ?severity=error （过滤严重性）
 * - ?hours=24 （查询最近 N 小时）
 */
export async function GET(request: NextRequest) {
  // 需要管理员权限查询诊断统计
  const adminCheck = requireAdmin(request, 'read-diagnostics');
  if (adminCheck) {
    return adminCheck;
  }

  // 这里通常会从数据库查询统计信息
  // 示例响应：
  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    stats: {
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      topEventTypes: [],
    },
  });
}
