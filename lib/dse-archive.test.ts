import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { cellText, dseArchiveUrl, parseDseArchive } from './dse-archive'
import { fetchDseHistory, windowsFor } from './dse-fetch'
import { parsePriceCsv } from './price-csv'

/*
 * A stand-in archive page: the ticker tables DSE puts above the data, then
 * the day-end table itself, with its real headings and markup shape. Every
 * figure is invented.
 */
function archivePage(rows: string[][], { withTicker = true } = {}): string {
  const ticker = withTicker
    ? `<table class="table"><tr><td>AAA&nbsp;12.30&nbsp;0.10&nbsp;&nbsp;0.81%</td></tr></table>
       <table class="table"><tr><td>BBB&nbsp;4.50&nbsp;-0.10&nbsp;-2.17%</td></tr></table>`
    : ''

  const body = rows
    .map(
      (cells, i) => `<tr>
        <td width="4%">${i + 1}</td>
        <td width="10%">${cells[0]}</td>
        <td width="15%" style="text-align: left;">
          <a href="displayCompany.php?name=${cells[1]}" class='ab1'> ${cells[1]} </a>
        </td>
        <td width="10%">${cells[2]}</td><td width="12%">${cells[3]}</td><td width="11%">${cells[4]}</td>
        <td width="12%">${cells[5]}</td><td width="12%">${cells[6]}</td><td width="11%">${cells[7]}</td>
        <td width="11%">${cells[8]}</td><td width="11%">${cells[9]}</td><td width="11%">${cells[10]}</td>
      </tr>`,
    )
    .join('')

  return `<html><body>${ticker}
    <table class='table table-bordered background-white shares-table fixedHeader'>
      <thead><tr>
        <th width="4%">#</th><th width="12%">DATE</th><th width="12%">TRADING CODE</th>
        <th width="12%">LTP*</th><th width="12%">HIGH</th><th width="12%">LOW</th>
        <th width="12%">OPENP*</th><th width="12%">CLOSEP*</th><th width="12%">YCP</th>
        <th width="12%">TRADE</th><th width="12%">VALUE (mn)</th><th width="12%">VOLUME</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <table class="table"><tr><td>LTP* - Last Traded Price</td><td>YCP = Yesterday's Closing Price</td></tr></table>
  </body></html>`
}

const SAMPLE = [
  ['2026-09-22', 'AAAPHARMA', '216', '216.5', '215.5', '216', '216.3', '215.8', '1,523', '221.023', '1,023,085'],
  ['2026-09-21', 'AAAPHARMA', '215.8', '217.5', '215.6', '216.4', '215.9', '215.9', '1,314', '33.233', '153,905'],
]

describe('dseArchiveUrl', () => {
  it('builds the archive address', () => {
    assert.equal(
      dseArchiveUrl({ symbol: 'SQURPHARMA', from: '2021-09-23', to: '2026-09-23' }),
      'https://www.dsebd.org/day_end_archive.php?startDate=2021-09-23&endDate=2026-09-23&inst=SQURPHARMA&archive=data',
    )
  })
})

describe('cellText', () => {
  it('strips tags and resolves the entities DSE uses', () => {
    assert.equal(cellText('<a href="x" class="ab1"> SQURPHARMA </a>'), 'SQURPHARMA')
    assert.equal(cellText('AAA&nbsp;12.30&nbsp;&amp;&nbsp;more'), 'AAA 12.30 & more')
  })
})

describe('parseDseArchive', () => {
  it('finds the day-end table among the ticker tables, and reads the closing price', () => {
    const { rows, columns, issues } = parseDseArchive(archivePage(SAMPLE))
    assert.deepEqual(issues, [])
    // CLOSEP*, not LTP*: the closing price is what the daily feed stores.
    assert.deepEqual(
      rows.map((r) => [r.symbol, r.date, r.close, r.open, r.high, r.low, r.volume]),
      [
        ['AAAPHARMA', '2026-09-21', 215.9, 216.4, 217.5, 215.6, 153905],
        ['AAAPHARMA', '2026-09-22', 216.3, 216, 216.5, 215.5, 1023085],
      ],
    )
    assert.equal(columns['CLOSEP*'], 'close')
  })

  it('says so when the page has no day-end table', () => {
    const { rows, issues } = parseDseArchive('<html><body><p>No data found</p></body></html>')
    assert.deepEqual(rows, [])
    assert.match(issues[0], /No day-end table/)
  })
})

describe('windowsFor', () => {
  it('splits a long range into windows the archive will answer in full', () => {
    const windows = windowsFor('2021-09-23', '2026-09-23')
    assert.ok(windows.length >= 6)
    assert.equal(windows[0].from, '2021-09-23')
    assert.equal(windows[windows.length - 1].to, '2026-09-23')
    // Forwards, without gaps or overlaps.
    for (let i = 1; i < windows.length; i += 1) {
      const previous = Date.parse(windows[i - 1].to)
      assert.equal(Date.parse(windows[i].from) - previous, 86_400_000)
    }
  })

  it('leaves a short range in one piece, and refuses a backwards one', () => {
    assert.deepEqual(windowsFor('2026-09-01', '2026-09-23'), [{ from: '2026-09-01', to: '2026-09-23' }])
    assert.deepEqual(windowsFor('2026-09-23', '2026-09-01'), [])
  })
})

describe('fetchDseHistory', () => {
  const page = archivePage(SAMPLE)

  it('stitches the windows together without repeating a day', async () => {
    const asked: string[] = []
    const result = await fetchDseHistory({
      symbol: 'AAAPHARMA',
      from: '2024-09-23',
      to: '2026-09-23',
      pauseMs: 0,
      fetchPage: async (url) => {
        asked.push(url)
        return { ok: true, status: 200, text: page }
      },
    })

    assert.ok(asked.length >= 2, 'a two-year range needs more than one window')
    // Every window returned the same two days; they are merged, not repeated.
    assert.equal(result.rows.length, 2)
    assert.deepEqual(result.issues, [])
    assert.ok(asked.every((url) => url.includes('inst=AAAPHARMA')))
  })

  it('tries a dropped request again rather than reporting a hole', async () => {
    let call = 0
    const result = await fetchDseHistory({
      symbol: 'AAAPHARMA',
      from: '2024-09-23',
      to: '2026-09-23',
      pauseMs: 0,
      fetchPage: async () => {
        call += 1
        // Every other request fails, as DSE does under a run of them.
        return call % 2 === 1 ? { ok: false, status: 503, text: '' } : { ok: true, status: 200, text: page }
      },
    })
    assert.equal(result.rows.length, 2)
    assert.deepEqual(result.issues, [])
  })

  it('reports a window that stays empty as a gap worth running again', async () => {
    // The newest window fails both times; the older ones answer.
    const newest = windowsFor('2024-09-23', '2026-09-23').at(-1)!
    const result = await fetchDseHistory({
      symbol: 'AAAPHARMA',
      from: '2024-09-23',
      to: '2026-09-23',
      pauseMs: 0,
      fetchPage: async (url) =>
        url.includes(`startDate=${newest.from}`)
          ? { ok: false, status: 503, text: '' }
          : { ok: true, status: 200, text: page },
    })
    assert.equal(result.rows.length, 2)
    assert.match(result.issues[0], /1 window brought nothing/)
    assert.match(result.issues[0], /Running again fills them/)
  })

  it('treats empty windows older than the oldest row as where the archive starts', async () => {
    // DSE keeps about two years; older windows answer with no table at all.
    const result = await fetchDseHistory({
      symbol: 'AAAPHARMA',
      from: '2021-09-23',
      to: '2026-09-23',
      pauseMs: 0,
      fetchPage: async (url) =>
        url.includes('startDate=2021') || url.includes('startDate=2022') || url.includes('startDate=2023')
          ? { ok: true, status: 200, text: '<html><body>No data found</body></html>' }
          : { ok: true, status: 200, text: page },
    })
    assert.ok(result.rows.length > 0)
    assert.match(result.issues[0], /does not go back further/)
    assert.ok(!result.issues.some((i) => /Running again/.test(i)), 'not reported as a gap')
  })

  it('says when nothing came back at all', async () => {
    const result = await fetchDseHistory({
      symbol: 'NOPE',
      from: '2026-09-01',
      to: '2026-09-23',
      pauseMs: 0,
      fetchPage: async () => ({ ok: true, status: 200, text: '<html><body>No data</body></html>' }),
    })
    assert.deepEqual(result.rows, [])
    assert.match(result.issues[0], /Nothing came back for NOPE/)
  })
})

/*
 * Against a real archive page saved into the project folder, when there is
 * one. It is gitignored, so this is skipped anywhere it is absent.
 */
const SAVED = ['DSE Close Price _ Dhaka Stock Exchange.html']
  .map((name) => join(process.cwd(), name))
  .filter((path) => existsSync(path))

describe('a real archive page (local only)', { skip: SAVED.length === 0 }, () => {
  it('reads every row, and agrees with the CSV export of the same days', () => {
    const parsed = parseDseArchive(readFileSync(SAVED[0], 'utf8'))
    assert.deepEqual(parsed.issues, [])
    assert.equal(parsed.rows.length, parsed.tableRows)
    assert.ok(parsed.rows.length > 100)

    const csvPath = join(process.cwd(), 'squrpharma.csv')
    if (!existsSync(csvPath)) return
    const csv = parsePriceCsv(readFileSync(csvPath, 'utf8'))
    const byDate = new Map(csv.rows.map((r) => [r.date, r]))

    for (const row of parsed.rows) {
      const other = byDate.get(row.date)
      if (!other) continue
      assert.deepEqual(
        [row.close, row.open, row.high, row.low, row.volume],
        [other.close, other.open, other.high, other.low, other.volume],
        `${row.date} differs between the page and the CSV`,
      )
    }
  })
})
