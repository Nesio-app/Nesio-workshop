import Image from 'next/image';
import { getNesioToolIcon } from '@/lib/portal/nesio-design-system-assets.mjs';

interface ToolGridIconProps {
  toolId: string;
  fallback: string;
}

export default function ToolGridIcon({ toolId, fallback }: ToolGridIconProps) {
  const iconSrc = getNesioToolIcon(toolId);
  if (iconSrc) {
    return (
      <Image
        className="portal-tool-svg portal-tool-img"
        src={iconSrc}
        alt=""
        width={28}
        height={28}
        aria-hidden
      />
    );
  }

  return (
    <span className="portal-tool-emoji portal-icon-blue" aria-hidden>
      {fallback}
    </span>
  );
}
