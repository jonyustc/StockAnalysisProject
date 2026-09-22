import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assessFreshness,
  dhakaNow,
  expectedLatestClose,
  formatTradeDate,
  isTradingDay,
  tradingDaysBetween,
} from './trading-calendar'

/** A moment given in Dhaka local time (UTC+6), as a real Date. */
function dhaka(local: string): Date {
  return new Date(`${local}+06:00`)
}

// September 2026: 17 Thu, 18 Fri, 19 Sat, 20 Sun, 21 Mon, 22 Tue, 23 Wed, 24 Thu, 25 Fri, 26 Sat.

describe('isTradingDay', () => {
  it('trades Sunday to Thursday, not Friday or Saturday', () => {
    assert.deepEqual(
      ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-24'].map(isTradingDay),
      [false, false, true, true, true],
    )
  })
})

describe('tradingDaysBetween', () => {
  it('skips the weekend', () => {
    // Thu 17 -> Sun 20: only Sunday is a session.
    assert.equal(tradingDaysBetween('2026-09-17', '2026-09-20'), 1)
  })

  it('is zero for the same day', () => {
    assert.equal(tradingDaysBetween('2026-09-21', '2026-09-21'), 0)
  })
})

describe('dhakaNow', () => {
  it('uses Dhaka time whatever the server runs in', () => {
    // 20:00 UTC on the 21st is already 02:00 on the 22nd in Dhaka.
    assert.deepEqual(dhakaNow(new Date('2026-09-21T20:00:00Z')), { date: '2026-09-22', hour: 2 })
  })
})

describe('expectedLatestClose', () => {
  it('expects the previous session before the evening job has run', () => {
    assert.equal(expectedLatestClose(dhaka('2026-09-22T10:00:00')), '2026-09-21')
  })

  it("expects today's close once the evening job should have run", () => {
    assert.equal(expectedLatestClose(dhaka('2026-09-22T19:00:00')), '2026-09-22')
  })

  it('expects Thursday all weekend', () => {
    assert.equal(expectedLatestClose(dhaka('2026-09-18T20:00:00')), '2026-09-17')
    assert.equal(expectedLatestClose(dhaka('2026-09-19T12:00:00')), '2026-09-17')
  })

  it('expects Thursday on Sunday morning, before the first session closes', () => {
    assert.equal(expectedLatestClose(dhaka('2026-09-20T09:00:00')), '2026-09-17')
  })
})

describe('assessFreshness', () => {
  it('calls a Thursday close fresh on Saturday — the false alarm this avoids', () => {
    const f = assessFreshness('2026-09-17', dhaka('2026-09-19T12:00:00'))
    assert.equal(f.status, 'fresh')
    assert.equal(f.missedTradingDays, 0)
  })

  it('is fresh in the morning with yesterday’s close', () => {
    assert.equal(assessFreshness('2026-09-21', dhaka('2026-09-22T10:00:00')).status, 'fresh')
  })

  it('is one behind in the evening if today’s run has not landed', () => {
    const f = assessFreshness('2026-09-21', dhaka('2026-09-22T19:00:00'))
    assert.equal(f.status, 'behind')
    assert.equal(f.missedTradingDays, 1)
  })

  it('goes stale after two missed sessions, counting across a weekend correctly', () => {
    // Last close Thu 17; now Mon 21 evening. Missed: Sun 20, Mon 21.
    const f = assessFreshness('2026-09-17', dhaka('2026-09-21T19:00:00'))
    assert.equal(f.status, 'stale')
    assert.equal(f.missedTradingDays, 2)
  })

  it('reports none when there are no prices at all', () => {
    assert.equal(assessFreshness(null, dhaka('2026-09-22T10:00:00')).status, 'none')
  })

  it('is not negative if the stored close is newer than expected', () => {
    const f = assessFreshness('2026-09-22', dhaka('2026-09-22T10:00:00'))
    assert.equal(f.status, 'fresh')
    assert.equal(f.missedTradingDays, 0)
  })
})

describe('formatTradeDate', () => {
  it('writes the month out, so 09/10 and 10/09 cannot be confused', () => {
    assert.equal(formatTradeDate('2026-09-21'), '21 Sep 2026')
  })
})
