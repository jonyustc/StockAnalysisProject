import type { Metadata } from 'next'
import Link from 'next/link'

import './globals.css'

export const metadata: Metadata = {
  title: 'DSE Research',
  description: 'Personal fundamental research database for Dhaka Stock Exchange companies',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">
        <header className="border-b border-neutral-800">
          <div className="mx-auto flex max-w-6xl items-baseline gap-6 px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-wide text-neutral-100">
              DSE RESEARCH
            </Link>
            <span className="text-xs text-neutral-500">
              Fundamentals entered from primary sources
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
