/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://api:8000/api/v1/:path*",
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js dev requires 'unsafe-eval'; remove in prod if using a standalone build
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              // Clerk session/token calls require external connectivity.
              "connect-src 'self' https://api.clerk.com https://*.clerk.accounts.dev https://*.accounts.dev",
              // Clerk widgets/challenges may render in iframes depending on flow.
              "frame-src 'self' https://*.clerk.accounts.dev https://*.accounts.dev https://challenges.cloudflare.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
