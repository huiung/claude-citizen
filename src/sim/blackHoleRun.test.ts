import { describe, expect, it } from 'vitest'
import { createBlackHoleRun, enterRun, sampleRun, exitRunAlive, dieRun } from './blackHoleRun'

describe('blackHoleRun', () => {
  it('starts inactive with no minimum', () => {
    const run = createBlackHoleRun()
    expect(run.active).toBe(false)
    expect(run.min).toBe(Infinity)
  })

  it('enter starts the run and sample lowers the minimum only while active', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    expect(run.active).toBe(true)
    expect(run.min).toBe(40000)
    sampleRun(run, 30000)
    sampleRun(run, 35000) // higher — ignored
    expect(run.min).toBe(30000)
  })

  it('exitRunAlive submits the rounded min when the run reached the tidal gate, then resets', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    sampleRun(run, 9000.6) // inside TIDAL_RADIUS (18000)
    const submitted = exitRunAlive(run)
    expect(submitted).toBe(9001)
    expect(run.active).toBe(false)
    expect(run.min).toBe(Infinity)
  })

  it('exitRunAlive returns null (and resets) when the run never reached the gate', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    sampleRun(run, 22000) // still outside TIDAL_RADIUS
    expect(exitRunAlive(run)).toBeNull()
    expect(run.active).toBe(false)
  })

  it('dieRun discards the run with no submission and resets', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    sampleRun(run, 6000)
    dieRun(run)
    expect(run.active).toBe(false)
    expect(run.min).toBe(Infinity)
    expect(exitRunAlive(run)).toBeNull()
  })

  it('re-entry starts a fresh run', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    sampleRun(run, 7000)
    exitRunAlive(run)
    enterRun(run, 45000)
    expect(run.min).toBe(45000)
  })

  it('honors an explicit gate argument', () => {
    const run = createBlackHoleRun()
    enterRun(run, 40000)
    sampleRun(run, 5000)
    expect(exitRunAlive(run, 4000)).toBeNull() // 5000 not inside gate 4000
  })
})
