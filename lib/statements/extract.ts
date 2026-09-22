/**
 * PDF bytes to positioned text items.
 *
 * unpdf is pdf.js packaged for serverless runtimes, so this runs the same on
 * Vercel as locally — unlike pdftotext, which needs a binary that does not
 * exist there.
 */

import { getDocumentProxy } from 'unpdf'

import type { TextItem } from './types'

/** Statements are a page or two. Anything larger is not what it claims to be. */
export const MAX_PAGES = 20

export async function extractTextItems(bytes: Uint8Array): Promise<TextItem[]> {
  const pdf = await getDocumentProxy(bytes)

  if (pdf.numPages > MAX_PAGES) {
    throw new Error(`PDF has ${pdf.numPages} pages; a portfolio statement should have a few.`)
  }

  const items: TextItem[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()

    for (const item of content.items) {
      // Marked-content entries carry no text.
      if (!('str' in item) || item.str.trim() === '') continue
      items.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        page: pageNumber,
      })
    }
  }

  return items
}

/** A statement with no text layer is a scan, and this parser cannot read it. */
export function looksScanned(items: TextItem[]): boolean {
  return items.length < 20
}
