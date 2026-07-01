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
  it('ignores currentId — always returns the top pick (no stickiness clause)', () => {
    const peers = [peer('a', 'Ace', 100), peer('c', 'Nova', 250)]
    expect(pickFollowTarget(peers, 'a')).toBe('c') // 'a' is current but 'c' is more active → still 'c'
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
  it('stays put with a single peer (the common bot-only Browse case)', () => {
    expect(cycleFollowTarget([peer('a', 'A', 1)], 'a', 1)).toBe('a')
  })
})

import { describePilotActivity, type ActivityZone } from './spectate'

describe('describePilotActivity', () => {
  const zones: ActivityZone[] = [
    { label: 'diving the black hole', center: [1000, 0, 0], radius: 100 },
    { label: 'in the training arena', center: [0, 0, 0], radius: 50 },
  ]
  it('returns the label of the zone the position sits inside', () => {
    expect(describePilotActivity([1000, 0, 40], zones)).toBe('diving the black hole') // 40 < 100
    expect(describePilotActivity([0, 30, 0], zones)).toBe('in the training arena')      // 30 < 50
  })
  it('first matching zone wins on overlap (priority order)', () => {
    const overlap: ActivityZone[] = [
      { label: 'first', center: [0, 0, 0], radius: 100 },
      { label: 'second', center: [0, 0, 0], radius: 100 },
    ]
    expect(describePilotActivity([0, 0, 0], overlap)).toBe('first')
  })
  it('uses the fallback when no zone matches', () => {
    expect(describePilotActivity([9999, 9999, 9999], zones)).toBe('cruising deep space')
    expect(describePilotActivity([9999, 0, 0], zones, 'idle')).toBe('idle')
  })
  it('treats the radius as an inclusive boundary', () => {
    expect(describePilotActivity([50, 0, 0], [{ label: 'edge', center: [0, 0, 0], radius: 50 }])).toBe('edge')
  })
  it('falls back with an empty zone list', () => {
    expect(describePilotActivity([0, 0, 0], [])).toBe('cruising deep space')
  })
})
