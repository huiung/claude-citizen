import * as THREE from 'three'

/** Deterministic pseudo-random — same world for every visitor, no assets. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildStarfield(): THREE.Points {
  const rand = mulberry32(42)
  const count = 6000
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // Uniform on sphere shell, far away
    const r = 18000 + rand() * 4000
    const theta = rand() * Math.PI * 2
    const z = rand() * 2 - 1
    const s = Math.sqrt(1 - z * z)
    positions[i * 3] = r * s * Math.cos(theta)
    positions[i * 3 + 1] = r * s * Math.sin(theta)
    positions[i * 3 + 2] = r * z
    color.setHSL(0.55 + rand() * 0.15, rand() * 0.4, 0.6 + rand() * 0.4)
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({ size: 18, vertexColors: true, sizeAttenuation: true, fog: false })
  return new THREE.Points(geo, mat)
}

export function buildPlanet(): THREE.Group {
  const group = new THREE.Group()
  const rand = mulberry32(7)
  const geo = new THREE.IcosahedronGeometry(2200, 4)
  // Displace vertices for a low-poly terrain look
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const colors = new Float32Array(pos.count * 3)
  const ocean = new THREE.Color(0x1b3d5c)
  const land = new THREE.Color(0x3c6e47)
  const peak = new THREE.Color(0x8d8d7a)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = rand()
    const h = n > 0.62 ? (n - 0.62) * 180 : 0
    v.setLength(2200 + h)
    pos.setXYZ(i, v.x, v.y, v.z)
    if (h === 0) c.copy(ocean)
    else if (h < 40) c.copy(land)
    else c.copy(peak)
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const planet = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  )
  group.add(planet)

  // Atmosphere shell
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(2330, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0.12, side: THREE.BackSide }),
  )
  group.add(atmo)
  group.position.set(-4500, -1200, -7000)
  return group
}

// Shared world positions — render and sim (docking) read the same source.
export const REFINERY_POS = new THREE.Vector3(120, 30, -350)
export const COLONY_POS = new THREE.Vector3(-1900, -800, -7000)

// Mineable ORE asteroids near the spawn corridor — sim (mining) and render share these.
export const MINEABLE_SITES: ReadonlyArray<{ id: string; position: THREE.Vector3; reserves: number }> = [
  { id: 'rock-1', position: new THREE.Vector3(70, 10, -140), reserves: 220 },
  { id: 'rock-2', position: new THREE.Vector3(-60, -25, -180), reserves: 220 },
  { id: 'rock-3', position: new THREE.Vector3(160, -20, -240), reserves: 300 },
]

/** A large, visually distinct mineable rock with glowing ORE veins. Caller positions/scales it. */
export function buildMineableAsteroid(): THREE.Group {
  const group = new THREE.Group()
  const rand = mulberry32(99)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a5048, flatShading: true, roughness: 1 })
  const geo = new THREE.IcosahedronGeometry(20, 1)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    v.multiplyScalar(0.7 + rand() * 0.6)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  group.add(new THREE.Mesh(geo, rockMat))

  // Glowing ORE veins so pilots can spot a mineable rock at a glance.
  const veinMat = new THREE.MeshBasicMaterial({ color: 0x4fd0e0 })
  for (let i = 0; i < 7; i++) {
    const vein = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rand() * 1.5, 0), veinMat)
    const a = rand() * Math.PI * 2
    const b = rand() * Math.PI
    const r = 15 + rand() * 6
    vein.position.set(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a))
    group.add(vein)
  }
  return group
}

export function buildStation(): THREE.Group {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, metalness: 0.6, roughness: 0.4 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, flatShading: true, metalness: 0.7, roughness: 0.35 })

  const ring = new THREE.Mesh(new THREE.TorusGeometry(60, 7, 8, 24), hull)
  group.add(ring)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 26, 8), dark)
  hub.rotation.x = Math.PI / 2
  group.add(hub)
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 52), hull)
    spoke.rotation.z = (i / 4) * Math.PI * 2
    spoke.position.set(Math.cos(spoke.rotation.z) * 30, Math.sin(spoke.rotation.z) * 30, 0)
    spoke.lookAt(0, 0, 0)
    group.add(spoke)
  }
  // Docking beacon lights
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x66ff88 }),
    )
    light.position.set(0, 0, side * 16)
    group.add(light)
  }
  group.position.copy(REFINERY_POS)
  return group
}

/** Mining colony near the planet — the other end of the trade loop. Distinct silhouette. */
export function buildColony(): THREE.Group {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0xb58a3a, flatShading: true, metalness: 0.5, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x33291a, flatShading: true, metalness: 0.6, roughness: 0.5 })

  // Central drum
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 70, 8), hull)
  group.add(drum)
  // Cap domes
  for (const y of [-40, 40]) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(34, 20, 8), dark)
    cap.position.y = y
    cap.rotation.x = y > 0 ? 0 : Math.PI
    group.add(cap)
  }
  // Mining arms jutting outward
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(70, 5, 5), dark)
    const a = (i / 5) * Math.PI * 2
    arm.position.set(Math.cos(a) * 45, (i - 2) * 12, Math.sin(a) * 45)
    arm.rotation.y = -a
    group.add(arm)
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 0), hull)
    pod.position.set(Math.cos(a) * 82, (i - 2) * 12, Math.sin(a) * 82)
    group.add(pod)
  }
  // Amber docking beacons (vs the station's green)
  for (const y of [-44, 44]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffb347 }),
    )
    light.position.set(0, y, 0)
    group.add(light)
  }
  group.position.copy(COLONY_POS)
  return group
}

export function buildAsteroids(): THREE.Group {
  const group = new THREE.Group()
  const rand = mulberry32(1337)
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b6258, flatShading: true, roughness: 1 })
  const baseGeos = [0, 1, 2].map(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      v.multiplyScalar(0.75 + rand() * 0.5)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    return geo
  })
  for (let i = 0; i < 140; i++) {
    const rock = new THREE.Mesh(baseGeos[i % 3], mat)
    // Scatter in a loose belt around the spawn corridor
    const angle = rand() * Math.PI * 2
    const radius = 250 + rand() * 900
    rock.position.set(
      Math.cos(angle) * radius,
      (rand() - 0.5) * 500,
      Math.sin(angle) * radius - 300,
    )
    rock.scale.setScalar(2 + rand() * 14)
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(rock)
  }
  return group
}

export function buildLights(scene: THREE.Scene): void {
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4)
  sun.position.set(8000, 3000, 5000)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x223344, 0.7))
}
