import React from 'react';

export interface QuoteCardProps {
  quote?: string;
  label?: string;
  saved?: boolean;
  onSave?: () => void;
  style?: React.CSSProperties;
}

/**
 * 今日话语 — quiet serif quote for the bottom of the home, with a save heart.
 * @startingPoint section="Portal" subtitle="Daily quote card" viewport="700x180"
 */
export function QuoteCard(props: QuoteCardProps): JSX.Element;
