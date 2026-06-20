import React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> {
  label?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  style?: React.CSSProperties;
}

/**
 * Quiet glass text field; set `multiline` for a textarea.
 * @startingPoint section="Core" subtitle="Text field & textarea" viewport="700x160"
 */
export function Input(props: InputProps): JSX.Element;
