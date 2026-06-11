const TOOLBOX_APP_PATHS = new Set([
  '/fitness',
  '/storage',
  '/adhd-flow',
  '/inner-shelter',
]);

/** Toolbox HTML apps use relative assets; URL must end with / or CSS/JS 404. */
export function ensureToolboxTrailingSlash(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const full = `${base}${normalized}`;
  const bare = full.replace(/\/+$/, '') || '/';
  if (TOOLBOX_APP_PATHS.has(bare)) return `${bare}/`;
  return full;
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
