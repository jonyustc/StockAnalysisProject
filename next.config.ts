import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Broker statement uploads go through a server action, capped at 1 MB by
      // default. A statement is ~65 KB, but multi-page ones are larger; this
      // leaves room without inviting large uploads. The action enforces its
      // own 3 MB limit and checks the file is a real PDF.
      bodySizeLimit: '4mb',
    },
  },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or a fix to it
        // would not reach browsers that already have it.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
