import { describe, expect, it } from 'vitest'
import { buildBlackHole } from './blackHole'
import { BLACK_HOLE_CENTER } from '../sim/blackHole'

describe('buildBlackHole', () => {
  it('builds a group at the center with a horizon + disk and updates without throwing', () => {
    const bh = buildBlackHole()
    expect(bh.group.position.distanceTo(BLACK_HOLE_CENTER)).toBe(0)
    expect(bh.group.children.length).toBeGreaterThanOrEqual(3)
    bh.update(0.016)
  })
})
