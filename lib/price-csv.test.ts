import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { detectDateOrder, parseDate, parsePriceCsv, splitCsvLine } from './price-csv'

describe('parseDate', () => {
  it('reads the formats sources write', () => {
    assert.equal(parseDate('2026-09-22'), '2026-09-22')
    assert.equal(parseDate('22-Sep-2026'), '2026-09-22')
    assert.equal(parseDate('22/09/2026', 'dayFirst'), '2026-09-22')
    assert.equal(parseDate('09/22/2026', 'monthFirst'), '2026-09-22')
    assert.equal(parseDate('not a date'), null)
  })

  it('reads a slashed date the way it is told to', () => {
    assert.equal(parseDate('05/09/2026', 'dayFirst'), '2026-09-05')
    assert.equal(parseDate('05/09/2026', 'monthFirst'), '2026-05-09')
  })
})

describe('detectDateOrder', () => {
  it('lets one unambiguous date settle the whole file', () => {
    assert.deepEqual(detectDateOrder(['9/5/2026', '9/22/2026']), { order: 'monthFirst', certain: true, conflict: false })
    assert.deepEqual(detectDateOrder(['5/9/2026', '22/9/2026']), { order: 'dayFirst', certain: true, conflict: false })
  })

  it('falls back to day first when nothing settles it', () => {
    const r = detectDateOrder(['5/9/2026', '6/9/2026'])
    assert.equal(r.order, 'dayFirst')
    assert.equal(r.certain, false)
  })

  it('reports a file that contradicts itself', () => {
    assert.equal(detectDateOrder(['22/09/2026', '09/22/2026']).conflict, true)
  })
})

describe('splitCsvLine', () => {
  it('keeps a quoted field whole, delimiters and all', () => {
    assert.deepEqual(splitCsvLine('1,9/22/2026,SQR,216,"1,023,085"', ','), ['1', '9/22/2026', 'SQR', '216', '1,023,085'])
    assert.deepEqual(splitCsvLine('a,"say ""hi""",b', ','), ['a', 'say "hi"', 'b'])
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

  it('reads a DSE export: its headings, its quoted thousands, its month-first dates', () => {
    const csv =
      '#,DATE,TRADING CODE,LTP*,HIGH,LOW,OPENP*,CLOSEP*,YCP,TRADE,VALUE (mn),VOLUME\n' +
      ',,,,,,,,,,,\n' +
      '1,9/22/2026,SQURPHARMA,216,216.5,215.5,216,216,215.8,"1,523",221.023,"1,023,085"\n' +
      '2,9/5/2026,SQURPHARMA,210,211,209,209.5,210.5,210,"1,000",100,"500,000"\n'
    const { rows, issues } = parsePriceCsv(csv)

    // The padding line is not an unreadable row.
    assert.equal(issues.filter((i) => i.startsWith('Line')).length, 0)
    assert.deepEqual(
      rows.map((r) => [r.symbol, r.date, r.close, r.high, r.low, r.open, r.volume]),
      [
        ['SQURPHARMA', '2026-09-05', 210.5, 211, 209, 209.5, 500000],
        ['SQURPHARMA', '2026-09-22', 216, 216.5, 215.5, 216, 1023085],
      ],
    )
    assert.ok(issues.some((i) => /month first/.test(i)))
  })

  it('refuses a file whose dates contradict each other', () => {
    const { rows, issues } = parsePriceCsv('Date,Close\n22/09/2026,100\n09/22/2026,101\n', 'AAA')
    assert.deepEqual(rows, [])
    assert.ok(issues[0].includes('cannot be told'))
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

describe('other sources', () => {
  it('reads a file whose close column is called Price, with abbreviated volumes', () => {
    // The shape investing.com and similar sites export.
    const csv =
      '"Date","Price","Open","High","Low","Vol.","Change %"\n' +
      '"Sep 22, 2026","216.00","216.00","216.50","215.50","1.02M","0.09%"\n' +
      '"Sep 21, 2026","215.80","216.40","217.50","215.60","153.9K","-0.05%"\n' +
      '"Sep 20, 2026","215.90","215.00","216.00","214.80","-","0.00%"\n'
    const { rows, columns, issues } = parsePriceCsv(csv, 'SQURPHARMA')

    assert.deepEqual(issues, [])
    assert.equal(columns['Price'], 'close')
    assert.equal(columns['Vol.'], 'volume')
    assert.deepEqual(
      rows.map((r) => [r.date, r.close, r.high, r.volume]),
      [
        ['2026-09-20', 215.9, 216, null],
        ['2026-09-21', 215.8, 217.5, 153_900],
        ['2026-09-22', 216, 216.5, 1_020_000],
      ],
    )
  })

  it('prefers a Close column over a Price column when a file has both', () => {
    const { columns } = parsePriceCsv('Date,Price,Close\n2026-09-22,1,2\n', 'AAA')
    assert.equal(columns['Close'], 'close')
    assert.equal(columns['Price'], undefined)
  })
})
