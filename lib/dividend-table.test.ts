import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { looksAdjusted, parseDividendTable, percentOfFace } from './dividend-table'
import { pastedTable } from './table'

/*
 * The shape a dividend history is pasted in: a site's table markup, with the
 * dates inside <time> elements and the type drawn as an icon. Copied from a
 * real page's structure; the company and every figure are invented.
 */
function dividendPage(rows: [string, string, string][]): string {
  const body = rows
    .map(
      ([exDate, amount, paymentDate]) => `<tr class="relative h-[41px] hover:bg-secondary">
        <td class="sticky left-0"><time datetime="${exDate}">${exDate}</time></td>
        <td class="text-right">${amount}</td>
        <td class="text-right"><div class="flex justify-end"><div><svg width="16" height="16"><path fill="#5B616E" d="M15 7.5a.5.5 0"></path></svg><div class="absolute">12M</div></div></div></td>
        <td class="text-right"><time datetime="${paymentDate}">${paymentDate}</time></td>
        <td class="text-right" dir="ltr">5.63%</td>
      </tr>`,
    )
    .join('')

  return `<table class="w-full"><thead><tr>
      <th><div><span>Ex-Dividend Date</span></div></th>
      <th><div><span>Dividend</span></div></th>
      <th><div><span>Type</span></div></th>
      <th><div><span>Payment Date</span></div></th>
      <th><div><span>Yield</span></div></th>
    </tr></thead><tbody>${body}</tbody></table>`
}

const SAMPLE: [string, string, string][] = [
  ['Nov 17, 2025', '12.00', 'Jan 14, 2026'],
  ['Nov 24, 2024', '11.00', 'Jan 19, 2025'],
  ['Nov 19, 2023', '10.50', 'Jan 14, 2024'],
  ['Nov 28, 2018', '3.20427236', 'Jan 20, 2019'],
]

describe('pastedTable', () => {
  it('reads rows out of pasted markup', () => {
    const rows = pastedTable(dividendPage(SAMPLE))
    assert.equal(rows.length, SAMPLE.length + 1)
    assert.equal(rows[0][0], 'Ex-Dividend Date')
    assert.equal(rows[1][0], 'Nov 17, 2025')
  })

  it('reads rows pasted as plain text, tabs or commas', () => {
    assert.deepEqual(pastedTable('Ex Date\tDividend\n2025-11-17\t12.00'), [
      ['Ex Date', 'Dividend'],
      ['2025-11-17', '12.00'],
    ])
    assert.deepEqual(pastedTable('Ex Date,Dividend\n2025-11-17,12.00')[1], ['2025-11-17', '12.00'])
  })

  it('has nothing to give from nothing', () => {
    assert.deepEqual(pastedTable('   '), [])
  })
})

describe('looksAdjusted', () => {
  it('knows a declared dividend from a restated one', () => {
    // DSE declares a percentage of face value, so it lands on a whole paisa.
    assert.equal(looksAdjusted(12), false)
    assert.equal(looksAdjusted(10.5), false)
    assert.equal(looksAdjusted(3.20427236), true)
  })
})

describe('parseDividendTable', () => {
  it('reads the ex-date, the amount and the payment date', () => {
    const { rows, columns, issues } = parseDividendTable(dividendPage(SAMPLE))

    assert.equal(columns['Ex-Dividend Date'], 'exDate')
    assert.equal(columns['Payment Date'], 'paymentDate')
    assert.deepEqual(
      rows.map((r) => [r.exDate, r.amount, r.paymentDate]),
      [
        ['2025-11-17', 12, '2026-01-14'],
        ['2024-11-24', 11, '2025-01-19'],
        ['2023-11-19', 10.5, '2024-01-14'],
        ['2018-11-28', 3.20427236, '2019-01-20'],
      ],
    )
    assert.ok(issues.some((i) => /restated them for later bonus issues/.test(i)))
  })

  it('marks the restated ones rather than passing them off as declared', () => {
    const { rows } = parseDividendTable(dividendPage(SAMPLE))
    assert.deepEqual(rows.map((r) => r.looksAdjusted), [false, false, false, true])
  })

  it('leaves out a row with no dividend, and says so', () => {
    const { rows, issues } = parseDividendTable(dividendPage([...SAMPLE, ['Nov 01, 2012', '0.00', 'Dec 01, 2012']]))
    assert.equal(rows.length, SAMPLE.length)
    assert.ok(issues.some((i) => /no dividend amount/.test(i)))
  })

  it('reads rows pasted without their headings', () => {
    const { rows, issues } = parseDividendTable('Nov 17, 2025\t12.00\t12M\tJan 14, 2026\t5.63%')
    assert.deepEqual(rows.map((r) => [r.exDate, r.amount, r.paymentDate]), [['2025-11-17', 12, '2026-01-14']])
    assert.ok(issues.some((i) => /No headings found/.test(i)))
  })

  it('says when there was no table at all', () => {
    assert.match(parseDividendTable('hello').issues[0], /No dividends could be read/)
    assert.match(parseDividendTable('   ').issues[0], /Nothing that looks like a table/)
  })
})

describe('percentOfFace', () => {
  it('states a dividend as the percentage DSE announces', () => {
    assert.equal(percentOfFace(12, 10), '120.000000')
    assert.equal(percentOfFace(10.5, 10), '105.000000')
  })

  it('does not let double arithmetic move the last place', () => {
    // Either way round in doubles these land either side of the half, and a
    // column of four decimals would then round the two paths apart.
    assert.equal(percentOfFace(0.123455, 10), '1.234550')
    assert.equal(percentOfFace(0.890125, 10), '8.901250')
  })

  it('has nothing to give without a face value', () => {
    assert.equal(percentOfFace(12, 0), null)
    assert.equal(percentOfFace(12, Number.NaN), null)
  })
})
