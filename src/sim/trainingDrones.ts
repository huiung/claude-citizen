import { Vector3 } from 'three'
import {
  createHealth,
  createWeapon,
  type Health,
  type Projectile,
  spawnProjectile,
  type Weapon,
} from './combat'
import { spawnPositionAround } from './pirates'

export const TRAINING_DRONE_COUNT = 2
export const TRAINING_DRONE_HULL = 50
export const TRAINING_DRONE_SPEED = 105
export const TRAINING_DRONE_STANDOFF = 720
export const TRAINING_DRONE_RADIUS = 7
export const TRAINING_DRONE_FIRE_RANGE = 1300
export const TRAINING_DRONE_FIRE_INTERVAL = 1.0
export const TRAINING_DRONE_PROJECTILE_SPEED = 340
export const TRAINING_DRONE_DAMAGE = 6

export interface TrainingDrone {
  id: string
  position: Vector3
  velocity: Vector3
  health: Health
  weapon: Weapon
  radius: number
  phase: number
}

export interface TrainingDroneStepResult {
  fired: Projectile | null
}

export function createTrainingDrones(center: Vector3, count = TRAINING_DRONE_COUNT): TrainingDrone[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `training-drone-${index + 1}`,
    position: spawnPositionAround(center, TRAINING_DRONE_STANDOFF, index + 3),
    velocity: new Vector3(),
    health: createHealth(TRAINING_DRONE_HULL),
    weapon: createWeapon(TRAINING_DRONE_FIRE_INTERVAL),
    radius: TRAINING_DRONE_RADIUS,
    phase: index * Math.PI,
  }))
}

const _toDrone = new Vector3()
const _radial = new Vector3()
const _tangent = new Vector3()
const _correction = new Vector3()
const _toPlayer = new Vector3()
const _leadTarget = new Vector3()

export function stepTrainingDrone(
  drone: TrainingDrone,
  playerPosition: Vector3,
  dt: number,
  playerVelocity = new Vector3(),
): TrainingDroneStepResult {
  drone.weapon.cooldown = Math.max(0, drone.weapon.cooldown - dt)

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

  let fired: Projectile | null = null
  if (dist <= TRAINING_DRONE_FIRE_RANGE && drone.weapon.cooldown <= 0) {
    const leadTime = Math.max(0.12, Math.min(1.15, dist / TRAINING_DRONE_PROJECTILE_SPEED))
    _leadTarget.copy(playerPosition).addScaledVector(playerVelocity, leadTime)
    _toPlayer.subVectors(_leadTarget, drone.position)
    fired = spawnProjectile(
      drone.position,
      _toPlayer,
      'pirate',
      TRAINING_DRONE_PROJECTILE_SPEED,
      TRAINING_DRONE_DAMAGE,
      drone.velocity,
    )
    drone.weapon.cooldown = drone.weapon.interval
  }

  return { fired }
}
