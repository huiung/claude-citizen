import { describe, it, expect } from 'vitest'
import { launchGate, LAUNCH_MIN_TOKEN_BALANCE } from './accessGate.mjs'

describe('launchGate', () => {
  it('exempts the operator showcase bot regardless of balance', () => {
    expect(launchGate({ isBot: true, authed: false, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
  })
  it('rejects an unauthenticated (no wallet) connection', () => {
    expect(launchGate({ isBot: false, authed: false, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: false, reason: 'wallet-required' })
  })
  it('rejects a verified wallet below the threshold (incl. a failed fetch that resolves 0)', () => {
    expect(launchGate({ isBot: false, authed: true, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: false, reason: 'insufficient-tokens' })
  })
  it('admits a verified wallet at exactly the threshold and above', () => {
    expect(launchGate({ isBot: false, authed: true, holderBalance: 1 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
    expect(launchGate({ isBot: false, authed: true, holderBalance: 5000 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
  })
  it('LAUNCH_MIN_TOKEN_BALANCE is 1 and distinct from the 1000 ranked gate', () => {
    expect(LAUNCH_MIN_TOKEN_BALANCE).toBe(1)
  })
})
