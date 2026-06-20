import React from 'react';

export interface FloatingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  /** Optional text — turns the circle into a pill. */
  label?: string;
  /** Filled blue instead of glass. */
  accent?: boolean;
  position?: 'br' | 'bl' | 'tr' | 'tl';
  size?: number;
}

/**
 * Single lightweight floating entry (FAB) — used for 笔记 and 智友.
 * @startingPoint section="Core" subtitle="Floating glass quick-entry button" viewport="700x180"
 */
export function FloatingButton(props: FloatingButtonProps): JSX.Element;
