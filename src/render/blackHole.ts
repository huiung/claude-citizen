// Procedural singularity: a pure-black event-horizon sphere, a white-hot photon ring hugging it, a
// big hot-gradient accretion disk, a soft additive glow halo, and an infall particle swarm. Visual
// only. Placed at BLACK_HOLE_CENTER. Look is tuned in-game; the interface (group + update) is stable.
import * as THREE from 'three'
import { BLACK_HOLE_CENTER, HORIZON_RADIUS } from '../sim/blackHole'

export interface BlackHoleVisual {
  group: THREE.Group
  /** `visible` (0..1) = distance fade for the glow/disk so it doesn't loom from across the system. */
  update(dt: number, visible?: number): void
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

  // Big glow halo — soft additive bloom so the hole reads as a hot light source up close. Distance-
  // faded in update() so it doesn't loom over half the screen from across the system (e.g. at spawn).
  const tex = glowTexture()
  let glow: THREE.Sprite | null = null
  if (tex) {
    glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    glow.scale.setScalar(outer * 2.4)
    group.add(glow)
  }

  // Small core glow — always on (not distance-faded), small enough to read as a bright point from
  // across the system. This is the far-away landmark; up close it's swallowed by the disk.
  if (tex) {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffe9c8, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    core.scale.setScalar(HORIZON_RADIUS * 2.6)
    group.add(core)
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

  return {
    group,
    update(dt: number, visible = 1): void {
      disk.rotation.z += dt * 0.18
      photon.rotation.z -= dt * 0.15
      infall.rotation.z -= dt * 0.4
      // Distance fade: full grandeur up close, nothing from across the system.
      const v = Math.max(0, Math.min(1, visible))
      photon.material.opacity = 0.95 * v
      ;(disk.material as THREE.MeshBasicMaterial).opacity = 0.85 * v
      ;(infall.material as THREE.PointsMaterial).opacity = 0.85 * v
      if (glow) glow.material.opacity = 0.7 * v
    },
  }
}
