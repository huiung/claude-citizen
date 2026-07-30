import { describe, expect, it } from 'vitest'
import { parseRcsDemand, parseStudioParams } from './shipStudioParams'

// Only the ?rcs parsing is covered here. The rest of parseStudioParams predates this file and is left
// alone rather than retro-fitted with tests that would not have been written for its own sake.

describe('parseRcsDemand', () => {
  it('reads the axis shorthand a capture shot list actually uses', () => {
    expect(parseRcsDemand('yaw')).toEqual({ pitch: 0, yaw: 1, roll: 0 })
    expect(parseRcsDemand('-yaw')).toEqual({ pitch: 0, yaw: -1, roll: 0 })
    expect(parseRcsDemand('PITCH')).toEqual({ pitch: 1, yaw: 0, roll: 0 })
    expect(parseRcsDemand('-roll')).toEqual({ pitch: 0, yaw: 0, roll: -1 })
  })

  it('reads an explicit triple and clamps each axis', () => {
    expect(parseRcsDemand('0.5,-0.25,0')).toEqual({ pitch: 0.5, yaw: -0.25, roll: 0 })
    expect(parseRcsDemand('9,-9,9')).toEqual({ pitch: 1, yaw: -1, roll: 1 })
  })

  it('treats absent, empty, malformed and all-zero alike as an idle hull', () => {
    // All-zero deliberately folds in with the failures: it renders the same frame as absent, so
    // accepting it would let a typo'd shot look like a deliberate control.
    for (const raw of [null, '', '   ', '1,2', 'sideways', '0,0,0', '0,-0,0']) {
      expect(parseRcsDemand(raw)).toBeNull()
    }
  })

  it('substitutes zero for one unreadable axis rather than dropping the whole shot', () => {
    expect(parseRcsDemand('nope,1,0')).toEqual({ pitch: 0, yaw: 1, roll: 0 })
  })
})

describe('parseStudioParams', () => {
  it('defaults to an idle hull and carries ?rcs through when given', () => {
    expect(parseStudioParams(new URLSearchParams('ship=hauler')).rcs).toBeNull()
    expect(parseStudioParams(new URLSearchParams('ship=hauler&rcs=-yaw')).rcs)
      .toEqual({ pitch: 0, yaw: -1, roll: 0 })
  })
})
