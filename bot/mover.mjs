import { Matrix4, Quaternion, Vector3 } from 'three'

const _up = new Vector3(0, 1, 0)

/**
 * Advance `pos` toward `dest` by `speed * dt`, clamped so it never overshoots. Returns a NEW
 * position, a quaternion facing the travel direction (-Z forward, Three.js convention), and an
 * `arrived` flag. Pure — does not mutate inputs.
 */
export function stepMover(pos, dest, speed, dt) {
  const p = pos.clone()
  const toDest = new Vector3().subVectors(dest, p)
  const dist = toDest.length()
  const step = speed * dt
  const dir = dist > 1e-6 ? toDest.clone().multiplyScalar(1 / dist) : new Vector3(0, 0, -1)
  p.addScaledVector(dir, Math.min(step, dist))
  const quat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), dir, _up))
  return { pos: p, quat, arrived: dist <= step }
}
