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
  // 端上模型/wasm 是纯客户端静态资源(从 public/ 直接下发),绝不该被打进 serverless
  // 函数包。next.config.js→dec-data-api.mjs 里的动态 fs 操作会让 NFT 过度追踪、把整个
  // public/(含 ~395MB 模型)扫进某个 API 函数 → 超 250MB 部署上限而失败。这里显式把
  // 大静态资源排除出所有函数的文件追踪(纯静态服务不受影响)。
  outputFileTracingExcludes: {
    '*': ['public/lab/models/**', 'public/ort/**', 'public/exercise-anim/**'],
  },
  // 允许局域网设备(如手机真机自测 Lab)访问 dev server 的客户端资源。
  // Next 16 默认只放行同源访问 /_next/*:跨 host(手机开 http://<Mac 局域网IP>:port)
  // 会拿到 403 → 页面出了 SSR 但客户端 JS 加载失败、不 hydrate(表现:能看见界面但
  // 点按无反应、日志空白)。仅 dev 生效,不影响生产/导出构建。
  // 用法:真机自测时 `NESIO_DEV_LAN_ORIGIN=192.168.1.201 npm run dev`(填 Mac 局域网 IP)。
  ...(process.env.NESIO_DEV_LAN_ORIGIN
    ? { allowedDevOrigins: process.env.NESIO_DEV_LAN_ORIGIN.split(',').map((s) => s.trim()) }
    : {}),
  ...(shouldExport ? { output: 'export' } : {}),
  basePath: process.env.BASE_PATH || '',
  assetPrefix: process.env.BASE_PATH ? `${process.env.BASE_PATH}/` : '',
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || '',
    // 批次202:把构建 commit 内联进客户端 bundle。版本自检拿它和线上 /api/version 比,
    // 检测「这个 surface 在跑旧缓存代码」→ 强刷更新(旧逻辑只能发现「用着用着上线了新版」,
    // 发现不了「冷启动时加载的就是旧缓存」——各端版本不一的真因)。
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',
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
