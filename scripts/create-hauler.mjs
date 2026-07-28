import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    }).catch((error) => {
      this.error = error
      this.onerror?.(error)
    })
  }
}

function material({ name, color, emissive = 0x000000, emissiveIntensity = 0, metalness = 0, roughness = 0.45 }) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness,
    flatShading: true,
  })
  mat.name = name
  return mat
}

function unlit(name, color) {
  const mat = new THREE.MeshBasicMaterial({ color })
  mat.name = name
  return mat
}

// Named materials as module constants, recovered from the shipped hauler.glb's
// glTF material table (baseColorFactor/metallicFactor/roughnessFactor/emissiveFactor
// and the KHR_materials_emissive_strength / KHR_materials_unlit extensions).
const hullCargoGraphiteMat = material({ name: 'hull_cargo_graphite', color: 0x56616c, metalness: 0.62, roughness: 0.42 })
const darkGunmetalMat = material({ name: 'dark_gunmetal', color: 0x151b23, metalness: 0.72, roughness: 0.36 })
const cyanGlassEmissiveMat = material({ name: 'cyan_glass_emissive', color: 0x70e8ff, emissive: 0x1e91c2, emissiveIntensity: 1.8, metalness: 0.06, roughness: 0.12 })
const tealEmissivePanelsMat = material({ name: 'teal_emissive_panels', color: 0x6effc8, emissive: 0x36ffc6, emissiveIntensity: 1.5, metalness: 0.18, roughness: 0.25 })
const engineBlueGlowMat = unlit('engine_blue_glow', 0x8fe8ff)
const whiteHotCoreMat = unlit('white_hot_core', 0xffffff)
const redNavigationLightMat = unlit('red_navigation_light', 0xff365e)
const greenNavigationLightMat = unlit('green_navigation_light', 0x62ff9a)

// Every "box" part in the shipped model is a unit BoxGeometry(1,1,1) resized via the
// mesh scale — a fresh geometry per call (the exporter did not dedupe instances, so
// neither do we; that keeps the mesh count identical to the original).
function addBox(group, mat, w, h, d, x, y, z, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
  mesh.scale.set(w, h, d)
  mesh.position.set(x, y, z)
  mesh.name = name
  group.add(mesh)
  return mesh
}

// Engine housings/nozzles/bells: a real-dimensioned CylinderGeometry (8 radial
// segments), laid along +Z by rotating 90 degrees about X.
function addCylinderPart(group, mat, topRadius, bottomRadius, height, x, y, z, name) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, bottomRadius, height, 8), mat)
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y, z)
  mesh.name = name
  group.add(mesh)
  return mesh
}

// Engine glow/core discs: an unrotated CircleGeometry (18 segments) facing +Z.
function addDisc(group, mat, radius, x, y, z, name) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 18), mat)
  mesh.position.set(x, y, z)
  mesh.name = name
  group.add(mesh)
  return mesh
}

// Navigation light beacons: a small unlit IcosahedronGeometry(0.11, 0).
function addNavLight(group, mat, x, y, z, name) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), mat)
  mesh.position.set(x, y, z)
  mesh.name = name
  group.add(mesh)
  return mesh
}

const ship = new THREE.Group()
ship.name = 'ClaudeCitizen_Hauler_GLB'
ship.userData = {
  title: 'ClaudeCitizen_Hauler_GLB',
  license: 'Original procedural GLB generated for Claude Citizen',
  forward: '-Z',
}

// Central cargo spine + forward command bridge.
addBox(ship, hullCargoGraphiteMat, 2.55, 1.45, 5.6, 0, 0, 0.15, 'long_armored_cargo_spine')
addBox(ship, darkGunmetalMat, 1.32, 0.72, 1.18, 0, 0.86, -2.15, 'forward_command_bridge')
addBox(ship, cyanGlassEmissiveMat, 1.05, 0.28, 0.22, 0, 1, -2.82, 'wide_cyan_bridge_window')

// Cargo container bands with port/starboard window rows, one ring per Z station.
for (const z of [-1.7, -0.55, 0.6, 1.75]) {
  addBox(ship, darkGunmetalMat, 2.85, 1.62, 0.16, 0, 0, z, `cargo_container_band_${z}`)
  addBox(ship, tealEmissivePanelsMat, 0.06, 0.15, 0.58, -1.32, 0.32, z, `port_cargo_window_row_${z}`)
  addBox(ship, tealEmissivePanelsMat, 0.06, 0.15, 0.58, 1.32, 0.32, z, `starboard_cargo_window_row_${z}`)
}

// Port/starboard outrigger struts, external nacelle, teal accent rib, engine bell,
// and its glow/core — mirrored across the hull.
for (const side of [-1, 1]) {
  const tag = side < 0 ? 'port' : 'starboard'
  const x = side * 2.05
  addBox(ship, darkGunmetalMat, 1.36, 0.28, 0.36, x, 0, -1.35, `${tag}_outrigger_strut_front`)
  addBox(ship, darkGunmetalMat, 1.36, 0.28, 0.36, x, 0, 1.4, `${tag}_outrigger_strut_rear`)

  const ex = side * 2.78
  addCylinderPart(ship, hullCargoGraphiteMat, 0.48, 0.56, 3.8, ex, 0, 0.35, `${tag}_long_external_engine`)
  addBox(ship, tealEmissivePanelsMat, 0.72, 0.07, 0.22, ex, 0.48, -0.8, `${tag}_engine_teal_rib`)
  addCylinderPart(ship, darkGunmetalMat, 0.3276, 0.42, 0.756, ex, 0, 2.32, `${tag}_external_engine_bell`)
  addDisc(ship, engineBlueGlowMat, 0.3024, ex, 0, 2.7064, `${tag}_external_engine_glow`)
  addDisc(ship, whiteHotCoreMat, 0.1428, ex, 0, 2.7148, `${tag}_external_engine_core`)
}

// Rear thruster cluster: four small engine bells with glow/core, one per corner.
for (const [x, y] of [[-0.78, 0.43], [0.78, 0.43], [-0.78, -0.43], [0.78, -0.43]]) {
  addCylinderPart(ship, darkGunmetalMat, 0.273, 0.35, 0.63, x, y, 3.04, `main_cluster_${x}_${y}_bell`)
  addDisc(ship, engineBlueGlowMat, 0.252, x, y, 3.362, `main_cluster_${x}_${y}_glow`)
  addDisc(ship, whiteHotCoreMat, 0.119, x, y, 3.369, `main_cluster_${x}_${y}_core`)
}

// Ventral docking clamp and port/starboard navigation lights.
addBox(ship, darkGunmetalMat, 0.82, 0.24, 4.4, 0, -0.96, 0.15, 'ventral_docking_clamp')
addNavLight(ship, redNavigationLightMat, -3.16, 0.08, -0.78, 'port_red_navigation_light')
addNavLight(ship, greenNavigationLightMat, 3.16, 0.08, -0.78, 'starboard_green_navigation_light')

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const root = new THREE.Group()
root.name = 'ClaudeCitizen_Hauler_GLB_root_forward_minus_z'
root.add(ship)

const scene = new THREE.Scene()
scene.name = 'hauler_scene'
scene.add(root)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/hauler.glb')
mkdirSync(dirname(outputPath), { recursive: true })

try {
  const result = await exporter.parseAsync(scene, { binary: true, trs: false })
  writeFileSync(outputPath, Buffer.from(result))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

if (!process.exitCode) {
  console.log(JSON.stringify({ outputPath, bytes: readFileSync(outputPath).byteLength }, null, 2))
}
