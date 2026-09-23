import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseDate, parsePriceCsv } from './price-csv'

describe('parseDate', () => {
  it('reads the formats sources write', () => {
    assert.equal(parseDate('2026-09-22').date, '2026-09-22')
    assert.equal(parseDate('22-Sep-2026').date, '2026-09-22')
    assert.equal(parseDate('22/09/2026').date, '2026-09-22')
    // Day first is impossible here, so it must be month first.
    assert.equal(parseDate('09/22/2026').date, '2026-09-22')
    assert.equal(parseDate('not a date').date, null)
  })

  it('says when day-first was an assumption', () => {
    assert.equal(parseDate('05/09/2026').assumedDayFirst, true)
    assert.equal(parseDate('22/09/2026').assumedDayFirst, false)
  })
})

describe('parsePriceCsv', () => {
  it('reads a plain file', () => {
    const { rows, columns, issues } = parsePriceCsv('Date,Close\n2026-09-21,100.5\n2026-09-22,101\n', 'AAA')
    assert.deepEqual(issues, [])
    assert.deepEqual(columns, { Date: 'date', Close: 'close' })
    assert.deepEqual(rows.map((r) => [r.symbol, r.date, r.close]), [
      ['AAA', '2026-09-21', 100.5],
      ['AAA', '2026-09-22', 101],
    ])
  })

  it('matches columns by meaning, not by exact heading', () => {
    const csv = 'TRADING CODE\tTRADE DATE\tOPENP*\tHIGH\tLOW\tCLOSEP*\tVOLUME\nAAA\t22-Sep-2026\t99\t102\t98\t101\t1,234\n'
    const { rows, issues } = parsePriceCsv(csv)
    assert.deepEqual(issues, [])
    assert.deepEqual(
      [rows[0].symbol, rows[0].date, rows[0].open, rows[0].high, rows[0].low, rows[0].close, rows[0].volume],
      ['AAA', '2026-09-22', 99, 102, 98, 101, 1234],
    )
  })

  it('reports lines it cannot read instead of guessing', () => {
    const { rows, issues } = parsePriceCsv('Date,Close\n2026-09-21,100\nrubbish\n2026-09-22,-5\n', 'AAA')
    assert.equal(rows.length, 1)
    assert.equal(issues.filter((i) => i.startsWith('Line')).length, 2)
  })

  it('keeps the last line for a repeated day, and sorts by date', () => {
    const { rows } = parsePriceCsv('Date,Close\n2026-09-22,101\n2026-09-21,100\n2026-09-22,105\n', 'AAA')
    assert.deepEqual(rows.map((r) => [r.date, r.close]), [
      ['2026-09-21', 100],
      ['2026-09-22', 105],
    ])
  })

  it('refuses a file with no date or price column', () => {
    const { rows, issues } = parsePriceCsv('Name,Value\nAAA,10\n')
    assert.deepEqual(rows, [])
    assert.deepEqual(issues, ['No date column found.', 'No closing price column found.'])
  })

  it('asks for a symbol when the file has none', () => {
    const { issues } = parsePriceCsv('Date,Close\n2026-09-22,101\n')
    assert.ok(issues.some((i) => /no stock symbol/.test(i)))
  })
})
