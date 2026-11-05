import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Styles arrive with the HTML: one less round trip before the menu
    // paints, which saves about two seconds on slow 3G. Tailwind's CSS is
    // small, and the menu page (with its styles) is cached on the phone.
    inlineCss: true,
    // A stand-alone 404 for unknown URLs. Without it, the root not-found
    // boundary (and its site stylesheet) would ship inside every menu page.
    globalNotFound: true,
  },
  // Fonts read from disk when building QR code PDFs.
  outputFileTracingIncludes: {
    "/api/print/[restaurantId]": ["./src/fonts/print/**"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
