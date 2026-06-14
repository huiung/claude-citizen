import * as THREE from 'three'
import type { ShipType } from '../sim/shipTypes'

/**
 * Shipyard — procedural low-poly flat-shaded hulls, one distinct silhouette per
 * ship class. No asset files: the silhouette is the identity, exactly as in
 * render/ship.ts. Forward is -Z throughout. The 'hauler' case reproduces the
 * stock craft from ship.ts so the catalog and the live ship read identically.
 *
 * render-only: this module must NOT import game logic from sim/ (the ShipType
 * union is a type-only import and erases at compile time).
 */
export function buildCraft(type: ShipType, color: number): THREE.Group {
  switch (type) {
    case 'hauler':
      return buildHauler(color)
    case 'fighter':
      return buildFighter(color)
    case 'miner':
      return buildMiner(color)
    case 'interceptor':
      return buildInterceptor(color)
  }
}

/** Shared material factory — keeps the flat-shaded low-poly look consistent. */
function makeMaterials(color: number): {
  hull: THREE.MeshStandardMaterial
  dark: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
} {
  return {
    hull: new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.4, roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2f36, flatShading: true, metalness: 0.55, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x66e0ff, flatShading: true, emissive: 0x113344, metalness: 0.1, roughness: 0.2 }),
  }
}

/** Stock hauler — central cargo container, side nacelles, rear engine cluster,
 *  nose mining rig. Mirrors render/ship.ts buildShip so they read identically. */
function buildHauler(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat } = makeMaterials(color)

  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 4.2), hullMat)
  group.add(cargo)
  for (const z of [-1.1, 0, 1.1]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.22), darkMat)
    rib.position.z = z
    group.add(rib)
  }

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.4), darkMat)
  cockpit.position.set(0, 0.35, -2.7)
  group.add(cockpit)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.7), glassMat)
  canopy.position.set(0, 0.5, -3.2)
  group.add(canopy)

  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.6), darkMat)
    strut.position.set(side * 1.4, 0, 0.4)
    group.add(strut)
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.8, 6), hullMat)
    nacelle.rotation.x = Math.PI / 2
    nacelle.position.set(side * 1.95, 0, 0.3)
    group.add(nacelle)
    const ng = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), new THREE.MeshBasicMaterial({ color: 0x7fd4ff }))
    ng.position.set(side * 1.95, 0, 1.71)
    group.add(ng)
  }

  for (const [x, y] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]] as [number, number][]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.46, 1.0, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(x, y, 2.4)
    group.add(engine)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 8), new THREE.MeshBasicMaterial({ color: 0x9fe0ff }))
    glow.position.set(x, y, 2.95)
    group.add(glow)
  }

  const rig = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.2), darkMat)
  rig.position.set(0, -0.7, -2.9)
  group.add(rig)
  const emitter = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: 0x6fe8ff }))
  emitter.position.set(0, -0.7, -3.6)
  group.add(emitter)

  return group
}

/** Strike fighter — sleek dart fuselage, swept delta wings, twin engines, small
 *  forward canopy. Small footprint, all forward thrust, reads as a hot rod. */
function buildFighter(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat } = makeMaterials(color)

  // Slim tapering fuselage — a cone nose blended into a thin body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 3.4), hullMat)
  group.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 6), hullMat)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0, -2.4)
  group.add(nose)

  // Bubble canopy slightly forward and up.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.9), glassMat)
  canopy.position.set(0, 0.4, -0.9)
  group.add(canopy)

  // Swept delta wings — flat trapezoids angled back, the fighter signature.
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), hullMat)
    wing.position.set(side * 1.3, -0.05, 0.5)
    wing.rotation.y = side * -0.35
    group.add(wing)
    // Wingtip cannon.
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 5), darkMat)
    cannon.rotation.x = Math.PI / 2
    cannon.position.set(side * 2.3, -0.05, -0.3)
    group.add(cannon)
  }

  // Tail fin for that aerofoil read.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.9), darkMat)
  fin.position.set(0, 0.5, 1.4)
  group.add(fin)

  // Twin tail engines + glow.
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.9, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.4, 0, 1.9)
    group.add(engine)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 8), new THREE.MeshBasicMaterial({ color: 0x9fe0ff }))
    glow.position.set(side * 0.4, 0, 2.36)
    group.add(glow)
  }

  return group
}

/** Mining rig — bulky boxy hull with a huge cargo drum, two forward drill arms
 *  ending in spinning bits, and squat heavy engines. Reads slow and industrial. */
function buildMiner(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat } = makeMaterials(color)

  // Heavy chassis.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 3.6), hullMat)
  group.add(chassis)

  // Big rear cargo drum — the defining mass.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 10), hullMat)
  drum.rotation.x = Math.PI / 2
  drum.position.set(0, 0, 2.1)
  group.add(drum)
  // Drum bands.
  for (const z of [1.4, 2.1, 2.8]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.12, 6, 12), darkMat)
    band.position.set(0, 0, z)
    group.add(band)
  }

  // Forward cockpit block + visor.
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), darkMat)
  cockpit.position.set(0, 0.7, -2.0)
  group.add(cockpit)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.3), glassMat)
  visor.position.set(0, 0.75, -2.55)
  group.add(visor)

  // Two forward drill arms with conical drill bits — the mining read.
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 2.2), darkMat)
    arm.position.set(side * 1.1, -0.4, -2.4)
    group.add(arm)
    const drill = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 6), hullMat)
    drill.rotation.x = -Math.PI / 2
    drill.position.set(side * 1.1, -0.4, -3.8)
    group.add(drill)
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: 0xffd27f }))
    tip.position.set(side * 1.1, -0.4, -4.5)
    group.add(tip)
  }

  // Squat heavy engine block + dim glows.
  for (const [x, y] of [[-0.9, 0.5], [0.9, 0.5], [-0.9, -0.5], [0.9, -0.5]] as [number, number][]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.8, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(x, y, 3.4)
    group.add(engine)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 8), new THREE.MeshBasicMaterial({ color: 0xffb24d }))
    glow.position.set(x, y, 3.82)
    group.add(glow)
  }

  return group
}

/** Pirate interceptor — angular arrowhead hull, forward-swept aggressive wings,
 *  underslung cannons, oversized rear engines. Sharp and predatory. */
function buildInterceptor(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat } = makeMaterials(color)

  // Arrowhead fuselage — a flattened octahedron gives hard angular facets.
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), hullMat)
  body.scale.set(0.8, 0.5, 1.9)
  group.add(body)

  // Sharp piercing nose spike.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.0, 4), hullMat)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0, -2.6)
  group.add(nose)

  // Slit canopy.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.0), glassMat)
  canopy.position.set(0, 0.35, -0.8)
  group.add(canopy)

  // Forward-swept angular wings — aggressive, leaning toward the prey.
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.1), darkMat)
    wing.position.set(side * 1.4, 0, 0.2)
    wing.rotation.y = side * 0.4
    wing.rotation.z = side * 0.18
    group.add(wing)
    // Underslung cannon pods.
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.6), hullMat)
    pod.position.set(side * 1.9, -0.25, -0.6)
    group.add(pod)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5), darkMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(side * 1.9, -0.25, -1.6)
    group.add(barrel)
  }

  // Twin dorsal tail fins, canted out — menacing.
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.0), darkMat)
    fin.position.set(side * 0.45, 0.6, 1.3)
    fin.rotation.z = side * -0.4
    group.add(fin)
  }

  // Oversized rear engines with hot red glow — pirate menace.
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.3, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.55, 0, 2.0)
    group.add(engine)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), new THREE.MeshBasicMaterial({ color: 0xff5a3c }))
    glow.position.set(side * 0.55, 0, 2.66)
    group.add(glow)
  }

  return group
}
