export type ModuleOrigin = 'local' | 'external';
export type ModuleRouteKind = 'local-static-module' | 'local-shell-route' | 'external-link';

export interface ModuleRouteContract {
  origin: ModuleOrigin;
  routeKind: ModuleRouteKind;
  configuredUrl: string;
  normalizedPath: string;
  publicIndexPath: string | null;
  openHref: string;
  returnHref: string;
}

export const LOCAL_STATIC_MODULE_PATHS: readonly string[];
export function isExternalUrl(url: string): boolean;
export function normalizeModulePath(url: string): string;
export function classifyModuleOrigin(url: string): ModuleOrigin;
export function isLocalStaticModulePath(path: string): boolean;
export function classifyModuleRouteKind(url: string): ModuleRouteKind;
export function getPublicIndexPath(url: string): string | null;
export function getModuleOpenHref(url: string, basePath?: string): string;
export function getModuleReturnHref(basePath?: string): string;
export function getModuleRouteContract(url: string, basePath?: string): ModuleRouteContract;
