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
  status?: 'ready' | 'gated' | 'report-only' | 'not_ready';
  integrationMode?: 'local' | 'external' | 'static-report-only' | 'contract-only';
  owner?: string;
  maintainer?: string;
  responsibleAgent?: string;
  evidenceOwner?: string;
  gateOwner?: string;
  decMeta?: PortalDecMetadata;
}

export interface PortalDecMetadata {
  moduleId: string;
  mode: string;
  dependencyCount?: number;
  ownedDataCount?: number;
  emittedEventsCount?: number;
  approvalActionCount?: number;
  dependencyDataKeys?: string[];
}

export interface PortalProfile {
  displayName: string;
  avatarUrl?: string;
}

export interface PortalLocation {
  city: string;
  state?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  /** When true, skip browser geolocation and pin to config coords. */
  useConfigCity?: boolean;
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
  source?: string;
}
