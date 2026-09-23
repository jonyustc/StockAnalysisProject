import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addDays, coverageOf, earningsTimeline, PUBLICATION_LAG_DAYS, yearsAgo } from './insight-inputs'

describe('dates', () => {
  it('moves by days and years', () => {
    assert.equal(addDays('2026-01-01', 31), '2026-02-01')
    assert.equal(yearsAgo('2026-09-22', 5), '2021-09-22')
  })
})

describe('earningsTimeline', () => {
  const years = [
    { fiscalYear: 2024, values: { eps_basic: 20 } },
    { fiscalYear: 2025, values: { eps_basic: 25 } },
    { fiscalYear: 2026, values: { eps_basic: null } },
  ]
  const end = (fy: number) => `${fy}-06-30`

  it('dates each figure from when it could be known, not from the year end', () => {
    const timeline = earningsTimeline(years, end)
    assert.deepEqual(
      timeline.map((e) => [e.from, e.eps]),
      [
        [addDays('2024-06-30', PUBLICATION_LAG_DAYS), 20],
        [addDays('2025-06-30', PUBLICATION_LAG_DAYS), 25],
      ],
    )
  })

  it('leaves out years with no earnings entered', () => {
    assert.equal(earningsTimeline(years, end).length, 2)
  })
})

describe('coverageOf', () => {
  const days = (from: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({ date: addDays(from, i) }))

  it('says what a few days of prices are not enough for', () => {
    const c = coverageOf(days('2026-09-01', 3))
    assert.deepEqual([c.days, c.hasYear, c.hasBand, c.hasSeasons], [3, false, false, false])
    assert.match(c.note!, /about 250/)
  })

  it('a year of prices covers the range and the band, but not the seasons', () => {
    const c = coverageOf(days('2025-09-23', 300))
    assert.deepEqual([c.hasYear, c.hasBand, c.hasSeasons], [true, true, false])
    assert.match(c.note!, /Two full calendar years/)
  })

  it('two full calendar years cover everything', () => {
    const c = coverageOf(days('2024-01-01', 900))
    assert.equal(c.hasSeasons, true)
    assert.equal(c.note, null)
  })
})
