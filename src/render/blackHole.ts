// Procedural singularity: a pure-black event-horizon sphere, a hot additive accretion disk, and a
// thin infall particle ring. Visual only. Placed at BLACK_HOLE_CENTER. Look is tuned in-game; the
// interface (group + update) is stable.
import * as THREE from 'three'
import { BLACK_HOLE_CENTER, HORIZON_RADIUS } from '../sim/blackHole'

export interface BlackHoleVisual {
  group: THREE.Group
  update(dt: number): void
}

export function buildBlackHole(): BlackHoleVisual {
  const group = new THREE.Group()
  group.position.copy(BLACK_HOLE_CENTER)

  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(HORIZON_RADIUS, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  )
  group.add(horizon)

  const disk = new THREE.Mesh(
    new THREE.RingGeometry(HORIZON_RADIUS * 1.25, HORIZON_RADIUS * 4.5, 96, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffb24a, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  )
  disk.rotation.x = Math.PI / 2.35
  group.add(disk)

  const COUNT = 220
  const positions = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2
    const r = HORIZON_RADIUS * (1.3 + Math.random() * 3.1)
    positions[i * 3] = Math.cos(a) * r
    positions[i * 3 + 1] = (Math.random() - 0.5) * HORIZON_RADIUS * 0.3
    positions[i * 3 + 2] = Math.sin(a) * r
  }
  const pgeo = new THREE.BufferGeometry()
  pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const infall = new THREE.Points(pgeo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: HORIZON_RADIUS * 0.06, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }))
  infall.rotation.x = disk.rotation.x
  group.add(infall)

  return {
    group,
    update(dt: number): void {
      disk.rotation.z += dt * 0.25
      infall.rotation.z -= dt * 0.4
    },
  }
}
