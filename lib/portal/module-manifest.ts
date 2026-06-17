import { buildPortalModule, buildPortalModuleRegistry } from './module-manager';
import type { PortalConfig, PortalTool, PortalZone, ZoneId } from './types';
import type { ModuleOrigin } from './module-routes';
import type { PortalModule } from './module-manager';

export type PortalToolOrigin = ModuleOrigin;

export type PortalShellTool = PortalModule;

export interface PortalShellZone extends PortalZone {
  id: ZoneId;
  tools: PortalShellTool[];
}

export interface PortalShellManifest {
  shellName: string;
  shellHref: string;
  toolCount: number;
  readyToolCount: number;
  localToolCount: number;
  externalToolCount: number;
  zones: PortalShellZone[];
  tools: PortalShellTool[];
}

export function classifyToolOrigin(url: string): PortalToolOrigin {
  return url.startsWith('http://') || url.startsWith('https://') ? 'external' : 'local';
}

export function getModuleOpenHref(tool: PortalTool): string {
  return buildPortalModule(tool).openHref;
}

export function buildPortalShellManifest(config: PortalConfig): PortalShellManifest {
  const registry = buildPortalModuleRegistry(config);
  const tools = registry.modules;

  const zones: PortalShellZone[] = (Object.entries(config.zones) as [ZoneId, PortalZone][]).map(
    ([id, zone]) => ({
      ...zone,
      id,
      tools: tools.filter((tool) => tool.zone === id),
    }),
  );

  return {
    shellName: registry.shellName,
    shellHref: registry.shellHref,
    toolCount: registry.moduleCount,
    readyToolCount: registry.readyModuleCount,
    localToolCount: registry.localModuleCount,
    externalToolCount: registry.externalModuleCount,
    zones,
    tools,
  };
}
