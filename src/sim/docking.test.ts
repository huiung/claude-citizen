import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { dockableTarget, DOCK_MAX_SPEED, DOCK_RANGE } from './docking'

const targets = [
  { id: 'a', position: new Vector3(0, 0, 0) },
  { id: 'b', position: new Vector3(1000, 0, 0) },
]

describe('dockableTarget', () => {
  it('returns null when too far from everything', () => {
    expect(dockableTarget(new Vector3(500, 0, 0), 0, targets)).toBeNull()
  })

  it('returns the outpost when in range and slow', () => {
    expect(dockableTarget(new Vector3(DOCK_RANGE - 1, 0, 0), 0, targets)).toBe('a')
  })

  it('returns null when in range but moving too fast', () => {
    expect(dockableTarget(new Vector3(10, 0, 0), DOCK_MAX_SPEED + 1, targets)).toBeNull()
  })

  it('allows docking right at the speed limit', () => {
    expect(dockableTarget(new Vector3(10, 0, 0), DOCK_MAX_SPEED, targets)).toBe('a')
  })

  it('picks the nearest when two are in range', () => {
    const near = [
      { id: 'a', position: new Vector3(0, 0, 0) },
      { id: 'b', position: new Vector3(150, 0, 0) },
    ]
    expect(dockableTarget(new Vector3(120, 0, 0), 0, near)).toBe('b')
  })
})
