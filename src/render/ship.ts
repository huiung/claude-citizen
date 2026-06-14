import * as THREE from 'three'

/**
 * Procedural low-poly hauler — a space working craft, not a fighter. The defining
 * mass is a central cargo container; side nacelles replace wings, a rear engine
 * cluster pushes it, and a small mining rig juts from the nose. No asset files —
 * the silhouette is the identity.
 */
export function buildShip(color: number): THREE.Group {
  const group = new THREE.Group()
  const hullMat = new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.4, roughness: 0.6 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, flatShading: true, metalness: 0.55, roughness: 0.5 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x66e0ff, flatShading: true, emissive: 0x113344, metalness: 0.1, roughness: 0.2 })

  // Central cargo container — the bulk of a hauler. Forward is -Z.
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 4.2), hullMat)
  group.add(cargo)
  // Container ribs for read at a glance
  for (const z of [-1.1, 0, 1.1]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.22), darkMat)
    rib.position.z = z
    group.add(rib)
  }

  // Forward cockpit module + canopy
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.4), darkMat)
  cockpit.position.set(0, 0.35, -2.7)
  group.add(cockpit)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.7), glassMat)
  canopy.position.set(0, 0.5, -3.2)
  group.add(canopy)

  // Side nacelles on struts — replace wings, read as engines not aerofoils
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

  // Rear main engine cluster — four thrusters
  for (const [x, y] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]] as [number, number][]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.46, 1.0, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(x, y, 2.4)
    group.add(engine)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 8), new THREE.MeshBasicMaterial({ color: 0x9fe0ff }))
    glow.position.set(x, y, 2.95)
    group.add(glow)
  }

  // Forward mining rig — a short arm + emitter, nodding at what this craft does
  const rig = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.2), darkMat)
  rig.position.set(0, -0.7, -2.9)
  group.add(rig)
  const emitter = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: 0x6fe8ff }))
  emitter.position.set(0, -0.7, -3.6)
  group.add(emitter)

  return group
}
