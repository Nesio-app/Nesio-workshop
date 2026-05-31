/** Absolute URL for static assets (uploads) when API is on a different host than the UI. */
export function publicAssetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : path;
}
