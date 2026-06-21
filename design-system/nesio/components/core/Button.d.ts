import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filled = primary action. secondary/soft/ghost step down in weight. */
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  /** `risk` only for genuine safety / expiry actions. */
  tone?: 'brand' | 'risk';
  pill?: boolean;
  full?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Calm, tactile button for Nesio. Presses with a soft scale, never shouts.
 * @startingPoint section="Core" subtitle="Primary / secondary / soft / ghost" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
