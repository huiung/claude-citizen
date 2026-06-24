// src/render/craftCosmetics.ts
// Procedural, multiplayer-visible cosmetic effects for one ship. Visual only.
// trail: an additive Points stream trailing the ship in world space.
// hull:  a faint additive wireframe shell hugging the ship.
// aura:  a soft camera-facing glow sprite around the ship, gently pulsing (legendary cycles hue).
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

// One shared soft radial-gradient texture for all aura sprites. Created lazily; null in
// non-DOM (test) environments — the sprite still attaches, it just renders without a map there.
let glowTexture: THREE.Texture | null | undefined
function softGlowTexture(): THREE.Texture | null {
  if (glowTexture !== undefined) return glowTexture
  if (typeof document === 'undefined') return (glowTexture = null)
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return (glowTexture = null)
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

function buildHull(style: CosmeticStyle): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1.7 + style.intensity * 0.5, 1)
  const mat = new THREE.MeshBasicMaterial({
    color: style.color, transparent: true, opacity: 0.04 + style.intensity * 0.1,
    blending: THREE.AdditiveBlending, wireframe: true, depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.cosmeticHull = true
  return mesh
}

function buildAura(style: CosmeticStyle): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: softGlowTexture() ?? undefined,
    color: style.color, transparent: true,
    opacity: 0.1 + style.intensity * 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(5 + style.intensity * 4)
  sprite.userData.cosmeticAura = true
  return sprite
}

// Fade the trail head→tail toward black so additive blending makes the tail vanish — turns a
// uniform dot cloud (scattered at boost speed) into a directional, tapering comet streak.
function fillTrailColors(attr: THREE.BufferAttribute, color: THREE.Color): void {
  const n = attr.count
  for (let i = 0; i < n; i++) {
    const f = Math.pow(1 - i / (n - 1), 1.8)
    attr.setXYZ(i, color.r * f, color.g * f, color.b * f)
  }
  attr.needsUpdate = true
}

function buildTrail(style: CosmeticStyle): THREE.Points {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3))
  const colorAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3)
  fillTrailColors(colorAttr, new THREE.Color(style.color))
  geo.setAttribute('color', colorAttr)
  const mat = new THREE.PointsMaterial({
    size: 0.3 + style.intensity * 0.7, vertexColors: true, transparent: true,
    opacity: 0.5 + style.intensity * 0.4, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
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
      m?.dispose?.() // shared aura glow texture is intentionally NOT disposed here
    }
    effects = []
  }

  function apply(styles: CosmeticStyle[]): void {
    clear()
    for (const style of styles) {
      if (style.category === 'hull') {
        const object = buildHull(style); shipGroup.add(object)
        effects.push({ object, parent: shipGroup, style, update(_dt, _w, t) {
          object.rotation.y = t * 0.15
          if (style.legendary) (object.material as THREE.MeshBasicMaterial).color.setHSL((t * 0.08) % 1, 0.7, 0.6)
        } })
      } else if (style.category === 'aura') {
        const object = buildAura(style); shipGroup.add(object)
        const base = object.scale.x
        effects.push({ object, parent: shipGroup, style, update(_dt, _w, t) {
          const pulse = 1 + Math.sin(t * 1.6) * 0.05 * (0.5 + style.intensity)
          object.scale.setScalar(base * pulse)
          if (style.legendary) (object.material as THREE.SpriteMaterial).color.setHSL((t * 0.12) % 1, 0.78, 0.62)
        } })
      } else { // trail — lives in the scene, follows the ship in world space
        const points = buildTrail(style); scene.add(points)
        const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute
        const colorAttr = points.geometry.getAttribute('color') as THREE.BufferAttribute
        let seeded = false
        effects.push({ object: points, parent: scene, style, update(_dt, worldPos, t) {
          if (!seeded) { for (let i = 0; i < TRAIL_POINTS; i++) attr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z); seeded = true }
          for (let i = TRAIL_POINTS - 1; i > 0; i--) attr.setXYZ(i, attr.getX(i - 1), attr.getY(i - 1), attr.getZ(i - 1))
          attr.setXYZ(0, worldPos.x, worldPos.y, worldPos.z)
          attr.needsUpdate = true
          if (style.legendary) fillTrailColors(colorAttr, tmp.setHSL((t * 0.15) % 1, 0.85, 0.6))
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
