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
