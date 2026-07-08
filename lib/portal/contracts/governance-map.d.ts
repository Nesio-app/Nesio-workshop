export type GovStatus = 'enforced' | 'report-only' | 'dormant' | 'drifted' | 'dead';
export type GovTone = 'go' | 'gentle' | 'risk';

export interface GovStatusMeta { label: string; tone: GovTone; desc: string }
export interface GovGroupMeta { title: string; blurb: string }
export interface GovSurface {
  id: string;
  title: string;
  group: string;
  status: GovStatus;
  path: string;
  route?: string;
  reportKey?: string;
  governs: string;
  consumedBy: string;
  note?: string;
}

export const GOV_STATUS_META: Record<GovStatus, GovStatusMeta>;
export const GOV_GROUP_META: Record<string, GovGroupMeta>;
export const GOVERNANCE_MAP: GovSurface[];
export function summarizeGovernance(
  map?: GovSurface[],
): { total: number; byStatus: Record<string, number>; byGroup: Record<string, number> };
