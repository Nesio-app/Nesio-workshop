/** @type {import('next').NextConfig} */
const isVercel = !!process.env.VERCEL;
const shouldExport = process.env.NODE_ENV === 'production' && !isVercel;

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
};

module.exports = nextConfig;
