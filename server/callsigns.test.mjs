import { describe, expect, it } from 'vitest'
import bs58 from 'bs58'
import {
  callsignSeedFromStore,
  callsignTakenMessage,
  canonicalCallsign,
  createCallsignRegistry,
  looksLikeWalletKey,
  normalizeCallsign,
  resolveUniqueCallsign,
} from './callsigns.mjs'

// A syntactically real Solana pubkey (32 bytes of base58) — callsignSeedFromStore only treats
// keys of this shape as wallet rows, so the fixtures have to decode.
function walletKey(seed) {
  const bytes = new Uint8Array(32).fill(seed)
  return bs58.encode(bytes)
}
const WALLET_A = walletKey(1)
const WALLET_B = walletKey(2)

describe('canonicalCallsign', () => {
  it('trims, collapses internal whitespace and preserves the claimant casing', () => {
    expect(canonicalCallsign('  Ace  Pilot ')).toBe('Ace Pilot')
  })
  it('caps at 16 chars and re-trims so a cut never leaves a trailing space', () => {
    expect(canonicalCallsign('X'.repeat(40))).toBe('X'.repeat(16))
    expect(canonicalCallsign('ABCDEFGHIJKLMNO Z')).toBe('ABCDEFGHIJKLMNO') // slice landed on the space
  })
  it('returns empty for null/whitespace-only input', () => {
    expect(canonicalCallsign(null)).toBe('')
    expect(canonicalCallsign('   ')).toBe('')
  })
})

describe('normalizeCallsign', () => {
  it('collides Ace / ACE / "ace " — case and whitespace are not distinguishing', () => {
    expect(normalizeCallsign('Ace')).toBe('ace')
    expect(normalizeCallsign('ACE')).toBe('ace')
    expect(normalizeCallsign('ace ')).toBe('ace')
  })
  it('refuses to reserve the PILOT placeholder in any casing', () => {
    expect(normalizeCallsign('PILOT')).toBe('')
    expect(normalizeCallsign('pilot')).toBe('')
    expect(normalizeCallsign(' Pilot ')).toBe('')
  })
  it('returns empty for nothing reservable', () => {
    expect(normalizeCallsign('')).toBe('')
    expect(normalizeCallsign(undefined)).toBe('')
  })
})

describe('looksLikeWalletKey', () => {
  it('accepts a 32-byte base58 pubkey', () => {
    expect(looksLikeWalletKey(WALLET_A)).toBe(true)
  })
  it('rejects the default UUID Pilot Code (hyphens are not base58)', () => {
    expect(looksLikeWalletKey('fcb1eb43-7d75-46c9-9737-7b87b0e51659')).toBe(false)
  })
  it('rejects junk without throwing', () => {
    expect(looksLikeWalletKey('')).toBe(false)
    expect(looksLikeWalletKey(null)).toBe(false)
    expect(looksLikeWalletKey('0OIl')).toBe(false) // base58 excludes these glyphs
  })
})

describe('createCallsignRegistry', () => {
  it('reserves a free name and reports the change so the caller can flush', () => {
    const reg = createCallsignRegistry()
    expect(reg.reserve('ACE', WALLET_A)).toBe(true)
    expect(reg.ownerOf('ace')).toBe(WALLET_A)
    expect(reg.size).toBe(1)
  })
  it('is idempotent for the same wallet — no spurious flush', () => {
    const reg = createCallsignRegistry()
    reg.reserve('ACE', WALLET_A)
    expect(reg.reserve('ace ', WALLET_A)).toBe(false)
    expect(reg.ownerOf('ACE')).toBe(WALLET_A)
  })
  it('never steals a name from another wallet', () => {
    const reg = createCallsignRegistry()
    reg.reserve('ACE', WALLET_A)
    expect(reg.reserve('ACE', WALLET_B)).toBe(false)
    expect(reg.ownerOf('ACE')).toBe(WALLET_A)
  })
  it('ignores unreservable and malformed entries when seeding', () => {
    const reg = createCallsignRegistry({ PILOT: WALLET_A, '   ': WALLET_B, ACE: '', NOVA: WALLET_B })
    expect(reg.snapshot()).toEqual({ nova: WALLET_B })
  })
  it('round-trips through snapshot (survives a relay restart)', () => {
    const reg = createCallsignRegistry()
    reg.reserve('Ace', WALLET_A)
    reg.reserve('Nova', WALLET_B)
    expect(createCallsignRegistry(reg.snapshot()).ownerOf('ACE')).toBe(WALLET_A)
  })
})

describe('callsignSeedFromStore', () => {
  it('backfills names already locked to wallet-keyed rows', () => {
    const store = { [WALLET_A]: { name: 'ACE' }, [WALLET_B]: { name: 'Nova' } }
    expect(callsignSeedFromStore(store)).toEqual({ ace: WALLET_A, nova: WALLET_B })
  })
  it('ignores anonymous Pilot Code rows — anonymous names are never reserved', () => {
    const store = { 'fcb1eb43-7d75-46c9-9737-7b87b0e51659': { name: 'CLAUDE' } }
    expect(callsignSeedFromStore(store)).toEqual({})
  })
  it('ignores placeholder names and null rows', () => {
    const store = { [WALLET_A]: { name: 'PILOT' }, [WALLET_B]: null }
    expect(callsignSeedFromStore(store)).toEqual({})
  })
  it('keeps the first holder when legacy rows already duplicate a name', () => {
    const store = { [WALLET_A]: { name: 'ACE' }, [WALLET_B]: { name: 'ace' } }
    expect(callsignSeedFromStore(store)).toEqual({ ace: WALLET_A })
  })
})

describe('resolveUniqueCallsign — anonymous path stays unrestricted', () => {
  it('grants an anonymous pilot a name another wallet has locked', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    const out = resolveUniqueCallsign({ registry, authed: false, pubkey: null, storedName: '', requestedName: 'ACE' })
    expect(out).toEqual({ name: 'ACE', reserved: false, conflict: null })
  })
  it('grants an anonymous pilot a case variant of a locked name', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    expect(resolveUniqueCallsign({ registry, authed: false, storedName: '', requestedName: 'Ace' }).name).toBe('Ace')
  })
  it('never reserves on behalf of an anonymous pilot', () => {
    const registry = createCallsignRegistry()
    resolveUniqueCallsign({ registry, authed: false, storedName: '', requestedName: 'NOVA' })
    expect(registry.size).toBe(0)
    expect(registry.ownerOf('NOVA')).toBe(null)
  })
  it('keeps resolveCallsign behaviour verbatim: requested name wins over any stored name', () => {
    const registry = createCallsignRegistry()
    expect(resolveUniqueCallsign({ registry, authed: false, storedName: 'ACE', requestedName: 'NEW' }).name).toBe('NEW')
  })
  it('does not canonicalize anonymous names — zero behaviour change on that path', () => {
    const registry = createCallsignRegistry()
    expect(resolveUniqueCallsign({ registry, authed: false, storedName: '', requestedName: ' Ace ' }).name).toBe(' Ace ')
  })
  it('treats a wallet with no pubkey (not yet verified) as anonymous', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    expect(resolveUniqueCallsign({ registry, authed: true, pubkey: null, storedName: '', requestedName: 'ACE' }).conflict).toBe(null)
  })
})

describe('resolveUniqueCallsign — wallet grants', () => {
  it('grants and reserves a free name on the first claim', () => {
    const registry = createCallsignRegistry()
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: 'ACE' })
    expect(out).toEqual({ name: 'ACE', reserved: true, conflict: null })
    expect(registry.ownerOf('ace')).toBe(WALLET_A)
  })
  it('canonicalizes what it stores, so the reserved and displayed forms match', () => {
    const registry = createCallsignRegistry()
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: '  Ace  Two ' })
    expect(out.name).toBe('Ace Two')
    expect(registry.ownerOf('ACE TWO')).toBe(WALLET_A)
  })
  it('lets a wallet reclaim its own callsign (returning player, not a collision)', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: 'ACE' })
    expect(out).toEqual({ name: 'ACE', reserved: false, conflict: null })
  })
  it('lets a wallet reclaim its own callsign through a case variant', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    expect(resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: 'ace ' }).conflict).toBe(null)
  })
  it('refuses a different wallet and falls back to PILOT rather than blocking the flight', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_B, storedName: '', requestedName: 'ACE' })
    expect(out).toEqual({ name: 'PILOT', reserved: false, conflict: { requested: 'ACE' } })
    expect(registry.ownerOf('ace')).toBe(WALLET_A) // untouched
  })
  it('refuses case and whitespace variants of another wallet name', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    for (const requested of ['Ace', 'ace', 'ACE ', ' aCe']) {
      const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_B, storedName: '', requestedName: requested })
      expect(out.name).toBe('PILOT')
      expect(out.conflict).not.toBe(null)
    }
  })
  it('keeps a stored name sticky and ignores a different requested name', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: 'ACE', requestedName: 'NEW' })
    expect(out).toEqual({ name: 'ACE', reserved: false, conflict: null })
    expect(registry.ownerOf('new')).toBe(null) // the ignored request reserves nothing
  })
  it('backfills the registry from a stored name the seed missed', () => {
    const registry = createCallsignRegistry()
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: 'ACE', requestedName: 'NEW' })
    expect(out).toEqual({ name: 'ACE', reserved: true, conflict: null })
    expect(registry.ownerOf('ace')).toBe(WALLET_A)
  })
  it('grandfathers a legacy duplicate: the stored name survives, without stealing the index', () => {
    const registry = createCallsignRegistry({ ace: WALLET_A })
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_B, storedName: 'ACE', requestedName: 'ACE' })
    expect(out).toEqual({ name: 'ACE', reserved: false, conflict: null })
    expect(registry.ownerOf('ace')).toBe(WALLET_A)
  })
  it('does not reserve the PILOT placeholder for the first wallet that flies as it', () => {
    const registry = createCallsignRegistry()
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: 'PILOT' })
    expect(out).toEqual({ name: 'PILOT', reserved: false, conflict: null })
    expect(registry.size).toBe(0)
    // ...so a second wallet is not locked out of the default name.
    expect(resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_B, storedName: '', requestedName: 'pilot' }).conflict).toBe(null)
  })
  it('handles the viewer case: authed with no stored and no requested name', () => {
    const registry = createCallsignRegistry()
    const out = resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: null, requestedName: null })
    expect(out).toEqual({ name: 'PILOT', reserved: false, conflict: null })
  })
  it('caps a wallet grant at 16 chars, matching the wire limit', () => {
    const registry = createCallsignRegistry()
    expect(resolveUniqueCallsign({ registry, authed: true, pubkey: WALLET_A, storedName: '', requestedName: 'Y'.repeat(30) }).name).toBe('Y'.repeat(16))
  })
})

describe('callsignTakenMessage', () => {
  it('names the callsign, the cause and the way out', () => {
    const msg = callsignTakenMessage('ACE')
    expect(msg).toContain('ACE')
    expect(msg).toContain('another wallet')
    expect(msg).toMatch(/pick a different/i)
  })
})
