const svgProps = {
  className: 'portal-tool-svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const TOOL_ICONS: Record<string, JSX.Element> = {
  plan: (
    <svg {...svgProps}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
      <path d="M8.5 12.2 10.8 14.5 15.8 9.5" />
    </svg>
  ),
  quiz: (
    <svg {...svgProps}>
      <rect x="7" y="3.5" width="10" height="17" rx="2" />
      <path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3.5" />
    </svg>
  ),
  inventory: (
    <svg {...svgProps}>
      <path d="M12 4.5 18.5 8v8L12 19.5 5.5 16V8z" />
      <path d="M12 4.5v15M5.5 8 12 11.5 18.5 8" />
    </svg>
  ),
  psychoanalysis: (
    <svg {...svgProps}>
      <path d="M9 7c-2.2 0-3.5 1.6-3.5 3.8.2 1.6 1.2 2.8 3.5 3.2M15 7c2.2 0 3.5 1.6 3.5 3.8-.2 1.6-1.2 2.8-3.5 3.2" />
      <path d="M10.5 6V5M13.5 6V5M10.5 19v-1M13.5 19v-1" />
    </svg>
  ),
  sanctuary: (
    <svg {...svgProps}>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  ),
  reading: (
    <svg {...svgProps}>
      <path d="M5.5 6.5c2-1.2 4.5-1.2 6.5 0 2-1.2 4.5-1.2 6.5 0v11c-2-1.2-4.5-1.2-6.5 0-2-1.2-4.5-1.2-6.5 0z" />
      <path d="M12 6.5v11" />
    </svg>
  ),
  fitness: (
    <svg {...svgProps}>
      <path d="M4.5 10.5v3M19.5 10.5v3" />
      <path d="M7 9.5v6M17 9.5v6" />
      <path d="M7 12h10" />
      <rect x="5.5" y="8" width="2.5" height="8" rx="1" fill="currentColor" stroke="none" />
      <rect x="16" y="8" width="2.5" height="8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  health: (
    <svg {...svgProps}>
      <path d="M12 20s-5.5-3.6-5.5-8.2C6.5 8.5 8.8 6.5 12 8c3.2-1.5 5.5.5 5.5 3.8C17.5 16.4 12 20 12 20z" />
      <path d="M8.5 11.5h7" />
    </svg>
  ),
  lifesim: (
    <svg {...svgProps}>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

interface ToolGridIconProps {
  toolId: string;
  fallback: string;
}

export default function ToolGridIcon({ toolId, fallback }: ToolGridIconProps) {
  const icon = TOOL_ICONS[toolId];
  if (icon) return icon;
  return (
    <span className="portal-tool-emoji portal-icon-blue" aria-hidden>
      {fallback}
    </span>
  );
}
