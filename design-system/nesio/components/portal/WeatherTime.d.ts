import React from 'react';

export interface WeatherTimeProps {
  time?: string;
  date?: string;
  temp?: string;
  condition?: string;
  place?: string;
  align?: 'right' | 'left';
  style?: React.CSSProperties;
}

/**
 * Top-right clock + date + weather glance for the home.
 * @startingPoint section="Portal" subtitle="Clock & weather cluster" viewport="700x160"
 */
export function WeatherTime(props: WeatherTimeProps): JSX.Element;
