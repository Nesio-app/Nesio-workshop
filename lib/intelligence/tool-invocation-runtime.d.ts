export const STAGE5_TOOL_INVOCATION_VERSION: 'stage5-tool-invocation-v0';

export type Stage5ExecutionMode = 'dry_run' | 'execute';

export type Stage5PolicyDecision = {
  allowed: boolean;
  mode: Stage5ExecutionMode;
  actionKey: string;
  provider?: string;
  sideEffectKind?: string;
  blockedReason?: string;
  configured?: boolean;
  missingEnv?: string[];
  missingRuntimeContext?: string[];
  ceoApproved?: boolean;
  executionEnabled?: boolean;
  wouldExecuteWithRuntimeEnabled?: boolean;
  rollbackActionKey?: string | null;
  delegated?: boolean;
};

export function listStage5ToolActions(): Array<Record<string, unknown>>;

export function evaluateStage5ToolInvocationPolicy(options?: {
  actionKey?: string;
  executionMode?: Stage5ExecutionMode | string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runtimeContext?: Record<string, unknown>;
}): Stage5PolicyDecision;

export function buildStage5ToolInvocationReport(options?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Record<string, any>;

export function createStage5AuditId(prefix?: string): string;

export function buildStage5InvocationEnvelope(options?: {
  actionKey?: string;
  executionMode?: Stage5ExecutionMode | string;
  status?: string;
  auditId?: string;
  policyDecision?: Stage5PolicyDecision;
  result?: unknown;
  error?: unknown;
  idempotencyKey?: string | null;
}): Record<string, any>;
