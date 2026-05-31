/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // Run before App Router — otherwise / 404s without app/page.tsx
      beforeFiles: [{ source: "/", destination: "/index.html" }],
    };
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
