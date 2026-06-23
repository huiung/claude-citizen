import * as THREE from 'three'

export interface SeasonHubLifeRig {
  root: THREE.Group
  transitRings: THREE.Object3D[]
  shuttles: THREE.Object3D[]
  beacons: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
  guideLights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
}

function glowMaterial(color: number, opacity = 0.88): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
  })
}

function addShuttle(root: THREE.Group, index: number): THREE.Group {
  const group = new THREE.Group()
  group.name = `season hub shuttle ${index}`
  const color = index % 2 ? 0xffd24d : 0x5df4ff
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(14, 46, 5),
    new THREE.MeshBasicMaterial({ color }),
  )
  hull.rotation.x = Math.PI / 2
  group.add(hull)
  const trail = new THREE.Mesh(
    new THREE.ConeGeometry(8, 54, 5),
    glowMaterial(color, 0.34),
  )
  trail.position.z = 42
  trail.rotation.x = -Math.PI / 2
  group.add(trail)
  root.add(group)
  return group
}

export function createSeasonHubLifeRig(): SeasonHubLifeRig {
  const root = new THREE.Group()
  root.name = 'Citizen Season 1 Hub Life Rig'

  const transitRings = [
    new THREE.Mesh(new THREE.TorusGeometry(640, 3.2, 8, 128), glowMaterial(0x5df4ff, 0.52)),
    new THREE.Mesh(new THREE.TorusGeometry(910, 4.2, 8, 160), glowMaterial(0xffd24d, 0.42)),
    new THREE.Mesh(new THREE.TorusGeometry(530, 2.6, 8, 128), glowMaterial(0xff61d7, 0.34)),
  ]
  transitRings[0].name = 'season hub animated inner transit ring'
  transitRings[1].name = 'season hub animated outer transit ring'
  transitRings[2].name = 'season hub animated elevated transit ring'
  transitRings[0].rotation.x = Math.PI / 2
  transitRings[1].rotation.x = Math.PI / 2
  transitRings[2].rotation.set(Math.PI / 2, 0.18, 0.12)
  transitRings[0].position.y = 115
  transitRings[1].position.y = 148
  transitRings[2].position.y = 360
  for (const ring of transitRings) root.add(ring)

  const shuttles = Array.from({ length: 9 }, (_, index) => addShuttle(root, index))

  const beacons: SeasonHubLifeRig['beacons'] = []
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2
    const radius = i % 2 ? 735 : 570
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(i % 3 ? 15 : 20, 0),
      glowMaterial(i % 2 ? 0xffd24d : 0x5df4ff, 0.74),
    )
    beacon.name = `season hub pulse beacon ${i}`
    beacon.position.set(Math.cos(angle) * radius, 190 + (i % 4) * 44, Math.sin(angle) * radius)
    root.add(beacon)
    beacons.push(beacon)
  }

  const guideLights: SeasonHubLifeRig['guideLights'] = []
  for (let i = 0; i < 18; i++) {
    const z = 155 + i * 42
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(18, 5, 10),
      glowMaterial(i % 2 ? 0xffd24d : 0x5df4ff, 0.45),
    )
    light.name = `season hub docking guide light ${i}`
    light.position.set(i % 2 ? 58 : -58, 104, z)
    root.add(light)
    guideLights.push(light)
  }

  return { root, transitRings, shuttles, beacons, guideLights }
}

export function updateSeasonHubLifeRig(rig: SeasonHubLifeRig, time: number, dt: number): void {
  rig.transitRings.forEach((ring, index) => {
    ring.rotation.z += dt * (0.08 + index * 0.035) * (index === 1 ? -1 : 1)
  })

  rig.shuttles.forEach((shuttle, index) => {
    const orbit = index % 3
    const radius = orbit === 0 ? 620 : orbit === 1 ? 820 : 510
    const height = orbit === 2 ? 365 : 178 + (index % 2) * 34
    const speed = 0.16 + index * 0.013
    const angle = time * speed + index * ((Math.PI * 2) / rig.shuttles.length)
    shuttle.position.set(Math.cos(angle) * radius, height + Math.sin(time * 0.7 + index) * 18, Math.sin(angle) * radius)
    shuttle.rotation.set(0, -angle + Math.PI / 2, 0)
  })

  rig.beacons.forEach((beacon, index) => {
    const pulse = 0.78 + Math.sin(time * 2.3 + index * 0.7) * 0.22
    beacon.scale.setScalar(pulse)
    beacon.material.opacity = 0.48 + pulse * 0.34
  })

  rig.guideLights.forEach((light, index) => {
    const phase = (time * 2.2 + index * 0.38) % (Math.PI * 2)
    const pulse = 0.35 + Math.max(0, Math.sin(phase)) * 0.55
    light.material.opacity = pulse
    light.scale.z = 0.8 + pulse * 0.7
  })
}
