import * as THREE from 'three'

/** Procedural low-poly fighter. No asset files — geometry is the identity. */
export function buildShip(color: number): THREE.Group {
  const group = new THREE.Group()
  const hullMat = new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.35, roughness: 0.6 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x20262e, flatShading: true, metalness: 0.5, roughness: 0.5 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x66e0ff, flatShading: true, emissive: 0x113344, metalness: 0.1, roughness: 0.2 })

  // Fuselage: stretched octahedron reads as a spearhead
  const fuselage = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), hullMat)
  fuselage.scale.set(0.55, 0.4, 2.2)
  group.add(fuselage)

  // Cockpit bubble
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 4), glassMat)
  cockpit.position.set(0, 0.42, -0.6)
  cockpit.scale.set(1, 0.7, 1.4)
  group.add(cockpit)

  // Wings
  const wingGeo = new THREE.BoxGeometry(2.6, 0.08, 1.1)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hullMat)
    wing.position.set(side * 1.55, -0.1, 0.7)
    wing.rotation.z = side * 0.18
    group.add(wing)
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.3), darkMat)
    tip.position.set(side * 2.8, 0.05, 0.7)
    group.add(tip)
  }

  // Engines + glow
  const engineGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.9, 6)
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(engineGeo, darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.55, -0.05, 1.7)
    group.add(engine)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 8),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff }),
    )
    glow.position.set(side * 0.55, -0.05, 2.16)
    group.add(glow)
  }

  return group
}
