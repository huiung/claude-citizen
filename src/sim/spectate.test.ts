import { describe, it, expect } from 'vitest'
import { pickFollowTarget, cycleFollowTarget, type FollowPeer } from './spectate'

const peer = (id: string, name: string, lastActiveAt: number): FollowPeer => ({ id, name, position: [0, 0, 0], lastActiveAt })

describe('pickFollowTarget', () => {
  it('returns null when no peers', () => {
    expect(pickFollowTarget([], null)).toBeNull()
  })
  it('prefers the showcase bot (CLAUDE) even over a more-active player', () => {
    const peers = [peer('a', 'Ace', 100), peer('b', 'CLAUDE', 1)]
    expect(pickFollowTarget(peers, null)).toBe('b')
  })
  it('picks the most recently active peer when no bot is present', () => {
    const peers = [peer('a', 'Ace', 100), peer('c', 'Nova', 250)]
    expect(pickFollowTarget(peers, null)).toBe('c')
  })
  it('honors a custom bot name', () => {
    const peers = [peer('a', 'Ace', 100), peer('z', 'ZBOT', 1)]
    expect(pickFollowTarget(peers, null, 'ZBOT')).toBe('z')
  })
})

describe('cycleFollowTarget', () => {
  const peers = [peer('a', 'A', 1), peer('b', 'B', 1), peer('c', 'C', 1)]
  it('advances forward with wrap', () => {
    expect(cycleFollowTarget(peers, 'a', 1)).toBe('b')
    expect(cycleFollowTarget(peers, 'c', 1)).toBe('a')
  })
  it('advances backward with wrap', () => {
    expect(cycleFollowTarget(peers, 'a', -1)).toBe('c')
  })
  it('starts at the first peer when current is absent/null', () => {
    expect(cycleFollowTarget(peers, null, 1)).toBe('a')
    expect(cycleFollowTarget(peers, 'gone', 1)).toBe('a')
  })
  it('returns currentId unchanged when there are no peers', () => {
    expect(cycleFollowTarget([], 'a', 1)).toBe('a')
  })
})
