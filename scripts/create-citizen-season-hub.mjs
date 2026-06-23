import { mkdirSync, writeFileSync } from 'node:fs'
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

const outDir = path.resolve('public/assets/landmarks')
const outputPath = path.join(outDir, 'citizen-season-1-hub.glb')

function standard(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    metalness: options.metalness ?? 0.64,
    roughness: options.roughness ?? 0.34,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  })
}

function basic(color) {
  return new THREE.MeshBasicMaterial({ color })
}

const hull = standard(0x162338, { metalness: 0.74, roughness: 0.3 })
const hullDark = standard(0x040912, { metalness: 0.84, roughness: 0.25 })
const armor = standard(0x314862, { metalness: 0.68, roughness: 0.33 })
const glass = standard(0x102a45, { emissive: 0x0a3856, emissiveIntensity: 0.24, metalness: 0.38, roughness: 0.42 })
const obsidian = standard(0x080d16, { metalness: 0.9, roughness: 0.22 })
const cyan = basic(0x5df4ff)
const cyanDim = standard(0x2aa8c8, { emissive: 0x126c8e, emissiveIntensity: 0.72, metalness: 0.34, roughness: 0.28 })
const gold = basic(0xffd24d)
const goldHull = standard(0xc99228, { emissive: 0x7a4c00, emissiveIntensity: 0.45, metalness: 0.7, roughness: 0.28 })
const magenta = basic(0xff61d7)
const violetDim = standard(0x7a4bff, { emissive: 0x2a0c8f, emissiveIntensity: 0.48, metalness: 0.42, roughness: 0.34 })

function box(group, name, size, pos, material, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  mesh.rotation.set(rot[0], rot[1], rot[2])
  group.add(mesh)
  return mesh
}

function cyl(group, name, radiusTop, radiusBottom, height, pos, material, rot = [0, 0, 0], radial = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  mesh.rotation.set(rot[0], rot[1], rot[2])
  group.add(mesh)
  return mesh
}

function torus(group, name, radius, tube, pos, material, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 128), material)
  mesh.name = name
  mesh.position.set(pos[0], pos[1], pos[2])
  mesh.rotation.set(rot[0], rot[1], rot[2])
  group.add(mesh)
  return mesh
}

function addBridge(group, name, angle, radius, y, length, material, width = 32) {
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius
  const bridge = box(group, name, [width, 24, length], [x * 0.5, y, z * 0.5], material)
  bridge.rotation.y = -angle
  return bridge
}

function addTower(group, name, angle, radius, y, height, width, material, accent) {
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius
  const tower = box(group, `${name} tower`, [width, height, width * 0.82], [x, y + height / 2, z], material)
  tower.rotation.y = -angle
  box(group, `${name} glow spine`, [width * 0.12, height * 0.82, 5], [x, y + height / 2, z + width * 0.43], accent)
  for (let i = 0; i < 3; i++) {
    const stripY = y + height * (0.28 + i * 0.2)
    box(group, `${name} window lane ${i}`, [width * 0.72, 5, 5], [x, stripY, z + width * 0.44], accent)
  }
  cyl(group, `${name} crown`, width * 0.22, width * 0.38, width * 0.65, [x, y + height + width * 0.34, z], accent, [0, 0, 0], 8)
  return tower
}

function addHabitatPod(group, name, angle, radius, y, material, accent) {
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius
  cyl(group, `${name} habitat pod`, 54, 74, 96, [x, y, z], material, [Math.PI / 2, 0, -angle], 12)
  torus(group, `${name} habitat window band`, 55, 3.5, [x, y, z], accent, [Math.PI / 2, 0, -angle])
  const mast = box(group, `${name} docking mast`, [16, 130, 16], [x, y + 82, z], hullDark)
  mast.rotation.y = -angle
}

function addDockArm(group, name, angle, radius, y, material, accent) {
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius
  const arm = box(group, `${name} dock spine`, [34, 24, 520], [x * 0.5, y, z * 0.5], material)
  arm.rotation.y = -angle
  box(group, `${name} dock bay`, [170, 58, 96], [x, y + 6, z], hullDark, [0, -angle, 0])
  box(group, `${name} dock lip`, [190, 10, 108], [x, y + 41, z], accent, [0, -angle, 0])
  box(group, `${name} lower gantry`, [120, 16, 52], [x * 0.88, y - 38, z * 0.88], glass, [0, -angle, 0])
  box(group, `${name} arrival light bar`, [12, 12, 168], [x * 0.72, y + 26, z * 0.72], accent, [0, -angle, 0])
}

function addCityDistrict(group, name, centerAngle, radius, baseY, count, accent) {
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * 0.082
    const angle = centerAngle + offset
    const laneRadius = radius + (i % 3 - 1) * 58
    const height = 135 + (i % 4) * 48 + Math.abs(i - count / 2) * 8
    const width = 54 + (i % 3) * 14
    const material = i % 2 ? armor : hull
    addTower(group, `${name} block ${i}`, angle, laneRadius, baseY, height, width, material, accent)
  }
}

function buildSeasonHub() {
  const hub = new THREE.Group()
  hub.name = 'Citizen Season 1 Hub'

  cyl(hub, 'season hub lower city plate', 520, 720, 62, [0, -34, 0], hullDark, [0, 0, 0], 18)
  cyl(hub, 'season hub raised civic deck', 410, 560, 52, [0, 22, 0], obsidian, [0, 0, 0], 18)
  cyl(hub, 'season hub central plaza', 260, 330, 44, [0, 74, 0], hull, [0, 0, 0], 16)
  cyl(hub, 'season hub mid city terrace', 470, 530, 28, [0, 146, 0], glass, [0, 0, 0], 18)
  cyl(hub, 'season hub upper city terrace', 320, 380, 24, [0, 236, 0], obsidian, [0, 0, 0], 16)
  torus(hub, 'season hub lower traffic ring', 620, 5, [0, 0, 0], cyan, [Math.PI / 2, 0, 0])
  torus(hub, 'season hub outer habitat ring', 830, 6, [0, 76, 0], gold, [Math.PI / 2, 0, 0])
  torus(hub, 'season hub elevated transit ring', 520, 4, [0, 280, 0], magenta, [Math.PI / 2, 0.14, 0.3])
  torus(hub, 'season hub skyline crown lane', 390, 3.5, [0, 430, 0], cyan, [Math.PI / 2, 0.08, 0.18])

  cyl(hub, 'season hub civic tower lower', 108, 170, 380, [0, 260, 0], hull, [0, 0, 0], 10)
  cyl(hub, 'season hub civic tower mid', 68, 104, 340, [0, 610, 0], armor, [0, 0, 0], 10)
  cyl(hub, 'season hub broadcast needle', 12, 48, 310, [0, 935, 0], hullDark, [0, 0, 0], 8)
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(88, 1), goldHull)
  core.name = 'season hub season core'
  core.position.set(0, 780, 0)
  hub.add(core)
  torus(hub, 'season hub civic halo cyan', 230, 5, [0, 780, 0], cyan, [Math.PI / 2, 0, 0])
  torus(hub, 'season hub civic halo gold', 330, 4, [0, 780, 0], gold, [Math.PI / 2, 0.24, 0.55])
  torus(hub, 'season hub vertical city halo a', 540, 4, [0, 520, 0], cyan, [0, Math.PI / 2, 0])
  torus(hub, 'season hub vertical city halo b', 540, 4, [0, 520, 0], gold, [Math.PI / 2, 0, Math.PI / 2])

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    addCityDistrict(hub, `season hub district ${i}`, angle, 390 + (i % 2) * 72, 90, 8, i % 2 ? cyanDim : goldHull)
    addBridge(hub, `season hub arterial bridge ${i}`, angle, 610, 148 + (i % 2) * 38, 570, i % 2 ? cyanDim : goldHull, 30)
    const plazaX = Math.cos(angle + Math.PI / 8) * 490
    const plazaZ = Math.sin(angle + Math.PI / 8) * 490
    cyl(hub, `season hub neighborhood plaza ${i}`, 54, 82, 26, [plazaX, 184, plazaZ], i % 2 ? glass : obsidian, [0, 0, 0], 10)
  }

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + Math.PI / 12
    addHabitatPod(hub, `season hub outer habitat ${i}`, angle, 765, 124 + (i % 2) * 28, i % 2 ? glass : hull, i % 3 ? cyan : gold)
  }

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8
    const x = Math.cos(angle) * 610
    const z = Math.sin(angle) * 610
    cyl(hub, `season hub skyline spire ${i}`, 20, 42, 360 + (i % 3) * 70, [x, 230 + (i % 3) * 35, z], hullDark, [0, 0, 0], 8)
    cyl(hub, `season hub skyline beacon ${i}`, 48, 18, 72, [x, 455 + (i % 3) * 105, z], i % 2 ? cyanDim : goldHull, [0, 0, 0], 8)
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(32, 0), i % 2 ? cyan : gold)
    beacon.name = `season hub skyline light ${i}`
    beacon.position.set(x, 510 + (i % 3) * 105, z)
    hub.add(beacon)
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    addDockArm(hub, `season hub capital ${i}`, angle, 1030, 112, i % 2 ? cyanDim : goldHull, i % 2 ? cyan : gold)
  }

  box(hub, 'season hub grand leaderboard frame', [520, 128, 18], [0, 306, 290], glass)
  box(hub, 'season hub grand leaderboard gold rail', [560, 11, 22], [0, 372, 298], goldHull)
  box(hub, 'season hub grand leaderboard cyan rail', [560, 9, 22], [0, 240, 298], cyanDim)
  box(hub, 'season hub entry arch left', [32, 290, 96], [-330, 260, 250], violetDim, [0, 0.2, 0])
  box(hub, 'season hub entry arch right', [32, 290, 96], [330, 260, 250], violetDim, [0, -0.2, 0])
  addBridge(hub, 'season hub ceremonial runway', 0, 900, 72, 820, hullDark, 120)
  box(hub, 'season hub runway centerline', [10, 8, 760], [0, 92, 420], cyanDim)

  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2
    const radius = i % 2 ? 570 : 690
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const light = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0), i % 3 ? cyan : gold)
    light.name = `season hub traffic light ${i}`
    light.position.set(x, 96 + (i % 4) * 22, z)
    hub.add(light)
  }

  return hub
}

mkdirSync(outDir, { recursive: true })
const scene = buildSeasonHub()
const exporter = new GLTFExporter()
const result = await exporter.parseAsync(scene, { binary: true, trs: false })
writeFileSync(outputPath, Buffer.from(result))
console.log(`Wrote ${outputPath}`)
