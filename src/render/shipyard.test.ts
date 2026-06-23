import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  addCraftEngineGlowRig,
  buildCraft,
  capitalCarrierModelUrl,
  capitalModelUrl,
  collectCraftEngineGlows,
  createCraftModelLoader,
  craftModelUrl,
  craftModelTargetSizeForHolderVisual,
  craftModelUrlForHolderVisual,
  pirateModelUrl,
  seasonHubModelUrl,
} from './shipyard'

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null
  root.traverse((child) => {
    if (!found && child instanceof THREE.Mesh) found = child
  })
  if (!found) throw new Error('expected a mesh')
  return found
}

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
    expect(craftModelUrlForHolderVisual('miner', 'sovereign-wraith', 2)).toBe('/assets/ships/miner.glb')
    expect(craftModelUrlForHolderVisual('miner', 'sovereign-wraith', 3)).toBe('/assets/ships/holder-sovereign-wraith.glb')
  })

  it('scales the doge runner large enough to read as a prestige racing hull', () => {
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 0)).toBe(8.2)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 1)).toBe(8.2)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'doge-runner', 2)).toBe(9.7)
    expect(craftModelTargetSizeForHolderVisual('fighter', 'void-interceptor', 3)).toBe(10.5)
    expect(craftModelTargetSizeForHolderVisual('miner', 'sovereign-wraith', 3)).toBe(12.2)
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

  it('points the Citizen Season 1 Hub landmark at its dedicated GLB', () => {
    expect(seasonHubModelUrl()).toBe('/assets/landmarks/citizen-season-1-hub.glb')
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

describe('generated craft model loading', () => {
  it('caches the normalized GLB source while returning independent scene instances', async () => {
    let loadCount = 0
    const source = new THREE.Group()
    source.add(new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0x88ccff }),
    ))
    const loadCraft = createCraftModelLoader(async () => {
      loadCount++
      return source
    })

    const first = await loadCraft('/assets/ships/test.glb', 8)
    const second = await loadCraft('/assets/ships/test.glb', 8)

    expect(loadCount).toBe(1)
    expect(first).not.toBe(second)
    const firstHull = firstMesh(first!)
    const secondHull = firstMesh(second!)
    expect(firstHull).not.toBe(secondHull)
    expect(firstHull.geometry).not.toBe(secondHull.geometry)
    expect(firstHull.material).not.toBe(secondHull.material)

    first!.position.x = 99
    expect(second!.position.x).toBe(0)
  })
})
