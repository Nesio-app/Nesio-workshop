/** @type {import('next').NextConfig} */
const isVercel = !!process.env.VERCEL;
const shouldExport = process.env.NEXT_OUTPUT_MODE === 'export' && !isVercel;

// Security headers. CSP allows self + inline (Next.js requires inline styles;
// existing components use inline style attrs) + the external APIs the client
// talks to directly. Tighten script-src to nonces later if inline scripts go.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.bigdatacloud.net https://api.weather.gov",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  ...(shouldExport ? { output: 'export' } : {}),
  basePath: process.env.BASE_PATH || '',
  assetPrefix: process.env.BASE_PATH ? `${process.env.BASE_PATH}/` : '',
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || '',
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'oaidalleapiprodscus.blob.core.windows.net', pathname: '/**' },
    ],
  },
  ...(shouldExport
    ? {}
    : {
        async headers() {
          return [{ source: '/(.*)', headers: securityHeaders }];
        },
      }),
};

module.exports = nextConfig;
