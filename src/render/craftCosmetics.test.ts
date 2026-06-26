// src/render/craftCosmetics.test.ts
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createShipCosmetics } from './craftCosmetics'
import { cosmeticStyle } from '../sim/cosmetics'

describe('createShipCosmetics', () => {
  it('attaches hull + aura to the ship group and a trail to the scene, then clears them', () => {
    const scene = new THREE.Scene()
    const ship = new THREE.Group()
    scene.add(ship)
    const cos = createShipCosmetics(ship, scene)

    cos.apply([
      cosmeticStyle('nebula-hull-kit', 'epic'),   // hull → child of ship
      cosmeticStyle('void-runner-kit', 'rare'),   // aura → child of ship
      cosmeticStyle('aurum-trail-kit', 'legendary'), // trail → child of scene
    ])
    expect(ship.children.length).toBe(2)
    expect(scene.children.some((o) => o.userData.cosmeticTrail === true)).toBe(true)

    cos.update(0.016, new THREE.Vector3(1, 2, 3)) // must not throw

    cos.apply([]) // unequip everything
    expect(ship.children.length).toBe(0)
    expect(scene.children.some((o) => o.userData.cosmeticTrail === true)).toBe(false)

    cos.dispose()
  })

  it('renders Comet Wake as a distinct long trail family', () => {
    const scene = new THREE.Scene()
    const ship = new THREE.Group()
    scene.add(ship)
    const cos = createShipCosmetics(ship, scene)

    cos.apply([cosmeticStyle('comet-wake-kit', 'epic')])

    const trail = scene.children.find((o) => o.userData.cosmeticTrailKind === 'comet') as THREE.Points | undefined
    expect(trail).toBeDefined()
    expect(trail!.geometry.getAttribute('position').count).toBeGreaterThan(48)
    expect((trail!.material as THREE.PointsMaterial).size).toBeLessThan(0.8)

    cos.dispose()
  })
})
