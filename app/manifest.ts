import type { MetadataRoute } from 'next'

/**
 * Makes the app installable — to a phone's home screen or as a desktop app.
 * On iPhone and iPad that is required for system alerts; elsewhere it is
 * optional.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DSE Research',
    short_name: 'DSE Research',
    description: 'Personal DSE stock research and portfolio tracking.',
    start_url: '/portfolio',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
