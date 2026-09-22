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
}

export default nextConfig
