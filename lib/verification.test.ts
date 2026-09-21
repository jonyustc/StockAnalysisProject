import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeSummary, summarise, verifyRow } from './verification'

describe('verifyRow', () => {
  it('confirms a figure the report agrees with', () => {
    const v = verifyRow('revenue', '20712.000000', '20,712')
    assert.equal(v.outcome, 'confirmed')
    assert.equal(v.typed, 20712)
  })

  it('treats blank as unchecked, not as agreement', () => {
    // Someone working through nineteen lines leaves most of them empty on any
    // one pass. Counting that as confirmation would be the worst possible bug
    // in this whole feature.
    for (const blank of ['', '   ', '\t']) {
      const v = verifyRow('revenue', '20712.000000', blank)
      assert.equal(v.outcome, 'skipped', `"${blank}" should be skipped`)
    }
  })

  it('does not treat a dash as a checked zero', () => {
    // parseReportedNumber reads "-" as absent, which here means the person
    // typed a placeholder, not that the report states nothing.
    assert.equal(verifyRow('revenue', '20712.000000', '-').outcome, 'error')
  })

  it('corrects when the report disagrees', () => {
    const v = verifyRow('eps_basic', '18.960000', '16.64')
    assert.equal(v.outcome, 'corrected')
    assert.equal(v.typed, 16.64)
    assert.equal(v.stored, 18.96)
  })

  it('catches a difference too small to see but too big to be rounding', () => {
    const v = verifyRow('eps_basic', '27.040000', '27.05')
    assert.equal(v.outcome, 'corrected')
  })

  it('absorbs float noise from the numeric column', () => {
    // Same printed figure, one round trip through numeric(24,6).
    assert.equal(verifyRow('revenue', '76288.000000', '76288').outcome, 'confirmed')
    assert.equal(verifyRow('navps', '157.880000', '157.88').outcome, 'confirmed')
  })

  it('adds a figure where nothing was stored', () => {
    // This is how years six to ten get entered: no imported value to compare,
    // so the report's figure is simply recorded, already verified.
    const v = verifyRow('revenue', null, '45,120')
    assert.equal(v.outcome, 'added')
    assert.equal(v.typed, 45120)
  })

  it('reads accountants parentheses as negative', () => {
    const v = verifyRow('capex', '-6177.000000', '(6,177)')
    assert.equal(v.outcome, 'confirmed')
  })

  it('reports an unreadable entry without writing anything', () => {
    const v = verifyRow('revenue', '20712.000000', 'see note 14')
    assert.equal(v.outcome, 'error')
    assert.match(v.message!, /not a number/)
  })

  it('handles a negative stored figure', () => {
    assert.equal(verifyRow('capex', '-4181.000000', '-4181').outcome, 'confirmed')
    assert.equal(verifyRow('capex', '-4181.000000', '-4182').outcome, 'corrected')
  })

  it('distinguishes zero from blank', () => {
    // A report stating zero is a real fact; a blank field is not.
    assert.equal(verifyRow('total_debt', '0.000000', '0').outcome, 'confirmed')
    assert.equal(verifyRow('total_debt', '0.000000', '').outcome, 'skipped')
    assert.equal(verifyRow('total_debt', null, '0').outcome, 'added')
  })
})

describe('summarise / describeSummary', () => {
  const verdicts = [
    verifyRow('a', '1.000000', '1'),
    verifyRow('b', '2.000000', '3'),
    verifyRow('c', null, '4'),
    verifyRow('d', '5.000000', ''),
    verifyRow('e', '6.000000', 'oops'),
  ]

  it('counts each outcome separately', () => {
    assert.deepEqual(summarise(verdicts), {
      confirmed: 1,
      corrected: 1,
      added: 1,
      skipped: 1,
      errors: 1,
    })
  })

  it('says plainly when nothing was checked', () => {
    const nothing = summarise([verifyRow('a', '1.000000', '')])
    assert.match(describeSummary(nothing), /Nothing checked/)
  })

  it('mentions what was left unchecked', () => {
    assert.match(describeSummary(summarise(verdicts)), /1 left unchecked/)
  })
})
