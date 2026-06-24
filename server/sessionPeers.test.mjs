import { describe, expect, it } from 'vitest'
import { resolveCallsign, identityKey, kickDuplicateActiveClients } from './sessionPeers.mjs'

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closed: false,
    send(raw) { this.sent.push(JSON.parse(raw)) },
    close() { this.closed = true },
  }
}

describe('resolveCallsign', () => {
  it('anonymous pilots use their requested name even if a stored name is passed', () => {
    expect(resolveCallsign({ authed: false, storedName: 'ACE', requestedName: 'NEW' })).toBe('NEW')
  })
  it('authed pilots with a stored name keep it (ignore the requested name)', () => {
    expect(resolveCallsign({ authed: true, storedName: 'ACE', requestedName: 'NEW' })).toBe('ACE')
  })
  it('authed pilots with no stored name take the requested name (first-time lock)', () => {
    expect(resolveCallsign({ authed: true, storedName: '', requestedName: 'NEW' })).toBe('NEW')
  })
  it('a stored placeholder PILOT name does not lock', () => {
    expect(resolveCallsign({ authed: true, storedName: 'PILOT', requestedName: 'NEW' })).toBe('NEW')
  })
  it('sanitizes: caps at 16 chars and defaults empty to PILOT', () => {
    expect(resolveCallsign({ authed: false, storedName: '', requestedName: 'X'.repeat(40) })).toBe('X'.repeat(16))
    expect(resolveCallsign({ authed: false, storedName: '', requestedName: '' })).toBe('PILOT')
  })
})

describe('live session peer identity handling', () => {
  it('uses the verified wallet pubkey before the anonymous token', () => {
    expect(identityKey({ authed: true, pubkey: 'wallet', token: 'anon' })).toBe('wallet')
    expect(identityKey({ authed: false, pubkey: 'wallet', token: 'anon' })).toBe('anon')
  })

  it('removes active duplicate identities immediately before peer snapshots are built', () => {
    const currentWs = socket()
    const duplicateWs = socket()
    const otherWs = socket()
    const duplicate = { id: 'old-dev', active: true, authed: true, pubkey: 'wallet', token: 'old-token' }
    const current = { id: 'new-dev', active: true, authed: true, pubkey: 'wallet', token: 'new-token' }
    const other = { id: 'other', active: true, authed: true, pubkey: 'other-wallet', token: 'other-token' }
    const clients = new Map([
      [duplicateWs, duplicate],
      [currentWs, current],
      [otherWs, other],
    ])

    const removed = kickDuplicateActiveClients(clients, currentWs, current)

    expect(removed).toEqual([{ ws: duplicateWs, client: duplicate }])
    expect(clients.has(duplicateWs)).toBe(false)
    expect(clients.has(currentWs)).toBe(true)
    expect(clients.has(otherWs)).toBe(true)
    expect(duplicateWs.sent).toEqual([{ t: 'kicked' }])
    expect(duplicateWs.closed).toBe(true)
  })

  it('removes the previous anonymous pilot when a wallet session claims the same anon token', () => {
    const currentWs = socket()
    const anonWs = socket()
    const anon = { id: 'anon-dev', active: true, authed: false, pubkey: null, token: 'same-anon-token' }
    const current = { id: 'wallet-dev', active: true, authed: true, pubkey: 'wallet', token: 'same-anon-token' }
    const clients = new Map([
      [anonWs, anon],
      [currentWs, current],
    ])

    const removed = kickDuplicateActiveClients(clients, currentWs, current)

    expect(removed).toEqual([{ ws: anonWs, client: anon }])
    expect(clients.has(anonWs)).toBe(false)
    expect(anonWs.sent).toEqual([{ t: 'kicked' }])
    expect(anonWs.closed).toBe(true)
  })

  it('ignores inactive viewers with the same identity', () => {
    const currentWs = socket()
    const viewerWs = socket()
    const clients = new Map([
      [viewerWs, { id: 'viewer', active: false, authed: true, pubkey: 'wallet', token: 'viewer-token' }],
      [currentWs, { id: 'pilot', active: true, authed: true, pubkey: 'wallet', token: 'pilot-token' }],
    ])

    expect(kickDuplicateActiveClients(clients, currentWs, clients.get(currentWs))).toEqual([])
    expect(clients.has(viewerWs)).toBe(true)
    expect(viewerWs.sent).toEqual([])
  })
})
