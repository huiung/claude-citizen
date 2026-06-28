import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { chaseSteer, pickFollowTarget } from './camFollow'

describe('pickFollowTarget', () => {
  const targets = [
    { name: 'ACE', position: new Vector3(1, 0, 0) },
    { name: 'CLAUDE', position: new Vector3(2, 0, 0) },
  ]
  it('returns the target matching the name', () => {
    expect(pickFollowTarget(targets, 'CLAUDE')?.name).toBe('CLAUDE')
  })
  it('returns null when no target matches', () => {
    expect(pickFollowTarget(targets, 'NOBODY')).toBeNull()
    expect(pickFollowTarget([], 'CLAUDE')).toBeNull()
  })
  it('preserves the full payload so callers keep their mesh reference', () => {
    const mesh = { id: 'mesh-claude' }
    const meshTargets = [{ name: 'CLAUDE', mesh }]
    expect(pickFollowTarget(meshTargets, 'CLAUDE')?.mesh).toBe(mesh)
  })
})

describe('chaseSteer', () => {
  it('moves the drone toward a point `trail` units behind the target (on the drone side)', () => {
    const r = chaseSteer(new Vector3(1000, 0, 0), new Vector3(0, 0, 0), 100, 1, 200)
    expect(r.pos.x).toBeCloseTo(900, 3)
    expect(r.pos.length()).toBeGreaterThan(200)
  })
  it('settles at the trail distance without overshooting', () => {
    const r = chaseSteer(new Vector3(210, 0, 0), new Vector3(0, 0, 0), 100, 1, 200)
    expect(r.pos.x).toBeCloseTo(200, 3)
  })
  it('faces the target (-Z forward points from the new position toward the target)', () => {
    const r = chaseSteer(new Vector3(0, 0, 1000), new Vector3(0, 0, 0), 100, 1, 200)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(r.quat)
    expect(fwd.z).toBeCloseTo(-1, 2)
  })
  it('does not mutate its inputs', () => {
    const drone = new Vector3(5, 5, 5)
    chaseSteer(drone, new Vector3(0, 0, 0), 10, 1, 2)
    expect(drone).toEqual(new Vector3(5, 5, 5))
  })
})
