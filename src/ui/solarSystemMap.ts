import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { type Celestial } from '../sim/galaxy'
import { PLANETS, SUN_COLOR, SUN_POSITION, SUN_RADIUS } from '../sim/solarSystem'

export interface SolarMapRemote {
  id: string
  name: string
  color: number
  position: THREE.Vector3
  velocity?: THREE.Vector3
  ageMs?: number
}

export interface SolarMapNavigationTarget {
  id: string
  name: string
  kind: string
  worldPosition: THREE.Vector3
  radius?: number
}

export interface SolarMapSnapshot {
  playerPosition: THREE.Vector3
  playerQuaternion: THREE.Quaternion
  nearbyCelestials: Celestial[]
  remotes: SolarMapRemote[]
  selectedDestinationName: string
  activeDestination?: SolarMapNavigationTarget | null
}

export type SolarMapDestinationResult = { ok: boolean; reason?: string }

interface SolarMapEntity extends SolarMapNavigationTarget {
  distance: number
  speed?: number
  ageMs?: number
  note?: string
  targetable: boolean
  chartable?: boolean
}

interface PreviewRoute {
  id: string
  target: SolarMapNavigationTarget
  color: number
  createdAt: number
  updatedAt: number
  stale: boolean
}

interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

type SolarMapLayerKey = 'orbits' | 'routes' | 'labels' | 'backdrop' | 'contacts'
type SolarMapLayers = Record<SolarMapLayerKey, boolean>

const LAYER_DEFS: ReadonlyArray<{ key: SolarMapLayerKey; label: string }> = [
  { key: 'orbits', label: 'Orbits' },
  { key: 'routes', label: 'Routes' },
  { key: 'labels', label: 'Labels' },
  { key: 'backdrop', label: 'Backdrop' },
  { key: 'contacts', label: 'Pilots' },
]

const DEFAULT_LAYERS: SolarMapLayers = {
  orbits: true,
  routes: true,
  labels: true,
  backdrop: true,
  contacts: true,
}

const POSITION_SCALE = 1 / 2500
const MAX_PROCEDURAL_BODIES = 52
const MAX_RENDERED_PEERS = 32
const REMOTE_TRAIL_SECONDS = 24
const REMOTE_TRAIL_POINTS = 14
const REGION_PICK_LIMIT = 155
const MAX_ATLAS_LABELS = 8
const MAX_PREVIEW_ROUTES = 6
const PREVIEW_STALE_MS = 30_000
const PREVIEW_ROUTE_COLORS = [0xffb15f, 0x6ee7ff, 0xd6a8ff, 0xff7fa3, 0xf4e66a, 0x82f0b5]
const ORBIT_TRACK_SEGMENTS = 192

const PLANET_NOTES: Record<string, string> = {
  Earth: 'Familiar blue-world reference mass. Good for navigation calibration and the most legible system-scale landmark from spawn.',
  Venus: 'Dense amber atmosphere and high-albedo cloud cover. Use its bright disk as an inner-system bearing marker.',
  Mercury: 'Small rocky inner-world with low visual profile. Close to the sun, so approach vectors can be glare-heavy.',
  Mars: 'Rust-colored outer terrestrial waypoint. Useful for long baseline route checks across the named system.',
  Jupiter: 'Largest gas giant in the atlas. Its scale makes it a strong orientation anchor and a safer long-range visual target.',
  Saturn: 'Ringed gas giant. The ring plane makes approach angle obvious and helps show the atlas depth axis.',
}

const scratchColor = new THREE.Color()
const scratchVector = new THREE.Vector3()
const scratchVectorB = new THREE.Vector3()

interface RemoteTrailPoint {
  position: THREE.Vector3
  at: number
}

function seededUnit(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453123
  return x - Math.floor(x)
}

function formatDistance(units: number): string {
  const n = Math.abs(units)
  if (n >= 1_000_000) return `${(units / 1_000_000).toFixed(2)} Mm`
  if (n >= 1000) return `${(units / 1000).toFixed(1)} km`
  return `${Math.round(units)} m`
}

function formatCoord(n: number): string {
  return Math.round(n).toLocaleString()
}

function formatAge(ageMs: number): string {
  if (ageMs < 1000) return 'live'
  return `${(ageMs / 1000).toFixed(1)}s ago`
}

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] ?? c)
}

function shortId(id: string): string {
  const parts = id.split('.')
  return parts.slice(Math.max(0, parts.length - 3)).join('.')
}

function mapPosition(worldPosition: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
  return worldPosition.clone().sub(origin).multiplyScalar(POSITION_SCALE)
}

function worldFromMapPosition(mapLocalPosition: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
  return mapLocalPosition.clone().multiplyScalar(1 / POSITION_SCALE).add(origin)
}

function planetOrbitRadius(position: THREE.Vector3): number {
  return position.distanceTo(SUN_POSITION)
}

function buildPlanetOrbitPoints(position: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3[] {
  const radial = position.clone().sub(SUN_POSITION)
  const orbitRadius = radial.length()
  if (orbitRadius <= 1e-6) return [mapPosition(SUN_POSITION, origin)]

  const axisU = radial.clone().normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const axisNormal = up.sub(axisU.clone().multiplyScalar(up.dot(axisU)))
  if (axisNormal.lengthSq() <= 1e-6) axisNormal.set(0, 0, 1)
  axisNormal.normalize()
  const axisV = new THREE.Vector3().crossVectors(axisNormal, axisU).normalize()
  const points: THREE.Vector3[] = []
  for (let i = 0; i < ORBIT_TRACK_SEGMENTS; i++) {
    const t = (i / ORBIT_TRACK_SEGMENTS) * Math.PI * 2
    const world = SUN_POSITION.clone()
      .add(axisU.clone().multiplyScalar(Math.cos(t) * orbitRadius))
      .add(axisV.clone().multiplyScalar(Math.sin(t) * orbitRadius))
    points.push(mapPosition(world, origin))
  }
  return points
}

function visualRadius(worldRadius: number, min: number, max: number): number {
  return THREE.MathUtils.clamp(Math.cbrt(Math.max(1, worldRadius)) * 0.15, min, max)
}

function distanceToSegment(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  scratchVector.copy(b).sub(a)
  const lenSq = scratchVector.lengthSq()
  if (lenSq <= 1e-6) return point.distanceTo(a)
  const t = THREE.MathUtils.clamp(scratchVectorB.copy(point).sub(a).dot(scratchVector) / lenSq, 0, 1)
  return scratchVector.multiplyScalar(t).add(a).distanceTo(point)
}

function distanceToScreenSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 1e-6) {
    const ox = px - ax
    const oy = py - ay
    return ox * ox + oy * oy
  }
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  const sx = ax + dx * t
  const sy = ay + dy * t
  const ox = px - sx
  const oy = py - sy
  return ox * ox + oy * oy
}

function atlasSurfaceColor(base: number, surface: string, seed: number, normal: THREE.Vector3, out: THREE.Color): THREE.Color {
  const n = (
    Math.sin(normal.x * 4.1 + seed * 0.01) * 0.38 +
    Math.cos(normal.y * 7.4 + seed * 0.017) * 0.27 +
    Math.sin(normal.z * 11.2 + seed * 0.023) * 0.2
  ) * 0.5 + 0.5
  const polar = Math.abs(normal.y)
  if (surface === 'earth') {
    if (n < 0.48) out.setRGB(0.04, 0.19, 0.39).lerp(scratchColor.setRGB(0.07, 0.37, 0.56), n)
    else out.setRGB(0.14, 0.38, 0.2).lerp(scratchColor.setRGB(0.58, 0.49, 0.31), (n - 0.48) * 1.9)
    if (polar > 0.82) out.setRGB(0.86, 0.9, 0.92)
    return out
  }
  if (surface === 'gas') {
    const band = Math.sin(normal.y * 15 + n * 2.6) * 0.5 + 0.5
    return out.set(base).lerp(scratchColor.setRGB(0.9, 0.8, 0.62), band * 0.58)
  }
  if (surface === 'mars') {
    if (polar > 0.86) return out.setRGB(0.78, 0.75, 0.68)
    return out.setRGB(0.42, 0.14, 0.09).lerp(scratchColor.setRGB(0.83, 0.36, 0.2), n)
  }
  if (surface === 'venus') return out.setRGB(0.54, 0.35, 0.16).lerp(scratchColor.setRGB(0.95, 0.72, 0.36), n)
  return out.set(base).lerp(scratchColor.setRGB(0.72, 0.68, 0.61), n * 0.45)
}

function buildAtlasPlanetGeometry(radius: number, color: number, surface: string, seed: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(radius, 42, 24)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const n = new THREE.Vector3()
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize()
    atlasSurfaceColor(color, surface, seed, n, c)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
    if (surface !== 'gas') {
      const relief = 1 + (seededUnit(i, seed) - 0.5) * 0.026
      pos.setXYZ(i, n.x * radius * relief, n.y * radius * relief, n.z * radius * relief)
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

function buildGlowMaterial(color: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      opacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float rim = pow(1.0 - abs(dot(vNormal, viewDir)), 2.15);
        gl_FragColor = vec4(glowColor, rim * opacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  })
}

function buildSunSurfaceMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      hotColor: { value: new THREE.Color(color) },
      coreColor: { value: new THREE.Color(0xffffff) },
      limbColor: { value: new THREE.Color(0xff9f3b) },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 hotColor;
      uniform vec3 coreColor;
      uniform vec3 limbColor;
      uniform float time;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float wave(vec3 p, float f, float s) {
        return sin(p.x * f + time * s) * 0.33 + sin(p.y * (f * 1.37) - time * s * 0.8) * 0.33 + sin(p.z * (f * 0.71) + time * s * 1.3) * 0.33;
      }

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float facing = clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
        float limb = pow(1.0 - facing, 2.2);
        float plasma = wave(normalize(vWorldPosition) * 1.7, 11.0, 0.55) * 0.5 + 0.5;
        vec3 color = mix(hotColor, coreColor, 0.32 + plasma * 0.18);
        color = mix(color, limbColor, limb * 0.56);
        float intensity = 0.98 + plasma * 0.34 + limb * 0.22;
        gl_FragColor = vec4(color * intensity, 1.0);
      }
    `,
    toneMapped: false,
  })
}

function buildStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      exposure: { value: 1.0 },
    },
    vertexShader: `
      attribute float size;
      attribute float twinkle;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vTwinkle = twinkle;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (260.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float exposure;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.5, 0.03, d);
        float halo = smoothstep(0.5, 0.18, d) * 0.34;
        float alpha = clamp(core + halo, 0.0, 1.0);
        gl_FragColor = vec4(vColor * exposure * (1.0 + vTwinkle), alpha);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
}

function createRadialTexture(inner: string, middle: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.28, middle)
  gradient.addColorStop(1, outer)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function injectSolarMapStyles(): void {
  if (document.getElementById('solar-map-style')) return
  const style = document.createElement('style')
  style.id = 'solar-map-style'
  style.textContent = `
    #solar-map {
      position: fixed; inset: 0; z-index: 60; overflow: hidden;
      background:
        radial-gradient(circle at 50% 50%, rgba(22, 45, 58, .22), transparent 42%),
        radial-gradient(circle at 82% 16%, rgba(68, 116, 132, .12), transparent 30%),
        #000208;
      color: #d7ffe7;
      font-family: "Share Tech Mono", "SF Mono", Consolas, ui-monospace, monospace;
    }
    #solar-map[hidden] { display: none; }
    .solar-map-canvas { position: absolute; inset: 0; overflow: hidden; }
    .solar-map-canvas canvas { display: block; width: 100%; height: 100%; }
    .solar-map-head {
      position: absolute; left: 18px; right: 18px; top: 16px; z-index: 3;
      display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
      pointer-events: none;
    }
    .solar-map-head-actions {
      display: flex; align-items: center; gap: 8px; pointer-events: auto;
    }
    .solar-map-title {
      font-family: "Orbitron", "Share Tech Mono", sans-serif; font-size: 18px; letter-spacing: 3px;
      color: #f2fff7; text-shadow: 0 0 18px rgba(120, 255, 180, .32);
    }
    .solar-map-sub { margin-top: 5px; font-size: 11px; color: rgba(215, 255, 231, .72); letter-spacing: .8px; }
    .solar-map-ui-toggle {
      pointer-events: auto; min-width: 70px; height: 34px; padding: 0 10px; border-radius: 8px; cursor: pointer;
      border: 1px solid rgba(174, 233, 255, .28); background: rgba(3, 14, 20, .7);
      color: #d7ffe7; font: 10px/1 "Share Tech Mono", ui-monospace, monospace;
      letter-spacing: .9px; text-transform: uppercase;
    }
    .solar-map-ui-toggle:hover { background: rgba(16, 45, 58, .78); border-color: rgba(174, 233, 255, .5); }
    .solar-map-close {
      pointer-events: auto; width: 38px; height: 34px; border-radius: 8px; cursor: pointer;
      border: 1px solid rgba(159, 255, 176, .35); background: rgba(4, 18, 12, .72);
      color: #d7ffe7; font: 18px/1 "Share Tech Mono", ui-monospace, monospace;
    }
    .solar-map-close:hover { background: rgba(24, 70, 42, .78); }
    .solar-map-panel {
      position: absolute; right: 18px; top: 76px; width: 330px; max-width: calc(100vw - 36px); z-index: 3;
      max-height: calc(100vh - 228px); overflow: auto;
      border: 1px solid rgba(174, 233, 255, .2); border-radius: 8px;
      background: linear-gradient(180deg, rgba(3, 12, 18, .82), rgba(2, 7, 12, .68));
      box-shadow: 0 0 48px rgba(20, 72, 96, .22);
      padding: 13px 14px; backdrop-filter: blur(12px);
    }
    .solar-map-panel h2 {
      margin: 0 0 9px; font-size: 13px; letter-spacing: 2px; color: #f2fff7; font-weight: 600;
    }
    .solar-map-row {
      display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
      padding: 6px 0; border-top: 1px solid rgba(159, 255, 176, .12);
      font-size: 11px; color: rgba(215, 255, 231, .66);
    }
    .solar-map-row b { color: #d7ffe7; font-weight: 600; text-align: right; }
    .solar-map-row-stack { display: block; }
    .solar-map-row-stack b { display: block; margin-top: 4px; text-align: left; line-height: 1.35; color: rgba(215, 255, 231, .86); }
    .solar-map-note {
      margin-top: 10px; color: rgba(174, 233, 255, .8); font-size: 11px; line-height: 1.55;
    }
    .solar-map-strip {
      position: absolute; left: 18px; top: 74px; z-index: 3; display: flex; flex-wrap: wrap; gap: 8px;
      color: rgba(215, 255, 231, .64); font-size: 10px; letter-spacing: 1px; pointer-events: none;
      max-width: min(700px, calc(100vw - 390px));
    }
    .solar-map-chip {
      border: 1px solid rgba(174, 233, 255, .15); border-radius: 999px;
      background: rgba(2, 12, 18, .52); padding: 6px 9px;
    }
    .solar-map-toolbar {
      position: absolute; left: 18px; bottom: 18px; z-index: 4; width: min(620px, calc(100vw - 396px));
      border: 1px solid rgba(174, 233, 255, .2); border-radius: 8px;
      background: linear-gradient(180deg, rgba(3, 12, 18, .82), rgba(2, 7, 12, .68));
      backdrop-filter: blur(12px);
      padding: 10px; color: rgba(215, 255, 231, .76); pointer-events: auto;
      box-shadow: 0 0 46px rgba(20, 72, 96, .18);
    }
    .solar-map-toolbar-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px;
    }
    .solar-map-toolbar-title {
      color: #f2fff7; font-size: 10px; font-weight: 600; letter-spacing: 2px;
    }
    .solar-map-inputs {
      display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end;
      color: rgba(174, 233, 255, .68); font-size: 10px; letter-spacing: .7px;
    }
    .solar-map-inputs b { color: #e9fff3; font-weight: 600; }
    .solar-map-toolbar-body {
      display: grid; grid-template-columns: minmax(190px, .74fr) minmax(230px, 1.26fr); gap: 10px; align-items: start;
    }
    .solar-map-actions {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
    }
    .solar-map-toolbar button {
      min-height: 30px; border-radius: 6px; border: 1px solid rgba(159, 255, 176, .22);
      background: rgba(4, 18, 20, .76); color: #d7ffe7; font: 10px/1.1 "Share Tech Mono", ui-monospace, monospace;
      letter-spacing: .9px; cursor: pointer; text-transform: uppercase;
    }
    .solar-map-toolbar button:hover:not(:disabled) { border-color: rgba(174, 233, 255, .55); background: rgba(18, 48, 58, .78); }
    .solar-map-toolbar button:disabled { opacity: .42; cursor: default; }
    .solar-map-layer-controls {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
      padding-top: 8px; border-top: 1px solid rgba(174, 233, 255, .12);
    }
    .solar-map-layer-controls button {
      min-height: 25px; padding: 0 9px; flex: 1 1 auto; min-width: 72px;
      color: rgba(215, 255, 231, .66); border-color: rgba(174, 233, 255, .18);
      background: rgba(2, 10, 16, .55);
    }
    .solar-map-layer-controls button[aria-pressed="true"] {
      color: #f2fff7; border-color: rgba(159, 255, 176, .46);
      background: linear-gradient(180deg, rgba(26, 72, 56, .72), rgba(5, 24, 24, .72));
      box-shadow: inset 0 0 12px rgba(159, 255, 176, .09);
    }
    .solar-map-status {
      min-height: 15px; margin-top: 8px; color: rgba(174, 233, 255, .78); font-size: 10px; letter-spacing: .7px;
    }
    .solar-map-preview-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      color: #f2fff7; font-size: 10px; letter-spacing: 1.7px; margin-bottom: 7px;
    }
    .solar-map-preview-head button {
      min-height: 24px; padding: 0 8px; color: rgba(215, 255, 231, .82);
    }
    .solar-map-preview-list {
      display: grid; gap: 5px; max-height: 104px; overflow: auto; padding-right: 2px;
    }
    .solar-map-contact-head {
      margin: 9px 0 6px; padding-top: 8px; border-top: 1px solid rgba(174, 233, 255, .12);
      color: #f2fff7; font-size: 10px; letter-spacing: 1.7px;
    }
    .solar-map-contact-list {
      display: grid; gap: 5px; max-height: 66px; overflow: auto; padding-right: 2px;
    }
    .solar-map-contact-empty {
      border: 1px solid rgba(174, 233, 255, .1); border-radius: 6px;
      padding: 8px 10px; color: rgba(215, 255, 231, .48); font-size: 10px; letter-spacing: .7px;
    }
    .solar-map-contact-row {
      display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 7px; align-items: center;
      min-height: 28px; border: 1px solid rgba(174, 233, 255, .13); border-radius: 6px;
      background: rgba(2, 12, 18, .38); padding: 5px 6px;
    }
    .solar-map-contact-row.selected { border-color: rgba(174, 233, 255, .5); background: rgba(13, 36, 46, .42); }
    .solar-map-contact-row.stale { opacity: .6; }
    .solar-map-contact-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
    .solar-map-contact-main { min-width: 0; display: grid; gap: 2px; }
    .solar-map-contact-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f2fff7; font-size: 10px; letter-spacing: .8px; }
    .solar-map-contact-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(174, 233, 255, .6); font-size: 9px; letter-spacing: .6px; }
    .solar-map-contact-row button {
      min-height: 24px; min-width: 44px; padding: 0 8px; font-size: 9px;
    }
    .solar-map-preview-empty {
      border: 1px solid rgba(174, 233, 255, .12); border-radius: 6px;
      padding: 10px; color: rgba(215, 255, 231, .52); font-size: 10px; letter-spacing: .7px;
    }
    .solar-map-preview-row {
      display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto auto; gap: 7px; align-items: center;
      min-height: 30px; border: 1px solid rgba(174, 233, 255, .13); border-radius: 6px;
      background: rgba(2, 12, 18, .46); padding: 5px 6px;
    }
    .solar-map-preview-row.selected { border-color: rgba(255, 195, 109, .54); background: rgba(42, 25, 10, .36); }
    .solar-map-preview-row.stale { opacity: .56; }
    .solar-map-route-swatch { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
    .solar-map-route-main { min-width: 0; display: grid; gap: 2px; }
    .solar-map-route-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f2fff7; font-size: 10px; letter-spacing: .8px; }
    .solar-map-route-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(174, 233, 255, .6); font-size: 9px; letter-spacing: .6px; }
    .solar-map-preview-row button {
      min-height: 24px; min-width: 28px; padding: 0 7px; font-size: 9px;
    }
    .solar-map-label {
      color: #e9fff3; font-size: 10px; line-height: 1; text-shadow: 0 0 8px #000, 0 0 16px rgba(120, 255, 180, .38);
      white-space: nowrap; transform: translateY(-2px); letter-spacing: .6px;
    }
    .solar-map-label.muted { color: rgba(210, 232, 255, .74); }
    .solar-map-label.peer { color: #aee9ff; }
    .solar-map-label.region { color: #ffcf8a; }
    .solar-map-label.active { color: #9fffb0; text-shadow: 0 0 8px #000, 0 0 18px rgba(159, 255, 176, .58); }
    .solar-map-label.selected { color: #ffcf8a; text-shadow: 0 0 8px #000, 0 0 18px rgba(255, 195, 109, .55); }
    .solar-map-ui-hidden .solar-map-panel,
    .solar-map-ui-hidden .solar-map-toolbar,
    .solar-map-ui-hidden .solar-map-strip {
      display: none;
    }
    @media (max-width: 900px) and (min-width: 721px) {
      .solar-map-panel { right: 12px; top: 74px; width: 320px; max-height: calc(100vh - 118px); }
      .solar-map-toolbar { left: 12px; bottom: 12px; width: min(500px, calc(100vw - 365px)); }
      .solar-map-toolbar-body { grid-template-columns: minmax(180px, .9fr) minmax(190px, 1.1fr); gap: 8px; }
      .solar-map-inputs { display: none; }
      .solar-map-preview-list { max-height: 68px; }
      .solar-map-contact-list { max-height: 58px; }
      .solar-map-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .solar-map-strip { max-width: calc(100vw - 370px); }
    }
    @media (max-width: 720px) {
      .solar-map-panel {
        left: 12px; right: 12px; top: 64px; bottom: min(48vh, 384px); width: auto;
        max-height: none;
      }
      .solar-map-head { left: 12px; right: 12px; top: 12px; }
      .solar-map-toolbar {
        left: 12px; right: 12px; bottom: 12px; width: auto;
        max-height: min(46vh, 360px); overflow: auto;
      }
      .solar-map-toolbar-body { grid-template-columns: 1fr; }
      .solar-map-strip, .solar-map-inputs { display: none; }
      .solar-map-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `
  document.head.appendChild(style)
}

function disposeObject(obj: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const disposeMaterial = (material: THREE.Material): void => {
    const entries = Object.values(material as unknown as Record<string, unknown>)
    for (const value of entries) {
      if (value instanceof THREE.Texture && !textures.has(value)) {
        textures.add(value)
        value.dispose()
      }
    }
    material.dispose()
  }
  obj.traverse((child) => {
    if (child instanceof CSS2DObject) child.element.remove()

    const mesh = child as THREE.Mesh
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      for (const m of material) {
        if (!materials.has(m)) {
          materials.add(m)
          disposeMaterial(m)
        }
      }
    } else if (material && !materials.has(material)) {
      materials.add(material)
      disposeMaterial(material)
    }
  })
}

export class SolarSystemMap {
  readonly root: HTMLElement

  private readonly canvasHost: HTMLElement
  private readonly titleSubEl: HTMLElement
  private readonly inspectorEl: HTMLElement
  private readonly stripEl: HTMLElement
  private readonly actionsEl: HTMLElement
  private readonly layerControlsEl: HTMLElement
  private readonly previewListEl: HTMLElement
  private readonly contactsListEl: HTMLElement
  private readonly actionStatusEl: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly labelRenderer: CSS2DRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.05, 2200)
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly pointerDown = new THREE.Vector2()
  private readonly pickWorld = new THREE.Vector3()
  private readonly clock = new THREE.Clock()
  private readonly mapRoot = new THREE.Group()
  private readonly clickables: THREE.Object3D[] = []
  private readonly labelBoxes: LabelBox[] = []
  private readonly animatedMaterials: THREE.ShaderMaterial[] = []
  private readonly getSnapshot: () => SolarMapSnapshot
  private readonly onClose: () => void
  private readonly onSetDestination?: (target: SolarMapNavigationTarget) => SolarMapDestinationResult | void

  private raf = 0
  private lastRefresh = 0
  private snapshot: SolarMapSnapshot | null = null
  private hovered: THREE.Object3D | null = null
  private selected: THREE.Object3D | null = null
  private selectedId = 'player'
  private selectedRegion: SolarMapEntity | null = null
  private selectedPreviewId: string | null = null
  private actionStatus = ''
  private controlsHidden = false
  private readonly layers: SolarMapLayers = { ...DEFAULT_LAYERS }
  private readonly previewRoutes: PreviewRoute[] = []
  private readonly remoteTrails = new Map<string, RemoteTrailPoint[]>()

  constructor(opts: {
    getSnapshot: () => SolarMapSnapshot
    onClose: () => void
    onSetDestination?: (target: SolarMapNavigationTarget) => SolarMapDestinationResult | void
  }) {
    injectSolarMapStyles()
    this.getSnapshot = opts.getSnapshot
    this.onClose = opts.onClose
    this.onSetDestination = opts.onSetDestination

    this.root = document.createElement('section')
    this.root.id = 'solar-map'
    this.root.dataset.testid = 'solar-system-map'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="solar-map-canvas" data-testid="solar-map-canvas"></div>
      <div class="solar-map-head">
        <div>
          <div class="solar-map-title">SOLAR ATLAS</div>
          <div class="solar-map-sub"></div>
        </div>
        <div class="solar-map-head-actions">
          <button class="solar-map-ui-toggle" type="button" data-testid="solar-map-ui-toggle" aria-pressed="false">Hide UI</button>
          <button class="solar-map-close" aria-label="Close solar map">x</button>
        </div>
      </div>
      <aside class="solar-map-panel" aria-live="polite"></aside>
      <div class="solar-map-toolbar" data-testid="solar-map-toolbar">
        <div class="solar-map-toolbar-head">
          <div class="solar-map-toolbar-title">NAVIGATION</div>
          <div class="solar-map-inputs">
            <span><b>Drag</b> rotate</span>
            <span><b>Scroll</b> zoom</span>
            <span><b>M/Esc</b> close</span>
          </div>
        </div>
        <div class="solar-map-toolbar-body">
          <div>
            <div class="solar-map-actions"></div>
            <div class="solar-map-layer-controls" data-testid="solar-map-layer-controls"></div>
            <div class="solar-map-status" aria-live="polite"></div>
          </div>
          <div class="solar-map-preview">
            <div class="solar-map-preview-head">
              <span>PREVIEW PATHS</span>
              <button data-action="clear-previews" data-testid="solar-map-clear-previews">Clear All</button>
            </div>
            <div class="solar-map-preview-list" data-testid="solar-map-preview-list"></div>
            <div class="solar-map-contact-head">PILOTS</div>
            <div class="solar-map-contact-list" data-testid="solar-map-contact-list"></div>
          </div>
        </div>
      </div>
      <div class="solar-map-strip"></div>
    `
    this.canvasHost = this.root.querySelector('.solar-map-canvas')!
    this.titleSubEl = this.root.querySelector('.solar-map-sub')!
    this.inspectorEl = this.root.querySelector('.solar-map-panel')!
    this.stripEl = this.root.querySelector('.solar-map-strip')!
    this.actionsEl = this.root.querySelector('.solar-map-actions')!
    this.layerControlsEl = this.root.querySelector('.solar-map-layer-controls')!
    this.previewListEl = this.root.querySelector('.solar-map-preview-list')!
    this.contactsListEl = this.root.querySelector('.solar-map-contact-list')!
    this.actionStatusEl = this.root.querySelector('.solar-map-status')!

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.06
    this.canvasHost.appendChild(this.renderer.domElement)
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.58, 0.82, 0.68)
    this.composer.addPass(this.bloomPass)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.inset = '0'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    this.canvasHost.appendChild(this.labelRenderer.domElement)

    this.scene.background = new THREE.Color(0x000106)
    this.scene.fog = new THREE.FogExp2(0x000106, 0.0064)
    this.scene.add(new THREE.AmbientLight(0x526a80, 0.16))
    const hemi = new THREE.HemisphereLight(0x6e9fca, 0x020407, 0.18)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff1ce, 1.2)
    key.position.set(9, 7, 6)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6fe8ff, 0.34)
    rim.position.set(-10, 7, -14)
    this.scene.add(rim)
    this.scene.add(this.mapRoot)

    this.camera.position.set(0, 24, 46)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 5
    this.controls.maxDistance = 165
    this.controls.target.set(0, 0, 0)

    this.raycaster.params.Points.threshold = 0.45
    this.raycaster.params.Line.threshold = 0.72

    this.root.querySelector('.solar-map-close')!.addEventListener('click', () => this.close())
    this.root.querySelector('.solar-map-ui-toggle')!.addEventListener('click', () => this.toggleControls())
    this.root.querySelector('.solar-map-toolbar')!.addEventListener('click', (event) => this.onToolbarClick(event))
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.pointerDown.set(event.clientX, event.clientY)
    })
    this.renderer.domElement.addEventListener('pointerup', (event) => this.onPointerUp(event))
    this.renderer.domElement.addEventListener('pointermove', (event) => this.onPointerMove(event))
    this.renderer.domElement.addEventListener('pointerleave', () => this.setHovered(null))
    document.addEventListener('keydown', (event) => this.onKeyDown(event), true)
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  open(): void {
    if (this.isOpen) return
    this.root.hidden = false
    this.controlsHidden = false
    this.updateControlsVisibility()
    this.selectedId = 'player'
    this.selectedRegion = null
    this.actionStatus = 'Atlas centered on your ship.'
    this.clock.start()
    this.resize()
    this.refresh(true)
    addEventListener('resize', this.resize)
    this.loop()
  }

  close(): void {
    if (!this.isOpen) return
    this.root.hidden = true
    removeEventListener('resize', this.resize)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.setHovered(null)
    this.onClose()
  }

  private readonly resize = (): void => {
    const width = this.canvasHost.clientWidth || innerWidth
    const height = this.canvasHost.clientHeight || innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloomPass.resolution.set(width, height)
    this.labelRenderer.setSize(width, height)
  }

  private readonly loop = (): void => {
    if (!this.isOpen) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    if (now - this.lastRefresh > 1200) this.refresh(false)
    this.controls.update()
    const elapsed = this.clock.getElapsedTime()
    for (const material of this.animatedMaterials) material.uniforms.time.value = elapsed
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
  }

  private refresh(forceCamera: boolean): void {
    this.snapshot = this.getSnapshot()
    this.lastRefresh = performance.now()
    this.updateRemoteTrails(this.lastRefresh)
    this.syncPreviewRoutes(this.lastRefresh)
    this.rebuildScene()
    if (forceCamera) this.resetCamera()
    this.renderSummary()
  }

  private resetCamera(): void {
    this.camera.position.set(0, 24, 46)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  private toggleControls(): void {
    this.controlsHidden = !this.controlsHidden
    this.updateControlsVisibility()
  }

  private updateControlsVisibility(): void {
    this.root.classList.toggle('solar-map-ui-hidden', this.controlsHidden)
    const button = this.root.querySelector('.solar-map-ui-toggle') as HTMLButtonElement | null
    if (!button) return
    button.textContent = this.controlsHidden ? 'Show UI' : 'Hide UI'
    button.setAttribute('aria-pressed', this.controlsHidden ? 'true' : 'false')
  }

  private updateRemoteTrails(now: number): void {
    if (!this.snapshot) return
    const live = new Set(this.snapshot.remotes.map((r) => r.id))
    for (const [id, points] of this.remoteTrails) {
      if (!live.has(id)) {
        this.remoteTrails.delete(id)
        continue
      }
      const fresh = points.filter((p) => now - p.at < REMOTE_TRAIL_SECONDS * 1000)
      if (fresh.length !== points.length) this.remoteTrails.set(id, fresh)
    }
    for (const remote of this.snapshot.remotes) {
      const points = this.remoteTrails.get(remote.id) ?? []
      const last = points[points.length - 1]
      if (!last || last.position.distanceToSquared(remote.position) > 12 * 12 || now - last.at > 1600) {
        points.push({ position: remote.position.clone(), at: now })
        while (points.length > REMOTE_TRAIL_POINTS) points.shift()
      }
      this.remoteTrails.set(remote.id, points)
    }
  }

  private syncPreviewRoutes(now: number): void {
    if (!this.snapshot || !this.previewRoutes.length) return
    const known = new Map(this.collectKnownEntities(false).map((entity) => [entity.id, entity]))
    const active = this.activeDestination()
    for (let i = this.previewRoutes.length - 1; i >= 0; i--) {
      const route = this.previewRoutes[i]
      if (active?.id === route.id) {
        this.previewRoutes.splice(i, 1)
        if (this.selectedPreviewId === route.id) this.selectedPreviewId = null
        continue
      }
      const entity = known.get(route.id)
      if (entity) {
        route.target = this.asNavigationTarget(entity)
        route.updatedAt = now
        route.stale = false
        continue
      }
      if (route.id.startsWith('peer.')) {
        if (!route.stale) route.updatedAt = now
        route.stale = true
        if (now - route.updatedAt > PREVIEW_STALE_MS) {
          this.previewRoutes.splice(i, 1)
          if (this.selectedPreviewId === route.id) this.selectedPreviewId = null
        }
      }
    }
  }

  private rebuildScene(): void {
    if (!this.snapshot) return
    disposeObject(this.mapRoot)
    this.mapRoot.clear()
    this.clickables.length = 0
    this.labelBoxes.length = 0
    this.animatedMaterials.length = 0
    this.hovered = null
    this.selected = null

    if (this.layers.backdrop) this.addStarBackdrop()
    if (this.layers.routes) this.addRoutes()
    this.addSolarSystem()
    this.addNearbyCelestials()
    if (this.layers.contacts) this.addRemotes()
    this.addPlayerMarker()
    this.addSelectedRegionMarker()
    this.addSelectionBeacon()
  }

  private addStarBackdrop(): void {
    const count = 2100
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const twinkle = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const u = seededUnit(i, 1)
      const v = seededUnit(i, 2)
      const theta = u * Math.PI * 2
      const z = v * 2 - 1
      const r = 250 + seededUnit(i, 3) * 80
      const s = Math.sqrt(1 - z * z)
      positions[i * 3] = Math.cos(theta) * s * r
      positions[i * 3 + 1] = z * r * 0.76
      positions[i * 3 + 2] = Math.sin(theta) * s * r
      const bright = seededUnit(i, 4)
      const rareWarm = seededUnit(i, 7) > 0.88
      scratchColor.setHSL(rareWarm ? 0.1 + seededUnit(i, 8) * 0.04 : 0.55 + seededUnit(i, 5) * 0.1, 0.14 + seededUnit(i, 6) * 0.26, 0.36 + bright * 0.56)
      colors[i * 3] = scratchColor.r
      colors[i * 3 + 1] = scratchColor.g
      colors[i * 3 + 2] = scratchColor.b
      sizes[i] = bright > 0.992 ? 4.6 : bright > 0.965 ? 2.75 : 1.45
      twinkle[i] = bright > 0.965 ? seededUnit(i, 9) * 0.62 : seededUnit(i, 9) * 0.18
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('twinkle', new THREE.BufferAttribute(twinkle, 1))
    const pts = new THREE.Points(geo, buildStarMaterial())
    pts.renderOrder = -20
    this.mapRoot.add(pts)
    this.addNebulaCloud(new THREE.Vector3(-86, 34, -224), 118, 64, 'rgba(80, 168, 210, .34)', 'rgba(50, 104, 138, .13)')
    this.addNebulaCloud(new THREE.Vector3(122, -24, -252), 154, 84, 'rgba(138, 92, 154, .25)', 'rgba(36, 70, 116, .11)')
    this.addNebulaCloud(new THREE.Vector3(-18, -76, -238), 190, 96, 'rgba(180, 122, 64, .18)', 'rgba(52, 82, 112, .08)')
    this.addNebulaCloud(new THREE.Vector3(18, -30, -268), 260, 104, 'rgba(122, 178, 214, .12)', 'rgba(78, 112, 148, .055)')
  }

  private addNebulaCloud(position: THREE.Vector3, width: number, height: number, inner: string, mid: string): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createRadialTexture(inner, mid, 'rgba(0, 0, 0, 0)'),
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }))
    sprite.position.copy(position)
    sprite.scale.set(width, height, 1)
    sprite.renderOrder = -22
    this.mapRoot.add(sprite)
  }

  private addSolarSystem(): void {
    if (!this.snapshot) return
    const origin = this.snapshot.playerPosition
    const sunPos = mapPosition(SUN_POSITION, origin)
    const sunRadius = visualRadius(SUN_RADIUS, 3.6, 7.2)
    const sunMaterial = buildSunSurfaceMaterial(SUN_COLOR)
    this.animatedMaterials.push(sunMaterial)
    const sun = new THREE.Mesh(new THREE.SphereGeometry(sunRadius, 64, 34), sunMaterial)
    sun.position.copy(sunPos)
    sun.renderOrder = 24
    this.makeSelectable(sun, {
      id: 'sun',
      name: 'Nearest sun',
      kind: 'Star',
      worldPosition: SUN_POSITION.clone(),
      distance: origin.distanceTo(SUN_POSITION),
      radius: SUN_RADIUS,
      targetable: false,
      note: 'Primary system light source. Treat it as a visual anchor, not a jump destination.',
    })
    this.mapRoot.add(sun)
    if (this.selectedId === 'sun') this.addLabel('Nearest sun', sun.position, 'selected', 88)
    const sunLight = new THREE.PointLight(SUN_COLOR, 4.9, 320, 1.22)
    sunLight.position.copy(sun.position)
    this.mapRoot.add(sunLight)
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createRadialTexture('rgba(255, 248, 218, .46)', 'rgba(255, 184, 84, .16)', 'rgba(255, 120, 28, 0)'),
      transparent: true,
      opacity: 0.54,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }))
    sunGlow.position.copy(sun.position)
    sunGlow.scale.setScalar(sunRadius * 16.8)
    sunGlow.renderOrder = 22
    this.mapRoot.add(sunGlow)
    const radialLight = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createRadialTexture('rgba(255, 222, 160, .16)', 'rgba(255, 158, 66, .05)', 'rgba(255, 180, 84, 0)'),
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }))
    radialLight.position.copy(sun.position)
    radialLight.scale.setScalar(sunRadius * 42)
    radialLight.renderOrder = 21
    this.mapRoot.add(radialLight)

    if (this.layers.orbits) this.addOrbitTracks(origin)

    const nearestPlanet = PLANETS
      .map((planet) => ({ planet, d: planet.position.distanceToSquared(origin) }))
      .sort((a, b) => a.d - b.d)[0]?.planet.name
    for (const planet of PLANETS) {
      const planetId = `planet.${planet.name}`
      const planetPos = mapPosition(planet.position, origin)
      const radius = visualRadius(planet.radius, 0.82, 4.25)
      const active = this.isActiveDestination(planetId)
      const selected = this.selectedId === planetId
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: planet.surface === 'gas' ? 0.58 : 0.84,
        metalness: 0.02,
        emissive: active ? 0x183828 : 0x000000,
        emissiveIntensity: active ? 0.48 : 0,
      })
      const body = new THREE.Mesh(buildAtlasPlanetGeometry(radius, planet.color, planet.surface, planet.seed), mat)
      body.position.copy(planetPos)
      body.rotation.set((planet.seed % 9) * 0.04, (planet.seed % 31) * 0.06, (planet.seed % 17) * 0.03)
      this.makeSelectable(body, this.planetEntity(planet.name, planet.position, planet.radius, origin))
      this.mapRoot.add(body)

      const atmosphereColor = planet.surface === 'earth' ? 0x88c7ff : planet.surface === 'venus' ? 0xffd08a : planet.surface === 'mars' ? 0xff9a70 : 0xb8d7ff
      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (planet.surface === 'gas' ? 1.045 : 1.12), 40, 22),
        buildGlowMaterial(atmosphereColor, planet.surface === 'gas' ? 0.08 : 0.25),
      )
      atmosphere.position.copy(planetPos)
      this.mapRoot.add(atmosphere)
      if (active || selected || planet.name === nearestPlanet) {
        const labelPos = body.position.clone()
        if (active && labelPos.distanceTo(sun.position) < sunRadius * 5.2) labelPos.add(new THREE.Vector3(radius * 4.4 + 7, radius * 2.2 + 3, 0))
        this.addLabel(planet.name, labelPos, active ? 'active' : selected ? 'selected' : 'muted', active ? 85 : selected ? 80 : 45)
      }
      if (active) this.addTargetRing(planetPos, radius * 1.95, 0x9fffb0, 0.92)
      if (planet.hasRings) this.addPlanetRings(planetPos, radius)
    }
  }

  private addOrbitTracks(origin: THREE.Vector3): void {
    for (const planet of PLANETS) {
      const orbitId = `orbit.${planet.name}`
      const active = this.isActiveDestination(`planet.${planet.name}`)
      const selected = this.selectedId === orbitId
      const orbitRadius = planetOrbitRadius(planet.position)
      const points = buildPlanetOrbitPoints(planet.position, origin)
      const color = selected ? 0xffcf8a : active ? 0x9fffb0 : 0x9bcce6
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.9 : active ? 0.68 : 0.48,
        depthWrite: false,
        depthTest: true,
      })
      const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material)
      orbit.renderOrder = selected ? 15 : active ? 12 : 8
      this.makeSelectable(orbit, {
        id: orbitId,
        name: `${planet.name} orbit`,
        kind: 'Orbit track',
        worldPosition: planet.position.clone(),
        distance: origin.distanceTo(planet.position),
        radius: orbitRadius,
        targetable: false,
        chartable: false,
        note: `Selectable orbital reference track for ${planet.name}. Use it to read the planet's path around the sun; select the planet marker itself to chart or set a destination.`,
      })
      this.mapRoot.add(orbit)
      if (selected) this.addLabel(`${planet.name} orbit`, mapPosition(planet.position, origin), 'selected', 82)
    }
  }

  private planetEntity(name: string, position: THREE.Vector3, radius: number, origin: THREE.Vector3): SolarMapEntity {
    return {
      id: `planet.${name}`,
      name,
      kind: name === 'Saturn' ? 'Ringed planet' : 'Planet',
      worldPosition: position.clone(),
      distance: origin.distanceTo(position),
      radius,
      targetable: true,
      note: PLANET_NOTES[name] ?? 'Named solar-system body and valid quantum navigation target.',
    }
  }

  private addPlanetRings(position: THREE.Vector3, radius: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.42, radius * 2.28, 96),
      new THREE.MeshBasicMaterial({
        color: 0xd8c491,
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    ring.position.copy(position)
    ring.rotation.set(Math.PI / 2.45, 0, 0.18)
    this.mapRoot.add(ring)
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(radius * 2.32, radius * 2.37, 96),
      new THREE.MeshBasicMaterial({ color: 0xffe5a8, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false }),
    )
    outer.position.copy(position)
    outer.rotation.copy(ring.rotation)
    this.mapRoot.add(outer)
  }

  private addTargetRing(position: THREE.Vector3, radius: number, color: number, opacity: number): void {
    const targetRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.025, 8, 88),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    )
    targetRing.position.copy(position)
    targetRing.rotation.x = Math.PI / 2
    this.mapRoot.add(targetRing)
  }

  private addRoutes(): void {
    if (!this.snapshot) return
    const active = this.activeDestination()
    if (active) this.addRoute(active, 'active', 0x9fffb0, false, true)
    for (const route of this.previewRoutes) {
      if (route.target.id === active?.id) continue
      this.addRoute(route.target, 'preview', route.color, route.stale, this.selectedPreviewId === route.id)
    }
  }

  private addRoute(target: SolarMapNavigationTarget, mode: 'active' | 'preview', color: number, stale: boolean, selected: boolean): void {
    if (!this.snapshot) return
    const end = mapPosition(target.worldPosition, this.snapshot.playerPosition)
    if (end.lengthSq() < 0.01) return
    const mid = end.clone().multiplyScalar(0.5)
    const previewBias = selected ? -1.02 : -0.72
    mid.y += Math.max(3, end.length() * 0.14) * (mode === 'active' ? 1 : previewBias)
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), mid, end)
    const points = curve.getPoints(72)
    const material = mode === 'active'
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88 })
      : new THREE.LineDashedMaterial({ color, transparent: true, opacity: stale ? 0.32 : selected ? 0.84 : 0.58, dashSize: selected ? 1.2 : 1.55, gapSize: selected ? 0.52 : 0.95 })
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
    if (material instanceof THREE.LineDashedMaterial) route.computeLineDistances()
    route.renderOrder = mode === 'active' ? 20 : selected ? 19 : 18
    this.mapRoot.add(route)
    const endBeacon = new THREE.Mesh(
      new THREE.TorusGeometry(mode === 'active' ? 0.95 : selected ? 0.74 : 0.58, mode === 'active' ? 0.032 : 0.024, 8, 58),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: stale ? 0.32 : mode === 'active' ? 0.9 : selected ? 0.76 : 0.48, depthWrite: false }),
    )
    endBeacon.position.copy(end)
    endBeacon.lookAt(new THREE.Vector3())
    this.mapRoot.add(endBeacon)
    const activeNamedPlanet = mode === 'active' && target.id.startsWith('planet.')
    if (!activeNamedPlanet && (mode === 'active' || selected)) this.addLabel(target.name, end, mode === 'active' ? 'active' : 'selected', mode === 'active' ? 86 : 74)
  }

  private addNearbyCelestials(): void {
    if (!this.snapshot) return
    const origin = this.snapshot.playerPosition
    const sunMapPos = mapPosition(SUN_POSITION, origin)
    const sunGlareRadius = visualRadius(SUN_RADIUS, 3.6, 7.2) * 7.2
    const bodies = [...this.snapshot.nearbyCelestials]
      .sort((a, b) => a.position.distanceToSquared(origin) - b.position.distanceToSquared(origin))
      .slice(0, MAX_PROCEDURAL_BODIES)

    let importantLabels = 0
    for (const [index, body] of bodies.entries()) {
      const pos = mapPosition(body.position, origin)
      const color = body.type === 'station'
        ? 0x9fffb0
        : body.type === 'derelict'
          ? 0xffb347
          : body.type === 'asteroid-cluster'
            ? 0x8f8a80
            : body.type === 'moon'
              ? 0xaeb8c2
              : 0x9bb8e0
      const marker = body.type === 'station' || body.type === 'derelict'
        ? new THREE.Mesh(new THREE.OctahedronGeometry(body.type === 'station' ? 0.52 : 0.44, 0), new THREE.MeshBasicMaterial({ color }))
        : new THREE.Mesh(
          new THREE.SphereGeometry(visualRadius(body.radius, 0.2, body.type === 'planet' ? 1.8 : 0.8), 14, 9),
          new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
        )
      marker.position.copy(pos)
      const entity = this.celestialEntity(body, origin)
      this.makeSelectable(marker, entity)
      this.mapRoot.add(marker)
      const important = body.type === 'station' || body.type === 'derelict'
      const clearOfSunGlare = marker.position.distanceTo(sunMapPos) > sunGlareRadius
      if (entity.id === this.selectedId || (important && clearOfSunGlare && importantLabels < 3 && entity.distance < 52000)) {
        if (important && entity.id !== this.selectedId) importantLabels += 1
        this.addLabel(entity.name, marker.position, entity.id === this.selectedId ? 'selected' : 'muted', entity.id === this.selectedId ? 76 : 42 - index * 2)
      }
    }
  }

  private celestialEntity(body: Celestial, origin: THREE.Vector3): SolarMapEntity {
    const kind = formatKind(body.type)
    const name = body.type === 'station'
      ? `Station ${shortId(body.id)}`
      : body.type === 'derelict'
        ? `Derelict ${shortId(body.id)}`
        : body.type === 'asteroid-cluster'
          ? `Asteroid cluster ${shortId(body.id)}`
          : `${kind} ${shortId(body.id)}`
    const note = body.type === 'station'
      ? 'Procedural station contact. Stations are useful as service candidates, rendezvous anchors, and safe route landmarks.'
      : body.type === 'derelict'
        ? 'Derelict contact. Worth charting for salvage or threat awareness, but approach vectors should stay conservative.'
        : body.type === 'asteroid-cluster'
          ? 'Asteroid cluster from the live procedural sector stream. Useful for mining awareness and route hazard checks.'
          : 'Procedural celestial body from the live sector stream. It is chartable as a local navigation landmark.'
    return {
      id: body.id,
      name,
      kind,
      worldPosition: body.position.clone(),
      distance: origin.distanceTo(body.position),
      radius: body.radius,
      targetable: true,
      note,
    }
  }

  private addRemotes(): void {
    if (!this.snapshot) return
    const origin = this.snapshot.playerPosition
    for (const [index, remote] of this.snapshot.remotes.slice(0, MAX_RENDERED_PEERS).entries()) {
      const marker = new THREE.Group()
      marker.position.copy(mapPosition(remote.position, origin))
      const color = remote.color || 0xaee9ff
      const stale = (remote.ageMs ?? 0) > 1800
      const remoteId = `peer.${remote.id}`
      const selected = this.selectedId === remoteId
      const distance = origin.distanceTo(remote.position)
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 4), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: stale ? 0.48 : 0.96,
      }))
      core.rotation.x = Math.PI / 2
      if (remote.velocity && remote.velocity.lengthSq() > 0.01) {
        scratchVector.copy(remote.velocity).normalize()
        const angle = Math.atan2(scratchVector.x, scratchVector.z)
        core.rotation.z = -angle
      }
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 0.94, 30),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: stale ? 0.16 : 0.44, side: THREE.DoubleSide, depthWrite: false }),
      )
      halo.rotation.x = Math.PI / 2
      marker.add(core, halo)
      if ((selected || index < 6) && remote.velocity && remote.velocity.lengthSq() > 1) {
        const dir = mapPosition(remote.position.clone().add(remote.velocity.clone().setLength(9000)), origin)
        const heading = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([marker.position.clone(), dir]),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: stale ? 0.14 : 0.4 }),
        )
        this.mapRoot.add(heading)
      }
      const trail = this.remoteTrails.get(remote.id)
      if ((selected || index < 6) && trail && trail.length > 1) {
        const points = trail.map((p) => mapPosition(p.position, origin))
        this.mapRoot.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: stale ? 0.12 : 0.34 }),
        ))
      }
      this.makeSelectable(marker, {
        id: remoteId,
        name: remote.name,
        kind: 'Pilot',
        worldPosition: remote.position.clone(),
        distance,
        speed: remote.velocity?.length(),
        ageMs: remote.ageMs,
        targetable: false,
        note: stale ? 'Last known pilot position from the relay. Charting is available, but destination setting is disabled for stale moving contacts.' : 'Live pilot contact from the sector relay. Heading and trail indicate recent motion.',
      })
      this.mapRoot.add(marker)
      if (selected || (!stale && index < 3 && distance < 42000)) this.addLabel(remote.name, marker.position, selected ? 'selected' : 'peer', selected ? 78 : 48)
    }
  }

  private addPlayerMarker(): void {
    if (!this.snapshot) return
    const ship = new THREE.Group()
    const hull = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.8, 4),
      new THREE.MeshBasicMaterial({ color: 0x9fffb0 }),
    )
    hull.rotation.x = Math.PI / 2
    hull.quaternion.multiply(this.snapshot.playerQuaternion)
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.025, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x9fffb0, transparent: true, opacity: 0.82, depthWrite: false }),
    )
    halo.rotation.x = Math.PI / 2
    ship.add(hull, halo)
    this.makeSelectable(ship, {
      id: 'player',
      name: 'Your ship',
      kind: 'Current location',
      worldPosition: this.snapshot.playerPosition.clone(),
      distance: 0,
      targetable: false,
      note: 'Atlas origin. Reset returns camera focus and selection here without changing your active destination.',
    })
    this.mapRoot.add(ship)
  }

  private addSelectedRegionMarker(): void {
    if (!this.snapshot || !this.selectedRegion) return
    const marker = new THREE.Group()
    marker.position.copy(mapPosition(this.selectedRegion.worldPosition, this.snapshot.playerPosition))
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc36d, transparent: true, opacity: 0.78 }),
    )
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.02, 8, 60),
      new THREE.MeshBasicMaterial({ color: 0xffc36d, transparent: true, opacity: 0.52, depthWrite: false }),
    )
    ring.rotation.x = Math.PI / 2
    marker.add(core, ring)
    this.makeSelectable(marker, this.selectedRegion)
    this.mapRoot.add(marker)
    if (!this.selectedPreviewId) this.addLabel(this.selectedRegion.name, marker.position, 'region selected', 78)
  }

  private addSelectionBeacon(): void {
    if (!this.snapshot) return
    const focus = this.currentFocusEntity()
    if (!focus || focus.id === 'player') return
    const pos = mapPosition(focus.worldPosition, this.snapshot.playerPosition)
    const radius = visualRadius(focus.radius ?? 900, 0.95, 5.2) + 0.6
    this.addTargetRing(pos, radius, focus.targetable ? 0xffc36d : 0xaee9ff, 0.44)
  }

  private addLabel(text: string, pos: THREE.Vector3, variant: string, priority: number): void {
    if (!this.layers.labels) return
    if (this.labelBoxes.length >= MAX_ATLAS_LABELS && priority < 80) return
    const width = THREE.MathUtils.clamp(text.length * 6.4 + 20, 44, 178)
    const height = 18
    const rect = this.renderer.domElement.getBoundingClientRect()
    const canvasWidth = rect.width || this.canvasHost.clientWidth || innerWidth
    const canvasHeight = rect.height || this.canvasHost.clientHeight || innerHeight
    const offsets = [1.2, 2.35, -1.1, 3.4, -2.25]
    let labelPos: THREE.Vector3 | null = null
    let box: LabelBox | null = null
    this.camera.updateMatrixWorld(true)
    this.mapRoot.updateMatrixWorld(true)
    for (const offset of offsets) {
      const world = this.mapRoot.localToWorld(pos.clone().add(new THREE.Vector3(0, offset, 0)))
      const projected = world.project(this.camera)
      if (projected.z < -1 || projected.z > 1) continue
      const x = (projected.x * 0.5 + 0.5) * canvasWidth
      const y = (-projected.y * 0.5 + 0.5) * canvasHeight
      if (x < 8 || x > canvasWidth - 8 || y < 8 || y > canvasHeight - 8) continue
      const candidate = { x: x - width / 2, y: y - height / 2, width, height }
      const collides = this.labelBoxes.some((other) => !(
        candidate.x + candidate.width + 12 < other.x ||
        candidate.x > other.x + other.width + 12 ||
        candidate.y + candidate.height + 8 < other.y ||
        candidate.y > other.y + other.height + 8
      ))
      if (!collides) {
        labelPos = pos.clone().add(new THREE.Vector3(0, offset, 0))
        box = candidate
        break
      }
    }
    if (!labelPos || !box) return
    this.labelBoxes.push(box)
    const el = document.createElement('div')
    el.className = `solar-map-label ${variant}`.trim()
    el.textContent = text
    const label = new CSS2DObject(el)
    label.position.copy(labelPos)
    this.mapRoot.add(label)
  }

  private makeSelectable(object: THREE.Object3D, entity: SolarMapEntity): void {
    object.userData.entity = entity
    if (this.selectedId === entity.id) this.selected = object
    object.traverse((child) => {
      child.userData.entityRoot = object
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) this.clickables.push(child)
    })
  }

  private onToolbarClick(event: Event): void {
    const target = event.target as HTMLElement | null
    const button = target?.closest('button') as HTMLButtonElement | null
    if (!button || button.disabled) return
    const action = button.dataset.action
    const routeId = button.dataset.routeId
    switch (action) {
      case 'reset':
        this.resetToSelf()
        break
      case 'focus':
        this.focusSelection()
        break
      case 'chart':
        this.chartPath()
        break
      case 'set-destination':
        this.setDestination()
        break
      case 'clear-route':
        if (this.selectedPreviewId) this.removePreviewRoute(this.selectedPreviewId)
        break
      case 'select-preview':
        if (routeId) this.selectPreviewRoute(routeId, false)
        break
      case 'focus-preview':
        if (routeId) this.selectPreviewRoute(routeId, true)
        break
      case 'remove-preview':
        if (routeId) this.removePreviewRoute(routeId)
        break
      case 'clear-previews':
        this.clearPreviewRoutes()
        break
      case 'focus-remote':
        if (routeId) this.focusRemote(routeId)
        break
      case 'toggle-layer': {
        const layer = button.dataset.layer as SolarMapLayerKey | undefined
        if (layer && layer in this.layers) this.toggleLayer(layer)
        break
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.isOpen) return
    const hit = this.pick(event)
    this.setHovered(hit)
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.isOpen) return
    if (event.button !== 0) return
    if (this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 7) return
    const hit = this.pick(event)
    if (hit) {
      this.selected = hit
      this.selectedRegion = null
      const entity = hit.userData.entity as SolarMapEntity
      this.selectedId = entity.id
      this.selectedPreviewId = null
      this.actionStatus = `Focused ${entity.name}.`
      this.renderSummary()
      this.focusEntity(entity, false)
      return
    }
    const region = this.pickEmptyRegion(event)
    if (region) {
      this.selected = null
      this.selectedRegion = region
      this.selectedId = region.id
      this.selectedPreviewId = null
      this.actionStatus = 'Focused map coordinates.'
      this.rebuildScene()
      this.renderSummary()
      this.focusEntity(region, false)
    }
  }

  private pick(event: MouseEvent | PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.clickables, false)[0]?.object
    const rayHit = (hit?.userData.entityRoot as THREE.Object3D | undefined) ?? null
    if (rayHit) return rayHit

    const orbitHit = this.pickOrbitTrack(event, rect)
    if (orbitHit) return orbitHit

    const roots = new Set<THREE.Object3D>()
    let best: THREE.Object3D | null = null
    let bestD2 = 34 * 34
    for (const candidate of this.clickables) {
      const root = candidate.userData.entityRoot as THREE.Object3D | undefined
      if (!root || roots.has(root)) continue
      roots.add(root)
      root.getWorldPosition(this.pickWorld)
      this.pickWorld.project(this.camera)
      if (this.pickWorld.z < -1 || this.pickWorld.z > 1) continue
      const sx = (this.pickWorld.x * 0.5 + 0.5) * rect.width + rect.left
      const sy = (-this.pickWorld.y * 0.5 + 0.5) * rect.height + rect.top
      const dx = event.clientX - sx
      const dy = event.clientY - sy
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = root
      }
    }
    return best
  }

  private pickOrbitTrack(event: MouseEvent | PointerEvent, rect: DOMRect): THREE.Object3D | null {
    let best: THREE.Object3D | null = null
    let bestD2 = 16 * 16
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const seen = new Set<THREE.Object3D>()
    for (const candidate of this.clickables) {
      if (!(candidate instanceof THREE.Line)) continue
      const root = candidate.userData.entityRoot as THREE.Object3D | undefined
      const entity = root?.userData.entity as SolarMapEntity | undefined
      if (!root || seen.has(root) || entity?.kind !== 'Orbit track') continue
      seen.add(root)
      const position = candidate.geometry.getAttribute('position')
      if (!position || position.count < 2) continue
      let prevX = 0
      let prevY = 0
      let prevVisible = false
      for (let i = 0; i < position.count; i++) {
        a.fromBufferAttribute(position, i)
        candidate.localToWorld(a)
        a.project(this.camera)
        const visible = a.z >= -1 && a.z <= 1
        const sx = (a.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-a.y * 0.5 + 0.5) * rect.height + rect.top
        if (visible && prevVisible) {
          const d2 = distanceToScreenSegmentSq(event.clientX, event.clientY, prevX, prevY, sx, sy)
          if (d2 < bestD2) {
            bestD2 = d2
            best = root
          }
        }
        prevX = sx
        prevY = sy
        prevVisible = visible
      }
      if (position.count > 2) {
        a.fromBufferAttribute(position, 0)
        b.fromBufferAttribute(position, position.count - 1)
        candidate.localToWorld(a)
        candidate.localToWorld(b)
        a.project(this.camera)
        b.project(this.camera)
        if (a.z >= -1 && a.z <= 1 && b.z >= -1 && b.z <= 1) {
          const ax = (a.x * 0.5 + 0.5) * rect.width + rect.left
          const ay = (-a.y * 0.5 + 0.5) * rect.height + rect.top
          const bx = (b.x * 0.5 + 0.5) * rect.width + rect.left
          const by = (-b.y * 0.5 + 0.5) * rect.height + rect.top
          const d2 = distanceToScreenSegmentSq(event.clientX, event.clientY, ax, ay, bx, by)
          if (d2 < bestD2) {
            bestD2 = d2
            best = root
          }
        }
      }
    }
    return best
  }

  private pickEmptyRegion(event: MouseEvent | PointerEvent): SolarMapEntity | null {
    if (!this.snapshot) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)

    const localOrigin = this.raycaster.ray.origin.clone()
    const localEnd = this.raycaster.ray.origin.clone().add(this.raycaster.ray.direction)
    this.mapRoot.worldToLocal(localOrigin)
    this.mapRoot.worldToLocal(localEnd)
    const localDir = localEnd.sub(localOrigin).normalize()
    if (Math.abs(localDir.y) < 1e-5) return null
    const t = -localOrigin.y / localDir.y
    if (t < 0) return null
    const localPoint = localOrigin.addScaledVector(localDir, t)
    localPoint.y = 0
    if (localPoint.length() > REGION_PICK_LIMIT) localPoint.setLength(REGION_PICK_LIMIT)
    const world = worldFromMapPosition(localPoint, this.snapshot.playerPosition)
    return this.regionEntity(world)
  }

  private setHovered(next: THREE.Object3D | null): void {
    if (this.hovered === next) return
    this.hovered = next
    this.renderer.domElement.style.cursor = next ? 'pointer' : 'grab'
  }

  private toggleLayer(layer: SolarMapLayerKey): void {
    this.layers[layer] = !this.layers[layer]
    const label = LAYER_DEFS.find((def) => def.key === layer)?.label ?? layer
    this.actionStatus = `${label} layer ${this.layers[layer] ? 'shown' : 'hidden'}.`
    this.refresh(false)
  }

  private resetToSelf(): void {
    this.selectedId = 'player'
    this.selectedRegion = null
    this.selectedPreviewId = null
    this.actionStatus = 'Focused your ship.'
    this.refresh(false)
    this.resetCamera()
  }

  private focusSelection(): void {
    if (!this.snapshot) return
    const focus = this.currentFocusEntity()
    if (!focus) return
    this.focusEntity(focus, true)
  }

  private focusEntity(focus: SolarMapEntity, announce: boolean): void {
    if (!this.snapshot) return
    const local = mapPosition(focus.worldPosition, this.snapshot.playerPosition)
    this.mapRoot.updateMatrixWorld(true)
    const world = this.mapRoot.localToWorld(local.clone())
    const distance = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target), 12, 95)
    const direction = this.camera.position.clone().sub(this.controls.target)
    if (direction.lengthSq() < 1) direction.set(0, 0.45, 1)
    direction.normalize()
    this.controls.target.copy(world)
    this.camera.position.copy(world).addScaledVector(direction, distance)
    this.controls.update()
    if (announce) {
      this.actionStatus = `Focused ${focus.name}.`
      this.renderSummary()
    }
  }

  private chartPath(): void {
    const focus = this.currentFocusEntity()
    if (!focus || focus.id === 'player') return
    const active = this.activeDestination()
    if (active?.id === focus.id) {
      this.selectedPreviewId = null
      this.actionStatus = `${focus.name} is already the active destination.`
      this.renderSummary()
      return
    }
    const route = this.upsertPreviewRoute(this.asNavigationTarget(focus))
    this.selectedPreviewId = route.id
    this.selectedId = focus.id
    this.actionStatus = `Preview path charted to ${focus.name}.`
    this.refresh(false)
  }

  private setDestination(): void {
    const focus = this.currentFocusEntity()
    if (!focus || !focus.targetable) return
    const target = this.asNavigationTarget(focus)
    const result = this.onSetDestination?.(target) ?? { ok: true }
    if (result.ok) {
      this.removePreviewRoute(target.id, false, false)
      if (this.selectedPreviewId === target.id) this.selectedPreviewId = null
      this.actionStatus = `Destination set: ${target.name}.`
      this.refresh(false)
    } else {
      this.actionStatus = result.reason ? `Destination rejected: ${result.reason}.` : 'Destination rejected.'
      this.renderSummary()
    }
  }

  private upsertPreviewRoute(target: SolarMapNavigationTarget): PreviewRoute {
    const now = performance.now()
    const existing = this.previewRoutes.find((route) => route.id === target.id)
    if (existing) {
      existing.target = {
        ...target,
        worldPosition: target.worldPosition.clone(),
      }
      existing.updatedAt = now
      existing.stale = false
      return existing
    }
    const used = new Set(this.previewRoutes.map((route) => route.color))
    const color = PREVIEW_ROUTE_COLORS.find((candidate) => !used.has(candidate))
      ?? PREVIEW_ROUTE_COLORS[this.previewRoutes.length % PREVIEW_ROUTE_COLORS.length]
    const route: PreviewRoute = {
      id: target.id,
      target: {
        ...target,
        worldPosition: target.worldPosition.clone(),
      },
      color,
      createdAt: now,
      updatedAt: now,
      stale: false,
    }
    this.previewRoutes.push(route)
    while (this.previewRoutes.length > MAX_PREVIEW_ROUTES) {
      const removed = this.previewRoutes.shift()
      if (removed?.id === this.selectedPreviewId) this.selectedPreviewId = null
    }
    return route
  }

  private removePreviewRoute(routeId: string, announce = true, refresh = true): void {
    const idx = this.previewRoutes.findIndex((route) => route.id === routeId)
    if (idx < 0) return
    const [removed] = this.previewRoutes.splice(idx, 1)
    if (this.selectedPreviewId === routeId) this.selectedPreviewId = null
    if (announce) this.actionStatus = `Preview path removed: ${removed.target.name}.`
    if (refresh) this.refresh(false)
  }

  private clearPreviewRoutes(): void {
    if (!this.previewRoutes.length) return
    this.previewRoutes.length = 0
    this.selectedPreviewId = null
    this.actionStatus = 'All preview paths cleared. Active destination unchanged.'
    this.refresh(false)
  }

  private selectPreviewRoute(routeId: string, focusCamera: boolean): void {
    const route = this.previewRoutes.find((candidate) => candidate.id === routeId)
    if (!route) return
    this.selectedPreviewId = route.id
    this.selectedId = route.target.id
    if (route.target.id.startsWith('region.')) this.selectedRegion = this.entityFromNavigationTarget(route.target, 'Stored preview coordinates from the Atlas route list.')
    else this.selectedRegion = null
    this.actionStatus = `Selected preview path to ${route.target.name}.`
    this.refresh(false)
    if (focusCamera) this.focusSelection()
  }

  private focusRemote(routeId: string): void {
    if (!this.snapshot) return
    const remote = this.snapshot.remotes.find((candidate) => `peer.${candidate.id}` === routeId)
    if (!remote) {
      this.actionStatus = 'Pilot contact is no longer available.'
      this.renderSummary()
      return
    }
    this.selectedId = routeId
    this.selectedPreviewId = null
    this.selectedRegion = null
    this.actionStatus = `Focused ${remote.name}.`
    this.refresh(false)
    this.focusSelection()
  }

  private asNavigationTarget(entity: SolarMapEntity): SolarMapNavigationTarget {
    return {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      worldPosition: entity.worldPosition.clone(),
      radius: entity.radius,
    }
  }

  private entityFromNavigationTarget(target: SolarMapNavigationTarget, note?: string): SolarMapEntity {
    const distance = this.snapshot ? this.snapshot.playerPosition.distanceTo(target.worldPosition) : 0
    return {
      id: target.id,
      name: target.name,
      kind: target.kind,
      worldPosition: target.worldPosition.clone(),
      distance,
      radius: target.radius,
      targetable: !(target.id === 'player' || target.id === 'sun' || target.id.startsWith('peer.')),
      note: note ?? 'Preview path target stored in the Atlas route list.',
    }
  }

  private currentFocusEntity(): SolarMapEntity | null {
    if (!this.snapshot) return null
    const selectedEntity = this.selected?.userData.entity as SolarMapEntity | undefined
    if (selectedEntity) return selectedEntity
    if (this.selectedRegion && this.selectedId === this.selectedRegion.id) return this.selectedRegion
    const preview = this.selectedPreviewId
      ? this.previewRoutes.find((route) => route.id === this.selectedPreviewId)
      : this.previewRoutes.find((route) => route.target.id === this.selectedId)
    if (preview) {
      return this.entityFromNavigationTarget(
        preview.target,
        preview.stale ? 'Preview path is based on the last known contact position.' : 'Selected preview path target. It is not the active quantum destination.',
      )
    }
    return {
      id: 'player',
      name: 'Your ship',
      kind: 'Current location',
      worldPosition: this.snapshot.playerPosition.clone(),
      distance: 0,
      targetable: false,
      note: 'Atlas origin. Reset returns camera focus and selection here without changing your active destination.',
    }
  }

  private regionEntity(worldPosition: THREE.Vector3): SolarMapEntity {
    if (!this.snapshot) {
      throw new Error('Solar atlas region selection requires an active snapshot.')
    }
    const distance = this.snapshot.playerPosition.distanceTo(worldPosition)
    return {
      id: `region.${Math.round(worldPosition.x)}.${Math.round(worldPosition.y)}.${Math.round(worldPosition.z)}`,
      name: 'Map coordinates',
      kind: 'Coordinate fix',
      worldPosition: worldPosition.clone(),
      distance,
      radius: undefined,
      targetable: true,
      note: this.describeRegion(worldPosition),
    }
  }

  private describeRegion(worldPosition: THREE.Vector3): string {
    const nearest = this.nearestKnown(worldPosition, undefined, 1)[0]
    const active = this.activeDestination()
    const activeDistance = active ? worldPosition.distanceTo(active.worldPosition) : Infinity
    if (active && activeDistance < 6000) return `Near active destination ${active.name}. Use charting to compare the approach with the current jump route.`
    if (!nearest || nearest.distance > 16000) return 'Sparse nav volume. No known contact is close, making this a clean coordinate destination.'
    if (nearest.distance < 3500) return `Near activity: ${nearest.name} is ${formatDistance(nearest.distance)} away. Expect visual or sensor contact nearby.`
    return `Open space with ${nearest.name} as the nearest known object at ${formatDistance(nearest.distance)}.`
  }

  private activeDestination(): SolarMapNavigationTarget | null {
    if (!this.snapshot) return null
    if (this.snapshot.activeDestination) return this.snapshot.activeDestination
    const fallback = PLANETS.find((planet) => planet.name === this.snapshot?.selectedDestinationName)
    if (!fallback) return null
    return {
      id: `planet.${fallback.name}`,
      name: fallback.name,
      kind: fallback.hasRings ? 'Ringed planet' : 'Planet',
      worldPosition: fallback.position.clone(),
      radius: fallback.radius,
    }
  }

  private isActiveDestination(id: string): boolean {
    return this.activeDestination()?.id === id
  }

  private collectKnownEntities(includePlayer: boolean): SolarMapEntity[] {
    if (!this.snapshot) return []
    const origin = this.snapshot.playerPosition
    const entities: SolarMapEntity[] = []
    if (includePlayer) {
      entities.push({
        id: 'player',
        name: 'Your ship',
        kind: 'Current location',
        worldPosition: origin.clone(),
        distance: 0,
        targetable: false,
      })
    }
    entities.push({
      id: 'sun',
      name: 'Nearest sun',
      kind: 'Star',
      worldPosition: SUN_POSITION.clone(),
      distance: origin.distanceTo(SUN_POSITION),
      radius: SUN_RADIUS,
      targetable: false,
    })
    for (const planet of PLANETS) entities.push(this.planetEntity(planet.name, planet.position, planet.radius, origin))
    for (const body of this.snapshot.nearbyCelestials.slice(0, MAX_PROCEDURAL_BODIES)) entities.push(this.celestialEntity(body, origin))
    for (const remote of this.snapshot.remotes.slice(0, MAX_RENDERED_PEERS)) {
      entities.push({
        id: `peer.${remote.id}`,
        name: remote.name,
        kind: 'Pilot',
        worldPosition: remote.position.clone(),
        distance: origin.distanceTo(remote.position),
        speed: remote.velocity?.length(),
        ageMs: remote.ageMs,
        targetable: false,
      })
    }
    const active = this.activeDestination()
    if (active && !entities.some((entity) => entity.id === active.id)) {
      entities.push({
        ...active,
        worldPosition: active.worldPosition.clone(),
        distance: origin.distanceTo(active.worldPosition),
        targetable: true,
        note: 'Active destination from the current navigation state.',
      })
    }
    return entities
  }

  private nearestKnown(worldPosition: THREE.Vector3, excludeId: string | undefined, count: number): Array<SolarMapEntity & { distance: number }> {
    return this.collectKnownEntities(true)
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => ({ ...entity, distance: entity.worldPosition.distanceTo(worldPosition) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count)
  }

  private destinationStatus(entity: SolarMapEntity): string {
    const active = this.activeDestination()
    if (active && entity.id === active.id) return 'active destination'
    if (active && entity.worldPosition.distanceTo(active.worldPosition) < Math.max(600, (entity.radius ?? 0) + (active.radius ?? 0))) {
      return `near active ${active.name}`
    }
    const previewIndex = this.previewRoutes.findIndex((route) => route.target.id === entity.id)
    if (previewIndex >= 0) return `preview path ${previewIndex + 1}`
    return entity.targetable ? 'valid target' : 'reference only'
  }

  private routeProximity(entity: SolarMapEntity): string {
    if (!this.snapshot) return 'none'
    const routes = [
      this.activeDestination() ? { label: 'active', target: this.activeDestination()! } : null,
      ...this.previewRoutes.map((route, index) => ({ label: `preview ${index + 1}`, target: route.target })),
    ].filter((route): route is { label: string; target: SolarMapNavigationTarget } => route !== null)
    if (!routes.length) return 'no route'
    const nearest = routes
      .map((route) => ({
        label: route.label,
        distance: distanceToSegment(entity.worldPosition, this.snapshot!.playerPosition, route.target.worldPosition),
      }))
      .sort((a, b) => a.distance - b.distance)[0]
    return `${formatDistance(nearest.distance)} from ${nearest.label}`
  }

  private renderSummary(): void {
    if (!this.snapshot) return
    const focus = this.currentFocusEntity()
    if (!focus) return
    const nearestPlanet = PLANETS
      .map((planet) => ({ planet, d: planet.position.distanceTo(this.snapshot!.playerPosition) }))
      .sort((a, b) => a.d - b.d)[0]
    const active = this.activeDestination()
    this.titleSubEl.textContent = `ORIGIN ${formatCoord(this.snapshot.playerPosition.x)}, ${formatCoord(this.snapshot.playerPosition.y)}, ${formatCoord(this.snapshot.playerPosition.z)}`
    this.stripEl.innerHTML = [
      `nearest ${nearestPlanet.planet.name} ${formatDistance(nearestPlanet.d)}`,
      `destination ${active?.name ?? 'none'}`,
      `bodies ${this.snapshot.nearbyCelestials.length}`,
      `pilots ${this.snapshot.remotes.length} live`,
      `previews ${this.previewRoutes.length}`,
    ].map((text) => `<span class="solar-map-chip">${escapeHtml(text)}</span>`).join('')

    const radiusRow = focus.radius
      ? `<div class="solar-map-row"><span>RADIUS / SCALE</span><b>${formatDistance(focus.radius)}</b></div>`
      : ''
    const speedRow = typeof focus.speed === 'number'
      ? `<div class="solar-map-row"><span>SPEED</span><b>${Math.round(focus.speed).toLocaleString()} m/s</b></div>`
      : ''
    const freshnessRow = typeof focus.ageMs === 'number'
      ? `<div class="solar-map-row"><span>RELAY</span><b>${formatAge(focus.ageMs)}</b></div>`
      : ''
    const nearby = this.nearestKnown(focus.worldPosition, focus.id, 3)
      .map((entity) => `${entity.name} ${formatDistance(entity.distance)}`)
      .join(' | ') || 'none'
    this.inspectorEl.innerHTML = `
      <h2>${escapeHtml(focus.name.toUpperCase())}</h2>
      <div class="solar-map-row"><span>TYPE</span><b>${escapeHtml(focus.kind)}</b></div>
      <div class="solar-map-row"><span>DISTANCE</span><b>${formatDistance(focus.distance)}</b></div>
      <div class="solar-map-row"><span>DESTINATION</span><b>${escapeHtml(this.destinationStatus(focus))}</b></div>
      ${radiusRow}
      ${speedRow}
      ${freshnessRow}
      <div class="solar-map-row"><span>X</span><b>${formatCoord(focus.worldPosition.x)}</b></div>
      <div class="solar-map-row"><span>Y</span><b>${formatCoord(focus.worldPosition.y)}</b></div>
      <div class="solar-map-row"><span>Z</span><b>${formatCoord(focus.worldPosition.z)}</b></div>
      <div class="solar-map-row"><span>ROUTE PROX</span><b>${escapeHtml(this.routeProximity(focus))}</b></div>
      <div class="solar-map-row solar-map-row-stack"><span>NEARBY</span><b>${escapeHtml(nearby)}</b></div>
      <div class="solar-map-note">${escapeHtml(focus.note ?? 'Click a marker or empty space to inspect local navigation context.')}</div>
    `
    this.renderActionButtons(focus)
    this.renderLayerControls()
    this.renderPreviewRoutes()
    this.renderContactList()
  }

  private renderActionButtons(focus?: SolarMapEntity): void {
    const selected = focus ?? this.currentFocusEntity()
    const canChart = !!selected && selected.id !== 'player' && selected.chartable !== false
    const canSet = !!selected?.targetable
    const selectedPreview = this.selectedPreviewId ? this.previewRoutes.find((route) => route.id === this.selectedPreviewId) : null
    this.actionsEl.innerHTML = `
      <button data-action="reset" data-testid="solar-map-reset">Focus Self</button>
      <button data-action="focus" data-testid="solar-map-focus" ${selected ? '' : 'disabled'}>Focus Target</button>
      <button data-action="chart" data-testid="solar-map-chart" ${canChart ? '' : 'disabled'}>Chart Path</button>
      <button data-action="set-destination" data-testid="solar-map-set-destination" ${canSet ? '' : 'disabled'}>Set Destination</button>
      <button data-action="clear-route" data-testid="solar-map-clear-route" ${selectedPreview ? '' : 'disabled'}>Remove Selected</button>
    `
    this.actionStatusEl.textContent = this.actionStatus
  }

  private renderLayerControls(): void {
    this.layerControlsEl.innerHTML = LAYER_DEFS.map(({ key, label }) => `
      <button data-action="toggle-layer" data-layer="${key}" data-testid="solar-map-layer-${key}" aria-pressed="${this.layers[key] ? 'true' : 'false'}">${label}</button>
    `).join('')
  }

  private renderPreviewRoutes(): void {
    const clearButton = this.root.querySelector('[data-action="clear-previews"]') as HTMLButtonElement | null
    if (clearButton) clearButton.disabled = this.previewRoutes.length === 0
    if (!this.previewRoutes.length) {
      this.previewListEl.innerHTML = '<div class="solar-map-preview-empty">No preview paths charted.</div>'
      return
    }
    const origin = this.snapshot?.playerPosition
    this.previewListEl.innerHTML = this.previewRoutes.map((route, index) => {
      const distance = origin ? origin.distanceTo(route.target.worldPosition) : 0
      const selected = route.id === this.selectedPreviewId
      const meta = [
        route.stale ? 'last known' : route.target.kind,
        formatDistance(distance),
        `path ${index + 1}`,
      ].join(' | ')
      return `
        <div class="solar-map-preview-row ${selected ? 'selected' : ''} ${route.stale ? 'stale' : ''}" data-testid="solar-map-preview-row" data-route-id="${escapeHtml(route.id)}">
          <span class="solar-map-route-swatch" style="color:${colorToCss(route.color)}; background:${colorToCss(route.color)}"></span>
          <span class="solar-map-route-main">
            <span class="solar-map-route-name">${escapeHtml(route.target.name)}</span>
            <span class="solar-map-route-meta">${escapeHtml(meta)}</span>
          </span>
          <button data-action="select-preview" data-route-id="${escapeHtml(route.id)}">Select</button>
          <button data-action="focus-preview" data-route-id="${escapeHtml(route.id)}">Focus</button>
          <button data-action="remove-preview" data-route-id="${escapeHtml(route.id)}" aria-label="Remove ${escapeHtml(route.target.name)} preview path">x</button>
        </div>
      `
    }).join('')
  }

  private renderContactList(): void {
    if (!this.layers.contacts) {
      this.contactsListEl.innerHTML = '<div class="solar-map-contact-empty">Pilot layer hidden.</div>'
      return
    }
    if (!this.snapshot?.remotes.length) {
      this.contactsListEl.innerHTML = '<div class="solar-map-contact-empty">No pilot contacts.</div>'
      return
    }
    const origin = this.snapshot.playerPosition
    this.contactsListEl.innerHTML = this.snapshot.remotes.slice(0, 6).map((remote) => {
      const routeId = `peer.${remote.id}`
      const selected = routeId === this.selectedId
      const stale = (remote.ageMs ?? 0) > 1800
      const distance = origin.distanceTo(remote.position)
      const speed = remote.velocity?.length()
      const meta = [
        formatDistance(distance),
        typeof speed === 'number' ? `${Math.round(speed).toLocaleString()} m/s` : null,
        typeof remote.ageMs === 'number' ? formatAge(remote.ageMs) : null,
      ].filter((part): part is string => !!part).join(' | ')
      return `
        <div class="solar-map-contact-row ${selected ? 'selected' : ''} ${stale ? 'stale' : ''}" data-testid="solar-map-contact-row">
          <span class="solar-map-contact-dot" style="color:${colorToCss(remote.color)}; background:${colorToCss(remote.color)}"></span>
          <span class="solar-map-contact-main">
            <span class="solar-map-contact-name">${escapeHtml(remote.name)}</span>
            <span class="solar-map-contact-meta">${escapeHtml(meta || 'relay contact')}</span>
          </span>
          <button data-action="focus-remote" data-route-id="${escapeHtml(routeId)}">Focus</button>
        </div>
      `
    }).join('')
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen) return
    if (event.code === 'Escape' || event.code === 'KeyM') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
    }
  }
}
