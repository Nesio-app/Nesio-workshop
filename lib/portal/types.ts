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
  iconUrl?: string;
  ready?: boolean;
}

export interface PortalProfile {
  displayName: string;
  avatarUrl?: string;
}

export interface PortalLocation {
  city: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface PortalConfig {
  meta: {
    title: string;
    subtitle: string;
    energyQuotes: string[];
    warmReminders?: string[];
  };
  profile?: PortalProfile;
  location?: PortalLocation;
  zones: Record<ZoneId, PortalZone>;
  tools: PortalTool[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  calendarName?: string;
}
