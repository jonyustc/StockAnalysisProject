/**
 * Reading a table out of whatever was pasted or downloaded.
 *
 * A page's HTML, a copy out of a browser, a spreadsheet's tab-separated
 * clipboard, a CSV — all of them are rows of cells once the markup is gone.
 * Turning them into the same shape here means the column matching, the date
 * reading and the checks downstream do not care where a table came from.
 */

import { cleanCell, splitCsvLine } from './price-csv'

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
}

/** The text of one cell: tags stripped, entities resolved, spaces collapsed. */
export function cellText(html: string): string {
  return cleanCell(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
      .replace(/\s+/g, ' '),
  )
}

/** Every HTML table in some markup, as rows of cell text. */
export function htmlTables(html: string): string[][][] {
  return (html.match(/<table[\s\S]*?<\/table>/gi) ?? []).map((table) =>
    (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText),
    ),
  )
}

/**
 * Rows from a paste, whatever form it took: HTML, or lines of text separated
 * by tabs, commas or semicolons.
 *
 * A fragment copied out of a page often has no <table> around it, so rows of
 * <tr> on their own are read too.
 */
export function pastedTable(text: string): string[][] {
  const trimmed = text.trim()

  if (/<t[dr]\b/i.test(trimmed)) {
    const tables = htmlTables(trimmed)
    const biggest = tables.sort((a, b) => b.length - a.length)[0]
    if (biggest && biggest.length > 0) return biggest.filter((row) => row.length > 0)

    // <tr> rows without a <table> around them.
    const rows = (trimmed.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText),
    )
    return rows.filter((row) => row.length > 0)
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []

  const delimiter = ['\t', ',', ';'].map((d) => [d, lines[0].split(d).length] as const).sort((a, b) => b[1] - a[1])[0]
  return lines.map((line) => splitCsvLine(line, delimiter[1] > 1 ? delimiter[0] : '\t').map(cleanCell))
}
