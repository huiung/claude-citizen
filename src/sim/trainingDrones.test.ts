import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  TRAINING_DRONE_COUNT,
  TRAINING_DRONE_DAMAGE,
  TRAINING_DRONE_FIRE_INTERVAL,
  TRAINING_DRONE_HULL,
  TRAINING_DRONE_FIRE_RANGE,
  TRAINING_DRONE_PROJECTILE_SPEED,
  TRAINING_DRONE_RADIUS,
  TRAINING_DRONE_STANDOFF,
  createTrainingDrones,
  stepTrainingDrone,
} from './trainingDrones'

describe('training drones', () => {
  it('creates a small non-lethal target group around the player', () => {
    const center = new Vector3(100, 20, -50)
    const drones = createTrainingDrones(center)

    expect(TRAINING_DRONE_HULL).toBe(30)
    expect(drones).toHaveLength(TRAINING_DRONE_COUNT)
    expect(drones.every((drone) => drone.health.max === TRAINING_DRONE_HULL)).toBe(true)
    expect(drones.every((drone) => drone.radius === TRAINING_DRONE_RADIUS)).toBe(true)
    expect(drones.every((drone) => drone.position.distanceTo(center) > 0)).toBe(true)
  })

  it('orbits the player near standoff distance instead of ramming', () => {
    const player = new Vector3(0, 0, 0)
    const [drone] = createTrainingDrones(player)
    drone.position.set(TRAINING_DRONE_STANDOFF, 0, 0)

    stepTrainingDrone(drone, player, 1)

    expect(drone.velocity.length()).toBeGreaterThan(0)
    expect(drone.position.distanceTo(player)).toBeGreaterThan(TRAINING_DRONE_STANDOFF * 0.75)
    expect(drone.position.distanceTo(player)).toBeLessThan(TRAINING_DRONE_STANDOFF * 1.25)
  })

  it('fires weak practice shots when the player is in range', () => {
    const player = new Vector3(0, 0, 0)
    const [drone] = createTrainingDrones(player)
    drone.position.set(TRAINING_DRONE_FIRE_RANGE * 0.5, 0, 0)

    const result = stepTrainingDrone(drone, player, 0.016)

    expect(result.fired).not.toBeNull()
    expect(result.fired?.faction).toBe('pirate')
    expect(result.fired?.damage).toBeLessThan(7)
  })

  it('leads shots toward a moving player', () => {
    const player = new Vector3(0, 0, 0)
    const [drone] = createTrainingDrones(player)
    drone.position.set(TRAINING_DRONE_FIRE_RANGE * 0.5, 0, 0)

    const result = stepTrainingDrone(drone, player, 0.016, new Vector3(0, 180, 0))

    expect(result.fired).not.toBeNull()
    expect(result.fired?.velocity.y).toBeGreaterThan(0)
  })

  it('uses visible pressure tuning without matching pirate lethality', () => {
    expect(TRAINING_DRONE_FIRE_RANGE).toBeGreaterThanOrEqual(1200)
    expect(TRAINING_DRONE_PROJECTILE_SPEED).toBeGreaterThanOrEqual(320)
    expect(TRAINING_DRONE_FIRE_INTERVAL).toBeLessThanOrEqual(1.1)
    expect(TRAINING_DRONE_DAMAGE).toBeLessThan(7)
  })
})
