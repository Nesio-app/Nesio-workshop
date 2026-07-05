/** @type {import('next').NextConfig} */
const isVercel = !!process.env.VERCEL;
const shouldExport = process.env.NEXT_OUTPUT_MODE === 'export' && !isVercel;

// Security headers. CSP allows self + inline (Next.js requires inline styles;
// existing components use inline style attrs) + the external APIs the client
// talks to directly. Tighten script-src to nonces later if inline scripts go.
const securityHeaders = [
  // 批次 22:X-Frame-Options: DENY 会连带挡掉 Plaid Link 的授权 iframe。
  // CSP 的 frame-ancestors 已防点击劫持(更细粒度),这里放开 iframe 承载。
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 批次 22:Plaid Link 从 cdn.plaid.com 加载脚本(此前被静默拦截 →
      // 「点击没反应」);Link 弹窗是它域名下的 iframe → frame-src。
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.plaid.com",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      // Plaid Link SDK 与其后端通信;开发/沙盒/生产三档域名都放行
      "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.bigdatacloud.net https://api.weather.gov https://cdn.plaid.com https://production.plaid.com https://sandbox.plaid.com https://development.plaid.com",
      "frame-src 'self' https://cdn.plaid.com https://plaid.com",
      "worker-src 'self' blob:",
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
