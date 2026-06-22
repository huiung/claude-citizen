import { Vector3 } from 'three'
import { createHealth, type Health } from './combat'
import { spawnPositionAround } from './pirates'

export const TRAINING_DRONE_COUNT = 2
export const TRAINING_DRONE_HULL = 30
export const TRAINING_DRONE_SPEED = 105
export const TRAINING_DRONE_STANDOFF = 720
export const TRAINING_DRONE_RADIUS = 7

export interface TrainingDrone {
  id: string
  position: Vector3
  velocity: Vector3
  health: Health
  radius: number
  phase: number
}

export function createTrainingDrones(center: Vector3, count = TRAINING_DRONE_COUNT): TrainingDrone[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `training-drone-${index + 1}`,
    position: spawnPositionAround(center, TRAINING_DRONE_STANDOFF, index + 3),
    velocity: new Vector3(),
    health: createHealth(TRAINING_DRONE_HULL),
    radius: TRAINING_DRONE_RADIUS,
    phase: index * Math.PI,
  }))
}

const _toDrone = new Vector3()
const _radial = new Vector3()
const _tangent = new Vector3()
const _correction = new Vector3()

export function stepTrainingDrone(drone: TrainingDrone, playerPosition: Vector3, dt: number): void {
  _toDrone.subVectors(drone.position, playerPosition)
  const dist = _toDrone.length()
  if (dist < 1e-6) _toDrone.set(1, 0, 0)

  _radial.copy(_toDrone).normalize()
  _tangent.set(-_radial.z, 0.18 * Math.sin(drone.phase), _radial.x).normalize()
  const distanceError = dist - TRAINING_DRONE_STANDOFF
  _correction.copy(_radial).multiplyScalar(-Math.max(-0.55, Math.min(0.55, distanceError / TRAINING_DRONE_STANDOFF)))

  drone.phase += dt * 1.3
  drone.velocity.copy(_tangent).add(_correction).normalize().multiplyScalar(TRAINING_DRONE_SPEED)
  drone.position.addScaledVector(drone.velocity, dt)
}
