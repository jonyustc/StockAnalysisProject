import type { Metadata } from 'next'
import Link from 'next/link'

import { logout } from './login/actions'
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
            <nav className="flex gap-4 text-xs text-neutral-500">
              <Link href="/" className="hover:text-neutral-300">
                Screener
              </Link>
              <Link href="/portfolio" className="hover:text-neutral-300">
                Portfolio
              </Link>
            </nav>
            <form action={logout} className="ml-auto">
              <button
                type="submit"
                className="text-xs text-neutral-600 hover:text-neutral-400"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
