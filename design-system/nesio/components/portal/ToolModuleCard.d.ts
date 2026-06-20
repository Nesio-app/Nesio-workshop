import React from 'react';

export interface ToolModuleCardProps {
  /** Emoji, ReactNode, or a path to an .svg icon. */
  icon?: React.ReactNode;
  name?: string;
  nameEn?: string;
  tone?: 'cool' | 'warm' | 'neutral';
  /** Warm-coach badge: { status: 'go'|'gentle'|'calm'|'risk', label: string }. */
  status?: { status: 'go' | 'gentle' | 'calm' | 'risk'; label: string } | null;
  locked?: boolean;
  onOpen?: () => void;
  /** The live, glanceable content — what's expiring, next session, today's number. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * A tool shown on the home as a live content window (not just a name).
 * @startingPoint section="Portal" subtitle="Live tool module card" viewport="700x260"
 */
export function ToolModuleCard(props: ToolModuleCardProps): JSX.Element;
