import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { checkPassword, createSessionToken, verifySessionToken } from './auth'

const SECRET = 'a'.repeat(64)

before(() => {
  process.env.SESSION_SECRET = SECRET
  process.env.AUTH_PASSWORD = 'correct-horse-battery'
})

describe('session tokens', () => {
  it('accepts a token it issued', async () => {
    assert.equal(await verifySessionToken(await createSessionToken()), true)
  })

  it('rejects nothing at all', async () => {
    assert.equal(await verifySessionToken(undefined), false)
    assert.equal(await verifySessionToken(null), false)
    assert.equal(await verifySessionToken(''), false)
  })

  it('rejects a tampered expiry', async () => {
    // The whole point: extending your own session must not be possible without
    // the secret, because the expiry is covered by the signature.
    const token = await createSessionToken()
    const signature = token.slice(token.lastIndexOf('.') + 1)
    const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3650

    assert.equal(await verifySessionToken(`${farFuture}.${signature}`), false)
  })

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken()
    assert.equal(await verifySessionToken(`${token}x`), false)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken()
    process.env.SESSION_SECRET = 'b'.repeat(64)
    const verdict = await verifySessionToken(token)
    process.env.SESSION_SECRET = SECRET

    assert.equal(verdict, false)
  })

  it('rejects an expired token', async () => {
    const issued = Date.now() - 1000 * 60 * 60 * 24 * 31
    assert.equal(await verifySessionToken(await createSessionToken(issued)), false)
  })

  it('refuses to issue with a weak secret', async () => {
    process.env.SESSION_SECRET = 'short'
    await assert.rejects(() => createSessionToken())
    process.env.SESSION_SECRET = SECRET
  })
})

describe('password check', () => {
  it('accepts the configured password and nothing else', () => {
    assert.equal(checkPassword('correct-horse-battery'), true)
    assert.equal(checkPassword('correct-horse-batterz'), false)
    assert.equal(checkPassword('correct-horse-batter'), false)
    assert.equal(checkPassword(''), false)
  })

  it('refuses to authenticate at all when unconfigured', () => {
    // Failing closed matters: an unset password must lock everyone out, never
    // let everyone in.
    const saved = process.env.AUTH_PASSWORD

    delete process.env.AUTH_PASSWORD
    assert.throws(() => checkPassword('anything'))

    process.env.AUTH_PASSWORD = 'short'
    assert.throws(() => checkPassword('short'))

    process.env.AUTH_PASSWORD = saved
  })
})
