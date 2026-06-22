import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  addCraftEngineGlowRig,
  buildCraft,
  capitalCarrierModelUrl,
  capitalModelUrl,
  collectCraftEngineGlows,
  craftModelUrl,
  craftModelTargetSizeForHolderVisual,
  craftModelUrlForHolderVisual,
  pirateModelUrl,
} from './shipyard'

describe('pirate model asset', () => {
  it('points player craft at their generated GLB assets', () => {
    expect(craftModelUrl('hauler')).toBe('/assets/ships/hauler.glb')
    expect(craftModelUrl('interceptor')).toBe('/assets/ships/interceptor.glb')
  })

  it('uses holder visual hulls only when selected and unlocked', () => {
    expect(craftModelUrlForHolderVisual('hauler', 'doge-runner', 0)).toBe('/assets/ships/hauler.glb')
    expect(craftModelUrlForHolderVisual('fighter', 'doge-runner', 1)).toBe('/assets/ships/fighter.glb')
    expect(craftModelUrlForHolderVisual('fighter', 'doge-runner', 2)).toBe('/assets/ships/holder-doge-runner.glb')
    expect(craftModelUrlForHolderVisual('hauler', 'void-interceptor', 2)).toBe('/assets/ships/hauler.glb')
    expect(craftModelUrlForHolderVisual('hauler', 'standard', 3)).toBe('/assets/ships/hauler.glb')
    expect(craftModelUrlForHolderVisual('fighter', 'void-interceptor', 3)).toBe('/assets/ships/holder-void-interceptor.glb')
  })

  it('scales the doge runner large enough to read as a prestige racing hull', () => {
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 0)).toBe(8.2)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 1)).toBe(8.2)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 2)).toBe(9.7)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'void-interceptor', 3)).toBe(10.5)
  })

  it('points pirates at their dedicated raider GLB', () => {
    expect(pirateModelUrl()).toBe('/assets/ships/pirate-raider.glb')
  })

  it('points the capital ship at its dedicated dreadnought GLB', () => {
    expect(capitalModelUrl()).toBe('/assets/ships/capital-dreadnought.glb')
  })

  it('points the carrier capital at its dedicated GLB', () => {
    expect(capitalCarrierModelUrl()).toBe('/assets/ships/capital-carrier.glb')
  })
})

describe('craft engine glow mounts', () => {
  it('tags procedural engine bells so holder bloom can animate without a trail object', () => {
    const fighter = buildCraft('fighter', 0x33aaff)
    const glows = collectCraftEngineGlows(fighter)

    expect(glows.filter((glow) => glow.role === 'disc')).toHaveLength(2)
    expect(glows.filter((glow) => glow.role === 'core')).toHaveLength(2)
  })

  it('can attach compact engine bells to loaded GLB hulls', () => {
    const group = new THREE.Group()
    addCraftEngineGlowRig(group, 'miner')

    const glows = collectCraftEngineGlows(group)
    expect(glows.filter((glow) => glow.role === 'disc')).toHaveLength(4)
    expect(glows.filter((glow) => glow.role === 'core')).toHaveLength(4)
  })
})
