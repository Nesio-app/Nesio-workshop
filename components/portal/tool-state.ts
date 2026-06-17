import type { PortalTool } from '@/lib/portal/types';
import { t } from '@/lib/portal/i18n';
import type { PortalLocale } from '@/lib/portal/profile';

export type ToolEntryStatus = 'ready' | 'not_ready' | 'external' | 'unconnected' | 'contract_only' | 'gated';

export type ToolModeAvailabilityValue = 'available' | 'hidden' | 'not_ready' | 'gated';
export type ShellMode = 'personal' | 'demo' | 'market';

export type ToolModeAvailability = Partial<Record<ShellMode, ToolModeAvailabilityValue>>;

export interface ToolShellStateMetadata {
  entryStatus?: unknown;
  modeAvailability?: unknown;
  emptyStateKey?: unknown;
  approvalGateKeys?: unknown;
}

const KNOWN_STATUS: ReadonlySet<string> = new Set([
  'ready',
  'not_ready',
  'external',
  'unconnected',
  'contract_only',
  'gated',
]);

const KNOWN_MODE_AVAILABILITY: ReadonlySet<string> = new Set(['available', 'hidden', 'not_ready', 'gated']);

const KNOWN_MODE_KEYS: ReadonlySet<string> = new Set(['personal', 'demo', 'market']);

export interface ToolForShellState extends PortalTool {
  entryStatus?: unknown;
  modeAvailability?: unknown;
  emptyStateKey?: unknown;
  approvalGateKeys?: unknown;
}

export interface ToolStatusCounts {
  ready: number;
  not_ready: number;
  external: number;
  unconnected: number;
  contract_only: number;
  gated: number;
}

function normalizeToolStatus(raw: unknown): ToolEntryStatus | undefined {
  if (typeof raw !== 'string') return undefined;
  return KNOWN_STATUS.has(raw) ? (raw as ToolEntryStatus) : undefined;
}

function normalizeModeAvailability(raw: unknown): ToolModeAvailability {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const normalized: ToolModeAvailability = {};

  for (const key of Object.keys(input)) {
    if (!KNOWN_MODE_KEYS.has(key)) continue;
    const value = String(input[key]);
    if (!KNOWN_MODE_AVAILABILITY.has(value)) continue;
    normalized[key as ShellMode] = value as ToolModeAvailabilityValue;
  }

  return normalized;
}

function hasGatedApproval(tool: ToolForShellState): boolean {
  if (!tool.ready) return false;
  const approval = Array.isArray(tool.approvalGateKeys)
    ? tool.approvalGateKeys
    : [];

  if (approval.length > 0) return true;

  const approvalRequiredActions =
    (tool as { approvalRequiredActions?: unknown[] }).approvalRequiredActions;

  if (!Array.isArray(approvalRequiredActions)) return false;
  const required = approvalRequiredActions;
  return required.length > 0;
}

function emptyStateToStatus(raw: unknown): ToolEntryStatus | undefined {
  if (raw !== 'module_not_connected' && raw !== 'module_not_ready' && raw !== 'approval_required' && raw !== 'external_module') {
    return undefined;
  }
  if (raw === 'module_not_connected') return 'unconnected';
  if (raw === 'module_not_ready') return 'not_ready';
  if (raw === 'external_module') return 'external';
  return 'gated';
}

function inferFromModeAvailability(tool: ToolForShellState): ToolEntryStatus | undefined {
  const modeAvailability = normalizeModeAvailability(tool.modeAvailability);
  const values = Object.values(modeAvailability);

  if (values.includes('gated')) return 'gated';
  if (values.includes('not_ready') && values.every((value) => value === 'not_ready')) return 'not_ready';
  if (values.includes('not_ready') && !values.includes('available')) return 'not_ready';

  return undefined;
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function getToolEntryStatus(tool: ToolForShellState): ToolEntryStatus {
  const fromEntryStatus = normalizeToolStatus(tool.entryStatus);
  if (fromEntryStatus) return fromEntryStatus;

  const fromEmptyState = emptyStateToStatus(tool.emptyStateKey);
  if (fromEmptyState) return fromEmptyState;

  const gatedFromMode = inferFromModeAvailability(tool);
  if (gatedFromMode) return gatedFromMode;

  if (hasGatedApproval(tool)) return 'gated';

  if (!tool.ready) {
    return isExternalUrl(tool.url) ? 'external' : 'not_ready';
  }

  if (hasGatedApproval(tool)) return 'gated';
  if (isExternalUrl(tool.url)) return 'external';

  return 'ready';
}

export function getToolStatusLabel(tool: ToolForShellState, locale: PortalLocale = 'zh'): string {
  const status = getToolEntryStatus(tool);

  switch (status) {
    case 'ready':
      return t(locale, 'shellStatusReady');
    case 'external':
      return t(locale, 'shellStatusExternal');
    case 'not_ready':
      return t(locale, 'shellStatusNotReady');
    case 'gated':
      return t(locale, 'shellStatusGated');
    case 'unconnected':
      return t(locale, 'shellStatusUnconnected');
    case 'contract_only':
      return t(locale, 'shellStatusContractOnly');
    default:
      return t(locale, 'shellStatusNotReady');
  }
}

export function getToolStatusCounts(tools: ToolForShellState[]): ToolStatusCounts {
  const counts: ToolStatusCounts = {
    ready: 0,
    not_ready: 0,
    external: 0,
    unconnected: 0,
    contract_only: 0,
    gated: 0,
  };

  for (const tool of tools) {
    const status = getToolEntryStatus(tool);
    counts[status] += 1;
  }

  return counts;
}

export function formatStatusSummaryLine(tools: ToolForShellState[], locale: PortalLocale = 'zh'): string {
  const counts = getToolStatusCounts(tools);
  const segments: string[] = [];

  if (counts.ready) segments.push(`${t(locale, 'shellStatusSummaryReady')} ${counts.ready}`);
  if (counts.external) segments.push(`${t(locale, 'shellStatusSummaryExternal')} ${counts.external}`);
  if (counts.unconnected) segments.push(`${t(locale, 'shellStatusSummaryUnconnected')} ${counts.unconnected}`);
  if (counts.gated) segments.push(`${t(locale, 'shellStatusSummaryGated')} ${counts.gated}`);
  if (counts.contract_only)
    segments.push(`${t(locale, 'shellStatusSummaryContractOnly')} ${counts.contract_only}`);
  if (counts.not_ready) segments.push(`${t(locale, 'shellStatusSummaryNotReady')} ${counts.not_ready}`);

  return segments.join(' · ');
}
