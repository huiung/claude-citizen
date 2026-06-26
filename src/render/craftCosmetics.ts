// src/render/craftCosmetics.ts
// Procedural, multiplayer-visible cosmetic effects for one ship. Visual only.
// trail: an additive Points stream trailing the ship in world space.
// hull:  a faint additive wireframe shell hugging the ship.
// aura:  a soft camera-facing glow sprite around the ship, gently pulsing (legendary cycles hue).
import * as THREE from 'three'
import type { CosmeticStyle } from '../sim/cosmetics'

const TRAIL_POINTS = 48
const COMET_RIBBON_SAMPLES = 52
const COMET_RIBBON_MAX_SUBSTEPS = 8
const COMET_RIBBON_SAMPLE_SPACING = 2.8

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
    size: 0.3 + style.intensity * 0.7,
    vertexColors: true,
    transparent: true,
    opacity: 0.5 + style.intensity * 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  points.userData.cosmeticTrail = true
  points.userData.cosmeticTrailKind = 'aurum'
  points.userData.cosmeticRecipeId = style.recipeId
  points.frustumCulled = false
  return points
}

function fillCometRibbonColors(attr: THREE.BufferAttribute, color: THREE.Color): void {
  const samples = attr.count / 3
  for (let i = 0; i < samples; i++) {
    const f = Math.pow(1 - i / Math.max(1, samples - 1), 2.25)
    const core = Math.pow(f, 0.74)
    const edge = f * 0.22
    attr.setXYZ(i * 3, color.r * edge, color.g * edge, color.b * edge)
    attr.setXYZ(i * 3 + 1, color.r * core, color.g * core, color.b * core)
    attr.setXYZ(i * 3 + 2, color.r * edge, color.g * edge, color.b * edge)
  }
  attr.needsUpdate = true
}

function buildCometRibbon(style: CosmeticStyle): THREE.Mesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COMET_RIBBON_SAMPLES * 3 * 3), 3))
  const colorAttr = new THREE.BufferAttribute(new Float32Array(COMET_RIBBON_SAMPLES * 3 * 3), 3)
  fillCometRibbonColors(colorAttr, new THREE.Color(style.color))
  geo.setAttribute('color', colorAttr)
  const indices: number[] = []
  for (let i = 0; i < COMET_RIBBON_SAMPLES - 1; i++) {
    const left = i * 3
    const center = left + 1
    const right = left + 2
    const nextLeft = left + 3
    const nextCenter = left + 4
    const nextRight = left + 5
    indices.push(
      left, nextLeft, center,
      center, nextLeft, nextCenter,
      center, nextCenter, right,
      right, nextCenter, nextRight,
    )
  }
  geo.setIndex(indices)
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.16 + style.intensity * 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const ribbon = new THREE.Mesh(geo, mat)
  ribbon.userData.cosmeticTrail = true
  ribbon.userData.cosmeticTrailKind = 'comet'
  ribbon.userData.cosmeticTrailSurface = 'ribbon'
  ribbon.userData.cosmeticRecipeId = style.recipeId
  ribbon.frustumCulled = false
  return ribbon
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
        if (style.recipeId === 'comet-wake-kit') {
          const ribbon = buildCometRibbon(style); scene.add(ribbon)
          const attr = ribbon.geometry.getAttribute('position') as THREE.BufferAttribute
          const colorAttr = ribbon.geometry.getAttribute('color') as THREE.BufferAttribute
          const centers = new Float32Array(COMET_RIBBON_SAMPLES * 3)
          const last = new THREE.Vector3()
          const sample = new THREE.Vector3()
          const tangent = new THREE.Vector3()
          const side = new THREE.Vector3()
          const worldUp = new THREE.Vector3(0, 1, 0)
          const altUp = new THREE.Vector3(0, 0, 1)
          let seeded = false

          const writeCenter = (index: number, value: THREE.Vector3): void => {
            const offset = index * 3
            centers[offset] = value.x
            centers[offset + 1] = value.y
            centers[offset + 2] = value.z
          }
          const pushCenter = (value: THREE.Vector3): void => {
            centers.copyWithin(3, 0, centers.length - 3)
            writeCenter(0, value)
          }
          const seedCenters = (value: THREE.Vector3): void => {
            for (let i = 0; i < COMET_RIBBON_SAMPLES; i++) writeCenter(i, value)
            last.copy(value)
            seeded = true
          }
          const redrawRibbon = (): void => {
            const baseWidth = 0.2 + style.intensity * 0.38
            for (let i = 0; i < COMET_RIBBON_SAMPLES; i++) {
              const offset = i * 3
              sample.set(centers[offset], centers[offset + 1], centers[offset + 2])
              const prevIndex = Math.max(0, i - 1)
              const nextIndex = Math.min(COMET_RIBBON_SAMPLES - 1, i + 1)
              const prevOffset = prevIndex * 3
              const nextOffset = nextIndex * 3
              tangent.set(
                centers[prevOffset] - centers[nextOffset],
                centers[prevOffset + 1] - centers[nextOffset + 1],
                centers[prevOffset + 2] - centers[nextOffset + 2],
              )
              if (tangent.lengthSq() < 0.0001) tangent.set(0, 0, -1)
              tangent.normalize()
              side.crossVectors(tangent, worldUp)
              if (side.lengthSq() < 0.0001) side.crossVectors(tangent, altUp)
              if (side.lengthSq() < 0.0001) side.set(1, 0, 0)
              side.normalize()
              const f = 1 - i / Math.max(1, COMET_RIBBON_SAMPLES - 1)
              const width = baseWidth * (0.04 + Math.pow(f, 0.78) * 0.96)
              attr.setXYZ(i * 3, sample.x - side.x * width, sample.y - side.y * width, sample.z - side.z * width)
              attr.setXYZ(i * 3 + 1, sample.x, sample.y, sample.z)
              attr.setXYZ(i * 3 + 2, sample.x + side.x * width, sample.y + side.y * width, sample.z + side.z * width)
            }
            attr.needsUpdate = true
          }

          effects.push({ object: ribbon, parent: scene, style, update(_dt, worldPos, t) {
            if (!seeded) seedCenters(worldPos)
            const distance = last.distanceTo(worldPos)
            const steps = THREE.MathUtils.clamp(
              Math.ceil(distance / COMET_RIBBON_SAMPLE_SPACING),
              1,
              COMET_RIBBON_MAX_SUBSTEPS,
            )
            for (let step = 1; step <= steps; step++) {
              sample.copy(last).lerp(worldPos, step / steps)
              pushCenter(sample)
            }
            last.copy(worldPos)
            redrawRibbon()
            if (style.legendary) fillCometRibbonColors(colorAttr, tmp.setHSL((t * 0.15) % 1, 0.85, 0.6))
          } })
        } else {
          const points = buildTrail(style); scene.add(points)
          const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute
          const colorAttr = points.geometry.getAttribute('color') as THREE.BufferAttribute
          let seeded = false
          effects.push({ object: points, parent: scene, style, update(_dt, worldPos, t) {
            if (!seeded) { for (let i = 0; i < attr.count; i++) attr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z); seeded = true }
            for (let i = attr.count - 1; i > 0; i--) attr.setXYZ(i, attr.getX(i - 1), attr.getY(i - 1), attr.getZ(i - 1))
            attr.setXYZ(0, worldPos.x, worldPos.y, worldPos.z)
            attr.needsUpdate = true
            if (style.legendary) fillTrailColors(colorAttr, tmp.setHSL((t * 0.15) % 1, 0.85, 0.6))
          } })
        }
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
