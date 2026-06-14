/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for the Cloud Run container image.
  output: "standalone",
  // Vercel fallback: bundle the materialized snapshot + fixtures into each
  // serverless function. lib/data.ts / lib/ens.ts read these via fs at runtime,
  // so Next's tracer can't infer them automatically. (Ignored by Cloud Run,
  // where the Dockerfile copies data/ + shared/ explicitly.)
  experimental: {
    outputFileTracingIncludes: {
      "/": ["./data/**", "./shared/**"],
      "/agent/[id]": ["./data/**", "./shared/**"],
      "/api/agents": ["./data/**", "./shared/**"],
      "/api/agents/[id]": ["./data/**", "./shared/**"],
      "/api/stats": ["./data/**", "./shared/**"],
    },
  },
  // p5 is loaded dynamically on the client; keep it out of the server bundle.
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
};

export default nextConfig;
