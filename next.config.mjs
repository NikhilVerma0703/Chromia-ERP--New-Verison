import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STANDALONE: Pacific ERP's next.config.mjs, cut to what this app uses. Kept:
// the security headers, strict mode, no X-Powered-By, the image optimizer off
// (nothing uses next/image), and the 10 MB server-action body limit that Slab
// Intake's defect photos ride in on. Dropped: the PWA asset cache headers, the
// pdf/puppeteer externals and the Vercel file-tracing includes, which belong
// to modules that did not come across. HSTS is left out because this app is
// served over plain http on localhost, where browsers ignore it anyway.

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Slab Intake's defect photos ride along in server-action form posts.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
