import { getModuleOpenHref } from './module-routes.mjs';

/** Toolbox HTML apps are served from public/<tool>/index.html in Next dev/export. */
export function ensureToolboxTrailingSlash(path: string): string {
  return getModuleOpenHref(path, process.env.NEXT_PUBLIC_BASE_PATH || '');
}

export function withBase(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function configUrl(): string {
  return withBase('/portal-config.json');
}

/** Next.js API routes respect `basePath` in production. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return withBase(normalized);
}
