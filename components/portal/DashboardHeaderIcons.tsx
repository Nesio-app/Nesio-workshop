const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function DashboardNoteIcon({ className = 'portal-dash-icon' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        {...stroke}
        d="M7.5 4.5h9a2 2 0 0 1 2 2v13l-3.5-2-3.5 2-3.5-2-3.5 2V6.5a2 2 0 0 1 2-2z"
      />
      <path {...stroke} d="M9.5 9h5M9.5 12h5M9.5 15h3.5" />
    </svg>
  );
}

export function DashboardTreasureIcon({ className = 'portal-quote-treasure-icon-svg' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...stroke} d="M5 9.5 12 5l7 4.5V18.5L12 22l-7-3.5V9.5z" />
      <path {...stroke} d="M5 9.5 12 13.5 19 9.5M12 13.5V22" />
      <path {...stroke} d="M9.5 11h5" />
    </svg>
  );
}
