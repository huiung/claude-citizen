// src/render/craftCosmetics.ts
// Procedural, multiplayer-visible cosmetic effects for one ship. Visual only.
// trail: an additive Points stream trailing the ship in world space.
// hull:  an additive emissive shell hugging the ship.
// aura:  a soft additive glow sphere around the ship, pulsing (legendary cycles hue).
import * as THREE from 'three'
import type { CosmeticStyle } from '../sim/cosmetics'

const TRAIL_POINTS = 48

interface Effect {
  object: THREE.Object3D
  parent: THREE.Object3D
  style: CosmeticStyle
  update(dt: number, worldPos: THREE.Vector3, t: number): void
}

export interface ShipCosmetics {
  apply(styles: CosmeticStyle[]): void
  update(dt: number, worldPos: THREE.Vector3): void
  dispose(): void
}

function buildHull(style: CosmeticStyle): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1.7 + style.intensity * 0.5, 1)
  const mat = new THREE.MeshBasicMaterial({
    color: style.color, transparent: true, opacity: 0.1 + style.intensity * 0.22,
    blending: THREE.AdditiveBlending, wireframe: true, depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.cosmeticHull = true
  return mesh
}

function buildAura(style: CosmeticStyle): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2.4 + style.intensity * 1.1, 16, 12)
  const mat = new THREE.MeshBasicMaterial({
    color: style.color, transparent: true, opacity: 0.06 + style.intensity * 0.16,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.cosmeticAura = true
  return mesh
}

function buildTrail(style: CosmeticStyle): THREE.Points {
  const positions = new Float32Array(TRAIL_POINTS * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: style.color, size: 0.5 + style.intensity * 1.4, transparent: true,
    opacity: 0.35 + style.intensity * 0.5, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  points.userData.cosmeticTrail = true
  points.frustumCulled = false
  return points
}

export function createShipCosmetics(shipGroup: THREE.Group, scene: THREE.Scene): ShipCosmetics {
  let effects: Effect[] = []
  const tmp = new THREE.Color()

  function clear(): void {
    for (const e of effects) {
      e.parent.remove(e.object)
      const obj = e.object as THREE.Mesh | THREE.Points
      ;(obj.geometry as THREE.BufferGeometry | undefined)?.dispose?.()
      const m = obj.material as THREE.Material | undefined
      m?.dispose?.()
    }
    effects = []
  }

  function apply(styles: CosmeticStyle[]): void {
    clear()
    for (const style of styles) {
      if (style.category === 'hull') {
        const object = buildHull(style); shipGroup.add(object)
        effects.push({ object, parent: shipGroup, style, update(_dt, _w, t) {
          object.rotation.y = t * 0.4
          if (style.legendary) (object.material as THREE.MeshBasicMaterial).color.setHSL((t * 0.1) % 1, 0.8, 0.6)
        } })
      } else if (style.category === 'aura') {
        const object = buildAura(style); shipGroup.add(object)
        effects.push({ object, parent: shipGroup, style, update(_dt, _w, t) {
          const pulse = 1 + Math.sin(t * 2) * 0.06 * (0.5 + style.intensity)
          object.scale.setScalar(pulse)
          if (style.legendary) (object.material as THREE.MeshBasicMaterial).color.setHSL((t * 0.12) % 1, 0.85, 0.6)
        } })
      } else { // trail — lives in the scene, follows the ship in world space
        const points = buildTrail(style); scene.add(points)
        const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute
        let seeded = false
        effects.push({ object: points, parent: scene, style, update(_dt, worldPos, t) {
          if (!seeded) { for (let i = 0; i < TRAIL_POINTS; i++) attr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z); seeded = true }
          for (let i = TRAIL_POINTS - 1; i > 0; i--) attr.setXYZ(i, attr.getX(i - 1), attr.getY(i - 1), attr.getZ(i - 1))
          attr.setXYZ(0, worldPos.x, worldPos.y, worldPos.z)
          attr.needsUpdate = true
          if (style.legendary) (points.material as THREE.PointsMaterial).color.copy(tmp.setHSL((t * 0.15) % 1, 0.85, 0.6))
        } })
      }
    }
  }

  function update(dt: number, worldPos: THREE.Vector3): void {
    const t = performanceNow() * 0.001
    for (const e of effects) e.update(dt, worldPos, t)
  }

  function dispose(): void { clear() }
  return { apply, update, dispose }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}
