import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  fiscalCumulativeBounds,
  fiscalQuarterBounds,
  fiscalYearBounds,
  fiscalYearForDate,
  fiscalYearRangeLabel,
  latestReportedFiscalYear,
  type FiscalYearEnd,
} from './fiscal'

const MARICO: FiscalYearEnd = { month: 3, day: 31 } // Apr–Mar
const SQUARE: FiscalYearEnd = { month: 6, day: 30 } // Jul–Jun
const LAFARGE: FiscalYearEnd = { month: 12, day: 31 } // calendar year

describe('fiscalYearBounds', () => {
  it('spans April to March for a 31 March year-end', () => {
    assert.deepEqual(fiscalYearBounds(MARICO, 2026), {
      start: '2025-04-01',
      end: '2026-03-31',
      monthsCovered: 12,
    })
  })

  it('spans July to June for a 30 June year-end', () => {
    assert.deepEqual(fiscalYearBounds(SQUARE, 2026), {
      start: '2025-07-01',
      end: '2026-06-30',
      monthsCovered: 12,
    })
  })

  it('matches the calendar year for a 31 December year-end', () => {
    assert.deepEqual(fiscalYearBounds(LAFARGE, 2026), {
      start: '2026-01-01',
      end: '2026-12-31',
      monthsCovered: 12,
    })
  })

  it('produces abutting periods with no gap or overlap', () => {
    const previous = fiscalYearBounds(SQUARE, 2025)
    const current = fiscalYearBounds(SQUARE, 2026)
    assert.equal(previous.end, '2025-06-30')
    assert.equal(current.start, '2025-07-01')
  })

  it('rejects an impossible year-end', () => {
    assert.throws(() => fiscalYearBounds({ month: 13, day: 1 }, 2026), RangeError)
  })
})

describe('fiscalYearForDate', () => {
  it('assigns a date inside the year to that fiscal year', () => {
    assert.equal(fiscalYearForDate(MARICO, '2025-12-31'), 2026)
    assert.equal(fiscalYearForDate(MARICO, '2025-04-01'), 2026)
  })

  it('treats the year-end date itself as the year that ends there', () => {
    assert.equal(fiscalYearForDate(MARICO, '2026-03-31'), 2026)
    assert.equal(fiscalYearForDate(MARICO, '2026-04-01'), 2027)
  })

  it('matches the calendar year for a December year-end', () => {
    assert.equal(fiscalYearForDate(LAFARGE, '2026-07-15'), 2026)
  })

  it('puts the same date in different fiscal years for different companies', () => {
    // The reason FY labels are not comparable across companies without dates.
    assert.equal(fiscalYearForDate(MARICO, '2025-05-01'), 2026)
    assert.equal(fiscalYearForDate(LAFARGE, '2025-05-01'), 2025)
  })
})

describe('fiscalQuarterBounds', () => {
  it('counts quarters from the start of the fiscal year, not the calendar', () => {
    assert.deepEqual(fiscalQuarterBounds(MARICO, 2026, 1), {
      start: '2025-04-01',
      end: '2025-06-30',
      monthsCovered: 3,
    })
    assert.deepEqual(fiscalQuarterBounds(MARICO, 2026, 3), {
      start: '2025-10-01',
      end: '2025-12-31',
      monthsCovered: 3,
    })
  })

  it('ends the fourth quarter on the fiscal year end', () => {
    assert.equal(fiscalQuarterBounds(MARICO, 2026, 4).end, '2026-03-31')
    assert.equal(fiscalQuarterBounds(SQUARE, 2026, 4).end, '2026-06-30')
  })
})

describe('fiscalCumulativeBounds', () => {
  it('runs from the fiscal year start, as a DSE Q3 report does', () => {
    assert.deepEqual(fiscalCumulativeBounds(MARICO, 2026, 3), {
      start: '2025-04-01',
      end: '2025-12-31',
      monthsCovered: 9,
    })
  })
})

describe('fiscalYearRangeLabel', () => {
  it('shows the span, since FY2026 means different things per company', () => {
    assert.equal(fiscalYearRangeLabel(MARICO, 2026), 'FY2026 (Apr 2025 – Mar 2026)')
    assert.equal(fiscalYearRangeLabel(LAFARGE, 2026), 'FY2026 (Jan 2026 – Dec 2026)')
  })
})

describe('latestReportedFiscalYear', () => {
  it('does not claim a year whose results cannot exist yet', () => {
    // Marico FY2026 ended 31 Mar 2026; by Sep 2026 it is filed.
    assert.equal(latestReportedFiscalYear(MARICO, new Date('2026-09-20T00:00:00Z')), 2026)
    // Square FY2026 ended 30 Jun 2026; four months' lag means not yet.
    assert.equal(latestReportedFiscalYear(SQUARE, new Date('2026-09-20T00:00:00Z')), 2025)
    // LafargeHolcim FY2026 does not end until December.
    assert.equal(latestReportedFiscalYear(LAFARGE, new Date('2026-09-20T00:00:00Z')), 2025)
  })
})
