import { describe, it, expect, beforeEach } from 'vitest'
import { activeIdentity, loadWalletSession, saveWalletSession } from './identity'
import type { WalletSession } from './identity'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

describe('activeIdentity', () => {
  it('returns the wallet pubkey when connected', () => {
    const w: WalletSession = { pubkey: 'PK', sessionId: 's', connectedAt: 1 }
    expect(activeIdentity('anon-token', w)).toBe('PK')
  })
  it('falls back to the anon token when no wallet', () => {
    expect(activeIdentity('anon-token', null)).toBe('anon-token')
  })
})

describe('wallet session storage', () => {
  let ls: MemStorage
  beforeEach(() => { ls = new MemStorage() })
  it('round-trips a session', () => {
    const w: WalletSession = { pubkey: 'PK', sessionId: 's1', connectedAt: 123 }
    saveWalletSession(ls as unknown as Storage, w)
    expect(loadWalletSession(ls as unknown as Storage)).toEqual(w)
  })
  it('returns null when nothing stored', () => {
    expect(loadWalletSession(ls as unknown as Storage)).toBeNull()
  })
  it('clears on null', () => {
    saveWalletSession(ls as unknown as Storage, { pubkey: 'PK', sessionId: 's', connectedAt: 1 })
    saveWalletSession(ls as unknown as Storage, null)
    expect(loadWalletSession(ls as unknown as Storage)).toBeNull()
  })
  it('returns null on corrupt JSON', () => {
    ls.setItem('scc.wallet', '{not json')
    expect(loadWalletSession(ls as unknown as Storage)).toBeNull()
  })
})
