// Procedural singularity: a pure-black event-horizon sphere, a white-hot photon ring hugging it, a
// big hot-gradient accretion disk, a soft additive glow halo, and an infall particle swarm. Visual
// only. Placed at BLACK_HOLE_CENTER. Look is tuned in-game; the interface (group + update) is stable.
import * as THREE from 'three'
import { BLACK_HOLE_CENTER, HORIZON_RADIUS } from '../sim/blackHole'

export interface BlackHoleVisual {
  group: THREE.Group
  /** `facing` (0..1) = how head-on the camera is looking at the hole; drives the lens flare. */
  update(dt: number, facing?: number): void
}

const DISK_TILT = Math.PI / 2.35

/** Soft radial-gradient glow sprite texture. Returns null in headless tests (no document). */
function glowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,240,214,0.85)')
  g.addColorStop(0.25, 'rgba(255,178,74,0.42)')
  g.addColorStop(0.6, 'rgba(150,92,255,0.14)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

/** Anamorphic lens-flare texture: a bright core with a wide horizontal streak. Null in tests. */
function flareTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const w = 512
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // horizontal streak
  const streak = ctx.createLinearGradient(0, 0, w, 0)
  streak.addColorStop(0, 'rgba(120,170,255,0)')
  streak.addColorStop(0.5, 'rgba(200,225,255,0.9)')
  streak.addColorStop(1, 'rgba(120,170,255,0)')
  ctx.fillStyle = streak
  ctx.fillRect(0, h / 2 - 2, w, 4)
  // bright round core
  const core = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h / 2)
  core.addColorStop(0, 'rgba(255,255,255,0.95)')
  core.addColorStop(0.4, 'rgba(190,210,255,0.5)')
  core.addColorStop(1, 'rgba(120,170,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, w, h)
  return new THREE.CanvasTexture(canvas)
}

export function buildBlackHole(): BlackHoleVisual {
  const group = new THREE.Group()
  group.position.copy(BLACK_HOLE_CENTER)

  // Event horizon — pure black sphere that fully occludes stars behind it.
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(HORIZON_RADIUS, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  )
  group.add(horizon)

  // Photon ring — a thin white-hot rim hugging the horizon edge.
  const photon = new THREE.Mesh(
    new THREE.RingGeometry(HORIZON_RADIUS * 1.02, HORIZON_RADIUS * 1.2, 128, 1),
    new THREE.MeshBasicMaterial({
      color: 0xfff2d6, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  )
  photon.rotation.x = DISK_TILT
  group.add(photon)

  // Accretion disk — big, bright, hot gradient (white-blue inner → orange → deep red outer).
  const inner = HORIZON_RADIUS * 1.32
  const outer = HORIZON_RADIUS * 7
  const diskGeo = new THREE.RingGeometry(inner, outer, 128, 12)
  const pos = diskGeo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const cInner = new THREE.Color(0xfff0ff)
  const cMid = new THREE.Color(0xffb24a)
  const cOuter = new THREE.Color(0x7a1e2e)
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const r = Math.hypot(x, y)
    const t = THREE.MathUtils.clamp((r - inner) / (outer - inner), 0, 1)
    if (t < 0.5) tmp.copy(cInner).lerp(cMid, t / 0.5)
    else tmp.copy(cMid).lerp(cOuter, (t - 0.5) / 0.5)
    // Relativistic Doppler beaming: the side rotating toward the viewer is brighter + blue-shifted,
    // the receding side dimmer + red-shifted. `beam` is +1 on the approaching limb, -1 on the receding.
    const beam = Math.cos(Math.atan2(y, x))
    tmp.multiplyScalar(1 + 0.55 * beam)
    if (beam > 0) tmp.b = Math.min(1, tmp.b + 0.35 * beam) // blue-shift the approaching limb
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  diskGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const disk = new THREE.Mesh(diskGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  }))
  disk.rotation.x = DISK_TILT
  group.add(disk)

  // Glow halo — soft additive bloom so the hole reads as a hot light source from far away.
  const tex = glowTexture()
  if (tex) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    glow.scale.setScalar(outer * 2.4)
    group.add(glow)
  }

  // Infall particles — a dense swarm spiralling inward.
  const COUNT = 320
  const positions = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 * 3
    const r = HORIZON_RADIUS * (1.25 + Math.random() * 5.5)
    positions[i * 3] = Math.cos(a) * r
    positions[i * 3 + 1] = (Math.random() - 0.5) * HORIZON_RADIUS * 0.35
    positions[i * 3 + 2] = Math.sin(a) * r
  }
  const pgeo = new THREE.BufferGeometry()
  pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const infall = new THREE.Points(pgeo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: HORIZON_RADIUS * 0.05, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }))
  infall.rotation.x = DISK_TILT
  group.add(infall)

  // Lens flare — an anamorphic streak that flares up when the camera looks head-on at the hole.
  const flareTex = flareTexture()
  const flare = flareTex
    ? new THREE.Sprite(new THREE.SpriteMaterial({
        map: flareTex, color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      }))
    : null
  if (flare) {
    flare.scale.set(outer * 6, outer * 1.5, 1)
    group.add(flare)
  }

  return {
    group,
    update(dt: number, facing = 1): void {
      disk.rotation.z += dt * 0.18
      photon.rotation.z -= dt * 0.15
      infall.rotation.z -= dt * 0.4
      if (flare) {
        // ramp hard toward head-on so the flare is a payoff for looking into the hole, not constant
        const target = Math.max(0, Math.min(1, facing)) ** 3 * 0.9
        flare.material.opacity += (target - flare.material.opacity) * Math.min(1, dt * 4)
      }
    },
  }
}
