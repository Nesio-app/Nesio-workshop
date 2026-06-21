import React from 'react';

export interface StatusBadgeProps {
  /** go = on track · gentle = soft nudge (amber) · calm = info · risk = real expiry/safety only. */
  status?: 'go' | 'gentle' | 'calm' | 'risk';
  dot?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Warm-coach status pill — soft tones; red reserved for genuine risk.
 * @startingPoint section="Core" subtitle="go / gentle / calm / risk" viewport="700x120"
 */
export function StatusBadge(props: StatusBadgeProps): JSX.Element;
