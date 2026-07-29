import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeLandingEligibility, hullDeckOffset, LANDING_DECK_CLEARANCE, LANDING_MAX_ALT, LANDING_MAX_SPEED,
  landingReward,
} from './landing'

const PAD = new THREE.Vector3(0, 100, 0)
const UP = new THREE.Vector3(0, 1, 0)
const still = new THREE.Vector3()

describe('computeLandingEligibility', () => {
  it('accepts a slow ship hovering over the pad', () => {
    expect(computeLandingEligibility(new THREE.Vector3(10, 120, 5), still, PAD, UP, 45)).toBe(true)
  })

  it('rejects outside the pad radius, above the ceiling, below the deck, or too fast', () => {
    expect(computeLandingEligibility(new THREE.Vector3(60, 120, 0), still, PAD, UP, 45)).toBe(false)
    expect(computeLandingEligibility(new THREE.Vector3(0, 100 + LANDING_MAX_ALT + 1, 0), still, PAD, UP, 45)).toBe(false)
    expect(computeLandingEligibility(new THREE.Vector3(0, 90, 0), still, PAD, UP, 45)).toBe(false)
    const fast = new THREE.Vector3(LANDING_MAX_SPEED + 1, 0, 0)
    expect(computeLandingEligibility(new THREE.Vector3(0, 120, 0), fast, PAD, UP, 45)).toBe(false)
  })

  it('lateral distance is measured in the pad plane, not straight-line', () => {
    // 30u out + 30u up: straight-line 42.4 > pad radius 40, but lateral 30 < 40 → eligible
    expect(computeLandingEligibility(new THREE.Vector3(30, 130, 0), still, PAD, UP, 40)).toBe(true)
  })
})

describe('landingReward', () => {
  it('first visit pays big and bumps the collection count', () => {
    expect(landingReward('Seoul', new Set())).toEqual({ credits: 1500, first: true, count: 1 })
    expect(landingReward('Tokyo', new Set(['Seoul']))).toEqual({ credits: 1500, first: true, count: 2 })
  })

  it('revisit pays small and keeps the count', () => {
    expect(landingReward('Seoul', new Set(['Seoul']))).toEqual({ credits: 150, first: false, count: 1 })
  })
})

describe('hullDeckOffset', () => {
  const UP_IN_HULL = new THREE.Vector3(0, 1, 0) // hull parked upright: its +Y is the pad normal

  it('lifts a hull by exactly how far it hangs below its own origin', () => {
    // A hull whose lowest geometry is 1.4 below the origin must be parked 1.4 up, or it is buried.
    const min = new THREE.Vector3(-3, -1.4, -8)
    const max = new THREE.Vector3(3, 2.1, 8)
    expect(hullDeckOffset(min, max, UP_IN_HULL)).toBeCloseTo(1.4 + LANDING_DECK_CLEARANCE)
  })

  it('gives a flat hull a smaller offset than a tall one — the bug it exists for', () => {
    // The fixed 2.2 that this replaces was tuned on the hauler's landing gear. A fighter is flatter,
    // so the same number parked it in mid-air with clear sky under the fuselage.
    const tall = hullDeckOffset(new THREE.Vector3(-3, -2.2, -8), new THREE.Vector3(3, 2.2, 8), UP_IN_HULL)
    const flat = hullDeckOffset(new THREE.Vector3(-5, -0.5, -6), new THREE.Vector3(5, 0.9, 6), UP_IN_HULL)
    expect(flat).toBeLessThan(tall)
    expect(flat).toBeLessThan(1)
  })

  it('leaves a clearance rather than resting exactly on the deck face', () => {
    // Exactly 0 z-fights the belly against the deck along whichever face is flattest.
    const flush = hullDeckOffset(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1), UP_IN_HULL)
    expect(flush).toBe(LANDING_DECK_CLEARANCE)
    expect(flush).toBeGreaterThan(0)
  })

  it('never sinks a hull, whatever the box', () => {
    // A box that does not straddle the origin would otherwise produce a negative offset.
    const above = hullDeckOffset(new THREE.Vector3(-1, 3, -1), new THREE.Vector3(1, 5, 1), UP_IN_HULL)
    expect(above).toBeGreaterThanOrEqual(LANDING_DECK_CLEARANCE)
  })

  it('follows the attitude, not a world axis', () => {
    // A long thin hull parked nose-down hangs by its LENGTH, not its height. Getting this from the
    // world normal instead of the hull-frame one is how a rotated hull ends up half in the deck.
    const min = new THREE.Vector3(-1, -1, -9)
    const max = new THREE.Vector3(1, 1, 9)
    const upright = hullDeckOffset(min, max, new THREE.Vector3(0, 1, 0))
    const noseDown = hullDeckOffset(min, max, new THREE.Vector3(0, 0, 1))
    expect(upright).toBeCloseTo(1 + LANDING_DECK_CLEARANCE)
    expect(noseDown).toBeCloseTo(9 + LANDING_DECK_CLEARANCE)
  })

  it('handles an off-axis normal, as a pad on sloped terrain gives', () => {
    // Pads sit on a curved planet, so the normal is essentially never a hull axis. The answer is the
    // lowest BOX CORNER along that axis, which the separable form must reproduce.
    const min = new THREE.Vector3(-2, -1.5, -4)
    const max = new THREE.Vector3(2, 1.5, 4)
    const axis = new THREE.Vector3(0.3, 0.9, -0.32).normalize()
    let brute = Infinity
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) brute = Math.min(brute, new THREE.Vector3(x, y, z).dot(axis))
      }
    }
    expect(hullDeckOffset(min, max, axis)).toBeCloseTo(-brute + LANDING_DECK_CLEARANCE, 9)
  })
})
