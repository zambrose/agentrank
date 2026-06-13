/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // p5 is loaded dynamically on the client; keep it out of the server bundle.
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
};

export default nextConfig;
