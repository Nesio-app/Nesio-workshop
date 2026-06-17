export const LOCAL_STATIC_MODULE_PATHS = Object.freeze([
  '/secretary',
  '/fitness',
  '/storage',
  '/adhd-flow',
  '/inner-shelter',
  '/reading',
]);

const LOCAL_STATIC_MODULE_PATH_SET = new Set(LOCAL_STATIC_MODULE_PATHS);

export function isExternalUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function normalizeModulePath(url) {
  if (isExternalUrl(url)) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return path.replace(/\/+$/, '') || '/';
}

export function classifyModuleOrigin(url) {
  return isExternalUrl(url) ? 'external' : 'local';
}

export function isLocalStaticModulePath(path) {
  return LOCAL_STATIC_MODULE_PATH_SET.has(normalizeModulePath(path));
}

export function classifyModuleRouteKind(url) {
  if (isExternalUrl(url)) return 'external-link';
  return isLocalStaticModulePath(url) ? 'local-static-module' : 'local-shell-route';
}

export function getPublicIndexPath(url) {
  if (!isLocalStaticModulePath(url)) return null;
  return `${normalizeModulePath(url)}/index.html`;
}

export function getModuleOpenHref(url, basePath = '') {
  if (isExternalUrl(url)) return url;
  const normalized = url.startsWith('/') ? url : `/${url}`;
  const unbased = basePath && normalized.startsWith(`${basePath}/`)
    ? normalized.slice(basePath.length)
    : normalized;
  const staticIndexPath = getPublicIndexPath(unbased);
  return `${basePath}${staticIndexPath || unbased}`;
}

export function getModuleReturnHref(basePath = '') {
  return `${basePath || ''}/`;
}

export function getModuleRouteContract(url, basePath = '') {
  const origin = classifyModuleOrigin(url);
  const routeKind = classifyModuleRouteKind(url);
  const normalizedPath = normalizeModulePath(url);

  return {
    origin,
    routeKind,
    configuredUrl: url,
    normalizedPath,
    publicIndexPath: origin === 'local' ? getPublicIndexPath(url) : null,
    openHref: getModuleOpenHref(url, basePath),
    returnHref: getModuleReturnHref(basePath),
  };
}
