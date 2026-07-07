/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep already-visited pages in the client router cache briefly so going
    // back to a recent page is instant (no server round-trip). Every page also
    // has realtime subscriptions + a data-change bus that refresh on mount, so
    // the short staleness is invisible in practice.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
