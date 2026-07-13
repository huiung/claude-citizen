import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeLandingEligibility, LANDING_MAX_ALT, LANDING_MAX_SPEED, landingReward } from './landing'

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
