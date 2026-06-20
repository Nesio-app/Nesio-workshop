import React from 'react';

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Zone tint: cool 秩序 · warm 觉察 · neutral 体现, or plain frost. */
  tone?: 'plain' | 'cool' | 'warm' | 'neutral';
  raised?: boolean;
  /** Adds hover lift + pointer cursor. */
  interactive?: boolean;
  padding?: string;
  radius?: string;
  children?: React.ReactNode;
}

/**
 * The core liquid-glass surface — frosted panel floating over the gradient.
 * @startingPoint section="Core" subtitle="Frosted glass container with zone tints" viewport="700x220"
 */
export function GlassCard(props: GlassCardProps): JSX.Element;
