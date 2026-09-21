/**
 * Checking imported figures against the annual report.
 *
 * Everything in the database arrived from a secondary source and is marked
 * unverified. Verification is the step that makes a figure yours: you open the
 * report, read the number, type it, and the app decides what that means.
 *
 * The outcomes are deliberately distinct. "I checked and it matches" and "I
 * have not checked this one" are different states, and collapsing them would
 * let an unchecked figure drift into looking confirmed.
 */

import { parseReportedNumber } from './units'

export type VerifyOutcome =
  /** Left blank — not checked. The stored figure is untouched. */
  | 'skipped'
  /** The report agrees with what was stored. Marked verified. */
  | 'confirmed'
  /** The report disagrees. The report wins; the old value is kept as history. */
  | 'corrected'
  /** Nothing was stored for this line. The typed figure is added, verified. */
  | 'added'
  /** Typed something that is not a number. Nothing is written. */
  | 'error'

export interface RowVerdict {
  tag: string
  outcome: VerifyOutcome
  /** Parsed figure from the report, in the period's scale. */
  typed: number | null
  /** What was stored beforehand, in the same scale. */
  stored: number | null
  message?: string
}

/**
 * Two decimal figures that came from the same printed number should compare
 * equal, but one has been through a numeric column and back. This absorbs that
 * float noise and nothing else: a relative epsilon this small cannot hide a
 * genuine difference in a reported figure.
 */
const EPSILON = 1e-9

function sameNumber(a: number, b: number): boolean {
  if (a === b) return true
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) / scale < EPSILON
}

export function verifyRow(tag: string, storedRaw: string | null, typedRaw: string): RowVerdict {
  const stored = storedRaw === null ? null : Number(storedRaw)
  const trimmed = typedRaw.trim()

  // Blank means "not checked", never "the report says nothing". Someone
  // working through 19 lines will leave most of them empty on any given pass.
  if (trimmed === '') {
    return { tag, outcome: 'skipped', typed: null, stored }
  }

  const typed = parseReportedNumber(trimmed)

  if (typed === null) {
    return {
      tag,
      outcome: 'error',
      typed: null,
      stored,
      message: `"${trimmed}" is not a number`,
    }
  }

  if (stored === null) {
    return { tag, outcome: 'added', typed, stored: null }
  }

  if (sameNumber(stored, typed)) {
    return { tag, outcome: 'confirmed', typed, stored }
  }

  return {
    tag,
    outcome: 'corrected',
    typed,
    stored,
    message: `report says ${typed}, stored was ${stored}`,
  }
}

export interface VerifySummary {
  confirmed: number
  corrected: number
  added: number
  skipped: number
  errors: number
}

export function summarise(verdicts: RowVerdict[]): VerifySummary {
  const summary: VerifySummary = {
    confirmed: 0,
    corrected: 0,
    added: 0,
    skipped: 0,
    errors: 0,
  }

  for (const verdict of verdicts) {
    if (verdict.outcome === 'confirmed') summary.confirmed += 1
    else if (verdict.outcome === 'corrected') summary.corrected += 1
    else if (verdict.outcome === 'added') summary.added += 1
    else if (verdict.outcome === 'skipped') summary.skipped += 1
    else summary.errors += 1
  }

  return summary
}

/** A sentence for the person who just pressed save. */
export function describeSummary(summary: VerifySummary): string {
  const parts: string[] = []

  if (summary.confirmed > 0) parts.push(`${summary.confirmed} confirmed`)
  if (summary.corrected > 0) parts.push(`${summary.corrected} corrected`)
  if (summary.added > 0) parts.push(`${summary.added} added`)

  if (parts.length === 0) return 'Nothing checked — every field was left blank.'

  const tail = summary.skipped > 0 ? `, ${summary.skipped} left unchecked` : ''
  return `${parts.join(', ')}${tail}.`
}
