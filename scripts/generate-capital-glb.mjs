import fs from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

class NodeFileReader {
  result = null
  onloadend = null

  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer()
    this.onloadend?.()
  }
}

globalThis.FileReader = globalThis.FileReader ?? NodeFileReader

const outDir = path.resolve('public/assets/ships')

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    metalness: options.metalness ?? 0.58,
    roughness: options.roughness ?? 0.48,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  })
}

const hull = mat(0x56616d)
const hullDark = mat(0x252b33, { metalness: 0.7, roughness: 0.42 })
const panel = mat(0x3c4652)
const armor = mat(0x6a737d)
const bay = mat(0x11161d, { metalness: 0.4, roughness: 0.65 })
const windowWarm = new THREE.MeshBasicMaterial({ color: 0xffd38a })
const windowCool = new THREE.MeshBasicMaterial({ color: 0x9fe8ff })
const engineBlue = new THREE.MeshBasicMaterial({ color: 0x7fd5ff })
const engineCore = new THREE.MeshBasicMaterial({ color: 0xffffff })
const warning = new THREE.MeshBasicMaterial({ color: 0xff5d4a })

function box(group, name, size, pos, material, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  mesh.rotation.set(rot[0], rot[1], rot[2])
  group.add(mesh)
  return mesh
}

function cyl(group, name, radiusTop, radiusBottom, height, pos, material, rot = [0, 0, 0], radial = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  mesh.rotation.set(rot[0], rot[1], rot[2])
  group.add(mesh)
  return mesh
}

function disc(group, name, radius, pos, material) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 18), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  group.add(mesh)
  return mesh
}

function makeCapital() {
  const ship = new THREE.Group()
  ship.name = 'Claude Citizen Capital Dreadnought'

  const L = 620
  box(ship, 'main armored spine', [66, 58, L], [0, 0, 0], hull)
  box(ship, 'upper city deck', [52, 26, 390], [0, 42, 34], armor)
  box(ship, 'ventral keel', [28, 34, 500], [0, -54, 45], hullDark)
  box(ship, 'hangar shadow', [46, 10, 150], [0, -73, -78], bay)

  const prow = new THREE.Mesh(new THREE.ConeGeometry(50, 145, 4), hull)
  prow.name = 'faceted prow'
  prow.rotation.x = -Math.PI / 2
  prow.rotation.z = Math.PI / 4
  prow.position.z = -(L / 2 + 54)
  ship.add(prow)

  box(ship, 'bridge tower', [44, 76, 112], [0, 88, -105], hull)
  box(ship, 'bridge command deck', [62, 24, 58], [0, 132, -120], hullDark)
  box(ship, 'aft command block', [48, 42, 88], [0, 82, 86], panel)

  for (const side of [-1, 1]) {
    box(ship, `side armored rail ${side}`, [22, 26, 520], [side * 54, -6, 18], panel)
    box(ship, `outer nacelle ${side}`, [34, 40, 360], [side * 92, -8, 80], hullDark)
    box(ship, `forward outrigger ${side}`, [24, 22, 155], [side * 86, 10, -170], hull)
    box(ship, `hangar bay ${side}`, [4, 24, 92], [side * 111, -12, -52], bay)

    for (let i = 0; i < 9; i++) {
      const z = -245 + i * 62
      box(ship, `rib ${side} ${i}`, [12, 76, 16], [side * 42, -2, z], armor)
      box(ship, `outer rib ${side} ${i}`, [10, 48, 18], [side * 74, -4, z + 16], hull)
    }

    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 24; i++) {
        if ((i + row * 3 + side) % 5 === 0) continue
        const z = -250 + i * 21.5
        const y = -24 + row * 18
        box(ship, `flank window ${side} ${row} ${i}`, [0.9, 2.6, 5.6], [side * 33.6, y, z], (i + row) % 4 === 0 ? windowWarm : windowCool)
      }
    }

    for (let i = 0; i < 10; i++) {
      box(ship, `nacelle light ${side} ${i}`, [0.8, 2.2, 7], [side * 109.4, -19, -76 + i * 31], windowCool)
    }
  }

  for (let i = 0; i < 8; i++) {
    box(ship, `dorsal module ${i}`, [36 + (i % 2) * 10, 20, 38], [0, 70, -230 + i * 67], i % 2 ? panel : hullDark)
  }

  for (const x of [-30, 30]) {
    cyl(ship, `sensor mast ${x}`, 2.4, 3.2, 42, [x, 161, -112], hullDark, [0, 0, 0], 8)
    disc(ship, `sensor beacon ${x}`, 3.5, [x, 183, -112], warning)
  }

  for (const [x, y, r] of [[-34, 18, 14], [34, 18, 14], [-34, -18, 14], [34, -18, 14], [0, 0, 18], [-78, -6, 11], [78, -6, 11]]) {
    cyl(ship, `engine bell ${x} ${y}`, r * 0.8, r, 34, [x, y, L / 2 + 13], hullDark, [Math.PI / 2, 0, 0], 14)
    disc(ship, `engine glow ${x} ${y}`, r * 0.72, [x, y, L / 2 + 31], engineBlue)
    disc(ship, `engine core ${x} ${y}`, r * 0.32, [x, y, L / 2 + 31.5], engineCore)
  }

  box(ship, 'docking trench floor', [34, 4, 138], [0, -83, -74], hullDark)
  for (let i = 0; i < 7; i++) {
    box(ship, `docking trench light ${i}`, [5, 1, 3], [0, -86, -130 + i * 18], i % 2 ? windowWarm : windowCool)
  }

  return ship
}

function makeCarrier() {
  const ship = new THREE.Group()
  ship.name = 'Claude Citizen Capital Carrier'

  const L = 520
  box(ship, 'carrier central keel', [42, 46, L], [0, -8, 0], hullDark)
  box(ship, 'flight deck spine', [86, 16, 420], [0, 32, -10], armor)
  box(ship, 'forward command island', [54, 82, 92], [38, 90, -110], hull)
  box(ship, 'control bridge', [70, 22, 54], [38, 140, -122], bay)
  box(ship, 'aft reactor block', [92, 58, 108], [0, 18, 176], panel)

  const prow = new THREE.Mesh(new THREE.ConeGeometry(42, 120, 4), panel)
  prow.name = 'carrier wedge prow'
  prow.rotation.x = -Math.PI / 2
  prow.rotation.z = Math.PI / 4
  prow.position.z = -(L / 2 + 42)
  ship.add(prow)

  for (const side of [-1, 1]) {
    box(ship, `carrier wing deck ${side}`, [150, 14, 340], [side * 128, 20, -12], hull)
    box(ship, `outer flight pod ${side}`, [58, 40, 300], [side * 224, 0, 6], hullDark)
    box(ship, `inner hangar trench ${side}`, [96, 8, 210], [side * 126, 8, -48], bay)
    box(ship, `forward catapult rail ${side}`, [118, 6, 16], [side * 128, 34, -178], windowCool)
    box(ship, `aft catapult rail ${side}`, [118, 6, 16], [side * 128, 34, 116], windowWarm)

    for (let i = 0; i < 8; i++) {
      const z = -190 + i * 54
      box(ship, `carrier deck rib ${side} ${i}`, [112, 20, 10], [side * 128, 38, z], i % 2 ? armor : panel)
      box(ship, `carrier pod rib ${side} ${i}`, [10, 50, 18], [side * 194, -2, z + 12], armor)
    }

    for (let i = 0; i < 18; i++) {
      const z = -166 + i * 18
      box(ship, `carrier runway light ${side} ${i}`, [5, 1, 3], [side * 80, 41, z], i % 3 === 0 ? windowWarm : windowCool)
      box(ship, `outer cabin ${side} ${i}`, [0.9, 2.4, 5], [side * 253, -18 + (i % 3) * 13, z], windowCool)
    }

    for (let i = 0; i < 4; i++) {
      const z = -104 + i * 68
      cyl(ship, `carrier side engine ${side} ${i}`, 9, 12, 24, [side * 228, -10, z], hullDark, [Math.PI / 2, 0, 0], 12)
      disc(ship, `carrier side glow ${side} ${i}`, 8, [side * 228, -10, z + 15], engineBlue)
    }

    const ring = new THREE.Mesh(new THREE.TorusGeometry(34, 4.5, 8, 28), hull)
    ring.name = `carrier jump-ring ${side}`
    ring.position.set(side * 204, 44, 190)
    ring.rotation.y = Math.PI / 2
    ship.add(ring)
    disc(ship, `carrier ring glow ${side}`, 23, [side * 204, 44, 190], engineBlue)
  }

  for (let i = 0; i < 7; i++) {
    box(ship, `central deck window ${i}`, [36, 2, 4], [0, 42, -180 + i * 54], i % 2 ? windowWarm : windowCool)
  }

  for (const [x, y, r] of [[-44, -8, 16], [44, -8, 16], [0, -12, 22], [-118, -4, 13], [118, -4, 13]]) {
    cyl(ship, `carrier stern bell ${x}`, r * 0.75, r, 32, [x, y, L / 2 + 11], hullDark, [Math.PI / 2, 0, 0], 14)
    disc(ship, `carrier stern glow ${x}`, r * 0.7, [x, y, L / 2 + 28], engineBlue)
    disc(ship, `carrier stern core ${x}`, r * 0.3, [x, y, L / 2 + 28.5], engineCore)
  }

  cyl(ship, 'carrier dorsal antenna', 2.5, 4, 74, [-26, 84, 70], hullDark, [0, 0, -0.2], 8)
  cyl(ship, 'carrier comm mast', 2, 3, 58, [78, 76, -24], hullDark, [0, 0, 0.25], 8)
  disc(ship, 'carrier red beacon', 4, [-26, 123, 70], warning)

  return ship
}

const exporter = new GLTFExporter()
await fs.mkdir(outDir, { recursive: true })

for (const [name, model] of [
  ['capital-dreadnought.glb', makeCapital()],
  ['capital-carrier.glb', makeCarrier()],
]) {
  const out = path.join(outDir, name)
  const glb = await exporter.parseAsync(model, { binary: true })
  await fs.writeFile(out, Buffer.from(glb))
  const stat = await fs.stat(out)
  console.log(`Wrote ${out} (${Math.round(stat.size / 1024)} KiB)`)
}
