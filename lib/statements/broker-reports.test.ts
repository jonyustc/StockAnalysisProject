import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import type { PortfolioTransaction } from '../portfolio'
import { detectDocument } from './detect'
import { parseLankaBanglaDividends } from './lankabangla-dividends'
import { classify, parseLankaBanglaLedger } from './lankabangla-ledger'
import { parseLankaBanglaPnl } from './lankabangla-pnl'
import { comparePnl, planDividendImport, planLedgerImport } from './plan'
import type { TextItem } from './types'

/*
 * Synthetic broker reports. Layout — wording, column positions, wrapped
 * particulars — copied from real LankaBangla reports; every name, figure and
 * identifier is invented. Real reports are never committed.
 */

function line(y: number, cells: [number, string][], page = 1): TextItem[] {
  return cells.map(([x, str]) => ({ x, y, str, page }))
}

const LEDGER_X = [20, 73, 121, 220, 239, 287, 358, 413, 483, 556]
function entry(y: number, values: string[], wrapped: string[] = []): TextItem[] {
  return [
    ...line(y, values.map((v, i) => [LEDGER_X[i], v] as [number, string])),
    ...wrapped.flatMap((w, i) => line(y - 12 * (i + 1), [[121, w]])),
  ]
}

function ledger(overrides: { buyDebit?: string; sellQty?: string } = {}): TextItem[] {
  return [
    ...line(752, [[396, "CLIENT'S LEDGER DETAILS (Summary"]]),
    ...line(741, [[106, 'LankaBangla Securities PLC']]),
    ...line(707, [[25, 'Client Code : X0001'], [218, 'Name: TEST CLIENT']]),
    ...line(695, [[25, 'BO ID.'], [81, '1234567890123456']]),
    ...line(681, [[25, 'Category : CASH'], [218, 'A/C Type : Individual']]),
    ...line(657, [[19, 'Transaction Date: From 01-Jan-2026 To 31-Jan-2026']]),
    ...line(653, [[466, 'Opening Balance (TK.): 0.00']]),
    ...line(634, [[19, 'Transactio'], [71, 'Transacti'], [120, 'Particulars'], [196, 'Qty.'], [232, 'Rate(TK.'], [272, 'Amount(TK.)'], [331, 'Comm.(TK.)'], [406, 'Debit(TK.)'], [473, 'Credit(TK.)'], [530, 'Ledger Balance']]),
    ...entry(608, ['01-Jan-2026', 'Receive', 'TT-#-BANK', '0', '0.00', '0.00', '0.00', '0.00', '10,000.00', '10,000.00'], ['NPS', 'COLLECTION']),
    ...entry(560, ['02-Jan-2026', 'Buy', 'AAAPHARM', '10', '100.05', '1,000.50', '4.00', overrides.buyDebit ?? '1,004.50', '0.00', '8,995.50'], ['A']),
    ...entry(530, ['05-Jan-2026', 'Sale', 'AAAPHARM', overrides.sellQty ?? '4', '120.00', '480.00', '1.92', '0.00', '478.08', '9,473.58'], ['A']),
    ...entry(500, ['06-Jan-2026', 'Addition', 'BO', '0', '0.00', '0.00', '0.00', '150.00', '0.00', '9,323.58'], ['MAINTENANC', 'E FEE']),
    ...entry(450, ['07-Jan-2026', 'Receive', 'DD-#-CASH', '0', '0.00', '0.00', '0.00', '0.00', '45.00', '9,368.58'], ['DIVIDEND', 'RECEIVED', 'FOR AAA']),
    ...line(386, [[23, 'Total:'], [347, '5.92'], [404, '1,154.50'], [475, '10,523.08']]),
    ...line(371, [[464, 'Closing Balance (TK.): 9,368.58']]),
    ...line(41, [[26, 'Printed On: 31-Jan-2026 10:00:00'], [534, 'Page 1 of 1']]),
  ]
}

describe('client ledger', () => {
  const result = parseLankaBanglaLedger(ledger())
  assert.ok(result.ok)
  const l = result.ledger

  it('reads the header', () => {
    assert.equal(l.clientCode, 'X0001')
    assert.equal(l.boId, '1234567890123456')
    assert.deepEqual([l.from, l.to, l.openingBalance, l.closingBalance], ['2026-01-01', '2026-01-31', 0, 9368.58])
    assert.equal(detectDocument(ledger()), 'ledger')
  })

  it('reads every line and joins wrapped particulars', () => {
    assert.deepEqual(
      l.entries.map((e) => [e.kind, e.symbol, e.description]),
      [
        ['deposit', null, 'TT-#-BANK NPS COLLECTION'],
        ['buy', 'AAAPHARMA', 'AAAPHARMA'],
        ['sell', 'AAAPHARMA', 'AAAPHARMA'],
        ['fee', null, 'BO MAINTENANCE FEE'],
        ['dividend', null, 'DD-#-CASH DIVIDEND RECEIVED FOR AAA'],
      ],
    )
  })

  it('verifies the running balance, the totals and the closing balance', () => {
    assert.deepEqual(l.issues, [])
    for (const e of l.entries) assert.deepEqual(e.issues, [], `${e.date} ${e.label}`)
  })

  it('catches a misread amount on the line it happens', () => {
    const bad = parseLankaBanglaLedger(ledger({ buyDebit: '1,004.05' }))
    assert.ok(bad.ok)
    const buy = bad.ledger.entries.find((e) => e.kind === 'buy')!
    assert.ok(buy.issues.some((i) => /debit/.test(i)))
    assert.ok(buy.issues.some((i) => /balance/.test(i)))
  })

  it('classifies money moving out', () => {
    assert.equal(classify('Payment', 'CHQ-#-123 PAID TO CLIENT', 5000, 0), 'withdrawal')
    assert.equal(classify('Addition', 'CDBL CHARGE', 50, 0), 'fee')
    assert.equal(classify('Adjust', 'SOMETHING ODD', 50, 0), 'other')
  })
})

describe('planLedgerImport', () => {
  const parsed = parseLankaBanglaLedger(ledger())
  assert.ok(parsed.ok)

  const opening: PortfolioTransaction & { id: number } = {
    id: 9,
    accountId: 1,
    symbol: 'AAAPHARMA',
    tradeDate: '2026-01-31',
    txnType: 'buy',
    quantity: 6,
    pricePerShare: 100,
    grossAmount: null,
    commission: 0,
    taxWithheld: 0,
    source: 'statement',
  }

  it('replaces a statement opening position with the real trades', () => {
    const plan = planLedgerImport(parsed.ledger, [opening], new Set(['AAAPHARMA']))
    assert.deepEqual(plan.blockers, [])
    assert.deepEqual(plan.replaced.map((t) => t.id), [9])
    assert.deepEqual(plan.holdings, [{ symbol: 'AAAPHARMA', before: 6, after: 6 }])
    // Exact price from the amount, not the rounded printed rate.
    assert.equal(plan.trades[0].pricePerShare, 100.05)
    assert.deepEqual(
      plan.cash.map((c) => [c.kind, c.amount]),
      [['deposit', 10000], ['fee', -150], ['dividend', 45]],
    )
  })

  it('replaces a hand-entered trade the ledger also has', () => {
    const typed = { ...opening, id: 11, source: 'manual', tradeDate: '2026-01-03', quantity: 10 }
    const plan = planLedgerImport(parsed.ledger, [typed], new Set(['AAAPHARMA']))
    assert.deepEqual(plan.replaced.map((t) => t.id), [11])
    assert.deepEqual(plan.keptManual, [])
    assert.equal(plan.holdings[0].after, 6)
  })

  it('keeps a hand-entered row the ledger does not have — an IPO allotment, say', () => {
    const ipo = { ...opening, id: 12, source: 'manual', tradeDate: '2026-01-15', quantity: 25, pricePerShare: 10 }
    const plan = planLedgerImport(parsed.ledger, [ipo], new Set(['AAAPHARMA']))
    assert.deepEqual(plan.replaced, [])
    assert.deepEqual(plan.keptManual.map((t) => t.id), [12])
    assert.equal(plan.holdings[0].after, 31)
  })

  it('takes cash from the broker’s running balance, not the rounded columns', () => {
    // Commission printed 4.00, but the balance moved by 1,004.51: the broker's
    // unrounded commission was 4.005.
    const items = ledger().map((i) => (i.str === '8,995.50' ? { ...i, str: '8,995.49' } : i))
      .map((i) => (i.str === '9,473.58' ? { ...i, str: '9,473.57' } : i))
      .map((i) => (i.str === '9,323.58' ? { ...i, str: '9,323.57' } : i))
      .map((i) => (i.str === '9,368.58' ? { ...i, str: '9,368.57' } : i))
      .map((i) => (i.str === 'Closing Balance (TK.): 9,368.58' ? { ...i, str: 'Closing Balance (TK.): 9,368.57' } : i))
    const drifted = parseLankaBanglaLedger(items)
    assert.ok(drifted.ok)
    const plan = planLedgerImport(drifted.ledger, [], new Set())
    assert.equal(plan.trades[0].commission, 4.01)
    const cash = plan.cash.reduce((s, c) => s + c.amount, 0)
    const trades = plan.trades.reduce((s, t) => s + (t.txnType === 'buy' ? -1 : 1) * t.quantity * t.pricePerShare - t.commission, 0)
    assert.ok(Math.abs(cash + trades - 9368.57) < 0.005)
  })

  it('lists companies it will have to add', () => {
    assert.deepEqual(planLedgerImport(parsed.ledger, [], new Set()).newSymbols, ['AAAPHARMA'])
  })

  it('keeps dividends and bonus shares, which a cash ledger does not show', () => {
    const bonus = { ...opening, id: 10, txnType: 'bonus' as const, quantity: 1, pricePerShare: 0, tradeDate: '2026-01-20' }
    const plan = planLedgerImport(parsed.ledger, [opening, bonus], new Set(['AAAPHARMA']))
    assert.deepEqual(plan.replaced.map((t) => t.id), [9])
    assert.equal(plan.holdings[0].after, 7)
  })

  it('refuses a history that sells shares it never bought', () => {
    const oversold = parseLankaBanglaLedger(ledger({ sellQty: '40' }))
    assert.ok(oversold.ok)
    assert.ok(planLedgerImport(oversold.ledger, [], new Set()).blockers.length > 0)
  })
})

function dividendReport(): TextItem[] {
  return [
    ...line(570, [[551, 'Cash Dividend Receivable Ledger Details']]),
    ...line(504, [[15, 'Client Code : X0001'], [208, 'Name: TEST CLIENT'], [689, '(Record Datewise)']]),
    ...line(487, [[15, 'BO ID.: 1234567890123456']]),
    ...line(470, [[15, 'Date Range: From 01-Jan-2026 To 31-Dec-2026']]),
    ...line(449, [[16, 'Company'], [283, 'Record Date'], [347, 'Percent(%)'], [403, 'BO Holdings'], [471, 'Gross Entitlement'], [560, 'At Source (TK)'], [630, 'Net Entitlemen'], [703, 'Received Date']]),
    ...line(430, [[11, 'LBSL (BO A/C)']]),
    ...line(414, [[16, 'Aaa Pharmaceuticals'], [283, '10-Mar-2026'], [365, '150.00'], [438, '20.00'], [519, '300.00'], [598, '30.00'], [664, '270.00'], [711, '02-Apr-2026']]),
    ...line(396, [[520, '300.00'], [599, '30.00'], [664, '270.00']]),
    ...line(383, [[11, 'Other than LBSL (BO A/C)']]),
    ...line(368, [[16, 'Bbb Limited'], [283, '05-Jun-2026'], [365, '50.00'], [433, '10.00'], [519, '50.00']]),
    ...line(349, [[520, '50.00']]),
    ...line(333, [[12, 'Total:'], [520, '350.00']]),
  ]
}

describe('dividend report', () => {
  const result = parseLankaBanglaDividends(dividendReport())
  assert.ok(result.ok)
  const r = result.ledger

  it('reads both sections', () => {
    assert.equal(detectDocument(dividendReport()), 'dividends')
    assert.deepEqual(r.issues, [])
    assert.deepEqual(
      r.lines.map((l) => [l.companyName, l.paidVia, l.recordDate, l.gross, l.tax, l.receivedDate]),
      [
        ['Aaa Pharmaceuticals', 'broker', '2026-03-10', 300, 30, '2026-04-02'],
        ['Bbb Limited', 'elsewhere', '2026-06-05', 50, null, null],
      ],
    )
  })

  const companies = [
    { symbol: 'AAAPHARMA', name: 'Aaa Pharmaceuticals PLC', shortName: null },
    { symbol: 'BBB', name: 'Bbb Limited', shortName: null },
  ]
  const trades: PortfolioTransaction[] = [
    { accountId: 1, symbol: 'AAAPHARMA', tradeDate: '2026-02-01', txnType: 'buy', quantity: 20, pricePerShare: 100, grossAmount: null, commission: 0, taxWithheld: 0 },
  ]

  it('plans them with tax, and infers the tax on one paid elsewhere', () => {
    const plan = planDividendImport(r, 1, trades, companies)
    assert.deepEqual(
      plan.map((p) => [p.symbol, p.date, p.gross, p.taxWithheld, p.suggested]),
      [
        ['AAAPHARMA', '2026-04-02', 300, 30, true],
        // 10% like the other; not ticked until seen in the bank.
        ['BBB', '2026-06-05', 50, 5, false],
      ],
    )
    assert.equal(plan[0].ledgerHolding, 20)
    assert.equal(plan[0].caveat, null)
  })

  it('does not offer one that is already recorded', () => {
    const paid = [...trades, { ...trades[0], txnType: 'dividend' as const, quantity: null, pricePerShare: null, grossAmount: 300, taxWithheld: 30, tradeDate: '2026-04-02' }]
    const plan = planDividendImport(r, 1, paid, companies)
    assert.equal(plan[0].recorded, true)
    assert.equal(plan[0].suggested, false)
  })
})

function pnlReport(): TextItem[] {
  return [
    ...line(811, [[126, 'LankaBangla Securities PLC'], [408, 'CLIENT PROFIT LOSS ANALYSIS']]),
    ...line(757, [[55, 'Client Code: X0001'], [186, 'Name: TEST CLIENT']]),
    ...line(742, [[55, 'BO ID: 1234567890123456']]),
    ...line(730, [[458, 'Previous Gain: 0.00']]),
    ...line(725, [[55, 'Transaction Date 1-Jan-2026 To 31-Jan-2026']]),
    ...line(707, [[55, 'Company Name'], [241, 'Buy Qty'], [282, 'Cost Pric'], [397, 'Sale Qty'], [442, 'Sale Pric'], [528, 'Profit/ Loss']]),
    ...line(684, [[55, 'Aaa Pharmaceuticals PLC.'], [272, '10'], [287, '100.45'], [335, '1,004.50'], [423, '4'], [447, '119.52'], [489, '478.08'], [550, '76.28']]),
    ...line(574, [[55, 'Total :']]),
    ...line(570, [[548, '76.28']]),
  ]
}

describe('profit/loss report', () => {
  const result = parseLankaBanglaPnl(pnlReport())
  assert.ok(result.ok)

  it('reads each company and the total', () => {
    assert.equal(detectDocument(pnlReport()), 'pnl')
    assert.deepEqual(result.pnl.issues, [])
    assert.equal(result.pnl.total, 76.28)
    assert.deepEqual([result.pnl.from, result.pnl.to], ['2026-01-01', '2026-01-31'])
  })

  it('agrees with a ledger that has every trade', () => {
    const parsed = parseLankaBanglaLedger(ledger())
    assert.ok(parsed.ok)
    const trades = planLedgerImport(parsed.ledger, [], new Set()).trades.map((t) => ({
      accountId: 1,
      symbol: t.symbol,
      tradeDate: t.date,
      txnType: t.txnType,
      quantity: t.quantity,
      pricePerShare: t.pricePerShare,
      grossAmount: null,
      commission: t.commission,
      taxWithheld: 0,
    }))
    // No company name on file matches: found by its quantities instead.
    const { rows, total } = comparePnl(result.pnl, 1, trades, [])
    assert.equal(rows[0].symbol, 'AAAPHARMA')
    assert.equal(rows[0].complete, true)
    assert.ok(Math.abs(total.ledger - total.broker) < 0.01)
  })
})

/*
 * Against the real reports in .statements/, when there are any. Structure
 * and arithmetic only; prints nothing from them.
 */
const STATEMENTS = join(process.cwd(), '.statements')
const realFiles = existsSync(STATEMENTS)
  ? readdirSync(STATEMENTS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  : []

describe('real broker reports (local only)', { skip: realFiles.length === 0 }, () => {
  for (const file of realFiles) {
    it(`${file} parses cleanly, if it is a ledger or report`, async () => {
      const { extractTextItems } = await import('./extract')
      const items = await extractTextItems(new Uint8Array(readFileSync(join(STATEMENTS, file))))
      const kind = detectDocument(items)
      assert.ok(kind, 'not recognised as any broker document')

      if (kind === 'ledger') {
        const r = parseLankaBanglaLedger(items)
        assert.ok(r.ok)
        assert.deepEqual(r.ledger.issues, [])
        for (const e of r.ledger.entries) assert.deepEqual(e.issues, [], `${e.date} ${e.label}`)
        assert.deepEqual(planLedgerImport(r.ledger, [], new Set()).blockers, [])
      }
      if (kind === 'dividends') {
        const r = parseLankaBanglaDividends(items)
        assert.ok(r.ok)
        assert.deepEqual(r.ledger.issues, [])
      }
      if (kind === 'pnl') {
        const r = parseLankaBanglaPnl(items)
        assert.ok(r.ok)
        assert.deepEqual(r.pnl.issues, [])
        for (const l of r.pnl.lines) assert.deepEqual(l.issues, [], l.companyName)
      }
    })
  }
})
