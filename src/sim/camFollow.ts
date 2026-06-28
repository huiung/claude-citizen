import { Matrix4, Quaternion, Vector3 } from 'three'

const _up = new Vector3(0, 1, 0)

/** First target whose name matches, or null. Generic so callers keep their full payload
 *  (e.g. the followed pilot's mesh) on the returned object, not just `{ name }`. */
export function pickFollowTarget<T extends { name: string }>(targets: T[], name: string): T | null {
  return targets.find((t) => t.name === name) ?? null
}

/**
 * Steer a camera drone toward a point `trail` units from `targetPos`, on the drone's current side
 * (so it settles behind whatever direction it approached from). Moves at most `speed * dt`, never
 * overshooting. Returns a NEW position and a quaternion facing the target (-Z forward). Pure.
 */
export function chaseSteer(
  dronePos: Vector3,
  targetPos: Vector3,
  speed: number,
  dt: number,
  trail: number,
): { pos: Vector3; quat: Quaternion } {
  const fromTarget = new Vector3().subVectors(dronePos, targetPos)
  const d = fromTarget.length()
  const side = d > 1e-6 ? fromTarget.multiplyScalar(1 / d) : new Vector3(0, 0, 1)
  const desired = targetPos.clone().addScaledVector(side, trail)
  const toDesired = new Vector3().subVectors(desired, dronePos)
  const gap = toDesired.length()
  const pos = dronePos.clone()
  if (gap > 1e-6) pos.addScaledVector(toDesired.multiplyScalar(1 / gap), Math.min(speed * dt, gap))
  const look = new Vector3().subVectors(targetPos, pos)
  const dir = look.lengthSq() > 1e-6 ? look.normalize() : new Vector3(0, 0, -1)
  const quat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), dir, _up))
  return { pos, quat }
}
