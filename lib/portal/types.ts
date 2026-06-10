export type ZoneId = 'kinetic' | 'reflective' | 'manifest';

export interface PortalZone {
  title: string;
  subtitle: string;
  tone: 'cool' | 'warm' | 'neutral';
}

export interface PortalTool {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  url: string;
  zone: ZoneId;
  hotkey: string;
  command: string;
  featured?: boolean;
  icon: string;
  ready?: boolean;
}

export interface PortalConfig {
  meta: {
    title: string;
    subtitle: string;
    energyQuotes: string[];
  };
  zones: Record<ZoneId, PortalZone>;
  tools: PortalTool[];
}
