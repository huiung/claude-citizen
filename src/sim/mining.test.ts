import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CARGO_CAPACITY, cargoFree, createEconomy } from './economy'
import {
  createAsteroidField, MINING_RANGE, MINING_YIELD, mineStep,
} from './mining'

const at = (x: number, y = 0, z = 0) => new Vector3(x, y, z)

describe('mining', () => {
  it('mines ORE from an in-range asteroid proportional to dt', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100 }])
    const econ = createEconomy()
    const r = mineStep(field, at(10), econ, 1, true)
    expect(r.inRange).toBe(true)
    expect(r.asteroid?.id).toBe('a')
    expect(r.mined).toBeCloseTo(MINING_YIELD * 1)
    expect(econ.cargo.ORE).toBeCloseTo(MINING_YIELD * 1)
    expect(field.asteroids[0].reserves).toBeCloseTo(100 - MINING_YIELD)
  })

  it('yield is proportional to dt', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100 }])
    const econ = createEconomy()
    mineStep(field, at(0), econ, 0.5, true)
    expect(econ.cargo.ORE).toBeCloseTo(MINING_YIELD * 0.5)
  })

  it('does nothing when out of range', () => {
    const field = createAsteroidField([{ id: 'a', position: at(MINING_RANGE + 1), reserves: 100 }])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 1, true)
    expect(r).toEqual({ asteroid: null, mined: 0, inRange: false })
    expect(econ.cargo.ORE).toBe(0)
    expect(field.asteroids[0].reserves).toBe(100)
  })

  it('mines at the exact range boundary', () => {
    const field = createAsteroidField([{ id: 'a', position: at(MINING_RANGE), reserves: 100 }])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 1, true)
    expect(r.inRange).toBe(true)
    expect(r.mined).toBeGreaterThan(0)
  })

  it('does nothing when inactive', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100 }])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 1, false)
    expect(r).toEqual({ asteroid: null, mined: 0, inRange: false })
    expect(econ.cargo.ORE).toBe(0)
    expect(field.asteroids[0].reserves).toBe(100)
  })

  it('does nothing for non-positive dt', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100 }])
    const econ = createEconomy()
    expect(mineStep(field, at(0), econ, 0, true).mined).toBe(0)
    expect(mineStep(field, at(0), econ, -1, true).mined).toBe(0)
    expect(econ.cargo.ORE).toBe(0)
  })

  it('depletes reserves to exactly zero and stops mining', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 3 }])
    const econ = createEconomy()
    // dt large enough to want more than reserves
    const r = mineStep(field, at(0), econ, 100, true)
    expect(r.mined).toBeCloseTo(3)
    expect(field.asteroids[0].reserves).toBeCloseTo(0)
    expect(econ.cargo.ORE).toBeCloseTo(3)
    // a now-empty asteroid is no longer in range/minable
    const r2 = mineStep(field, at(0), econ, 1, true)
    expect(r2).toEqual({ asteroid: null, mined: 0, inRange: false })
  })

  it('caps mined ORE at the cargo free space', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100000 }])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 100000, true)
    expect(r.mined).toBeCloseTo(CARGO_CAPACITY)
    expect(econ.cargo.ORE).toBeCloseTo(CARGO_CAPACITY)
    expect(cargoFree(econ)).toBeCloseTo(0)
    // full hold → further mining is a no-op (still in range though)
    const r2 = mineStep(field, at(0), econ, 1, true)
    expect(r2.inRange).toBe(true)
    expect(r2.mined).toBe(0)
  })

  it('cargo cap accounts for ORE already carried', () => {
    const field = createAsteroidField([{ id: 'a', position: at(0), reserves: 100000 }])
    const econ = createEconomy()
    econ.cargo.ORE = CARGO_CAPACITY - 5
    const r = mineStep(field, at(0), econ, 100000, true)
    expect(r.mined).toBeCloseTo(5)
    expect(cargoFree(econ)).toBeCloseTo(0)
  })

  it('targets the nearest in-range asteroid with reserves', () => {
    const field = createAsteroidField([
      { id: 'far', position: at(50), reserves: 100 },
      { id: 'near', position: at(5), reserves: 100 },
    ])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 1, true)
    expect(r.asteroid?.id).toBe('near')
  })

  it('skips depleted asteroids when choosing a target', () => {
    const field = createAsteroidField([
      { id: 'near-empty', position: at(5), reserves: 0 },
      { id: 'far-full', position: at(20), reserves: 100 },
    ])
    const econ = createEconomy()
    const r = mineStep(field, at(0), econ, 1, true)
    expect(r.asteroid?.id).toBe('far-full')
  })

  it('createAsteroidField clones positions (field owns its vectors)', () => {
    const p = at(1, 2, 3)
    const field = createAsteroidField([{ id: 'a', position: p, reserves: 10 }])
    p.set(999, 999, 999)
    expect(field.asteroids[0].position.x).toBe(1)
  })
})
