/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint is run separately (`npm run lint`); don't let style nits block builds.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
