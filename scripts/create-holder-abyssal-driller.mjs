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

function material({ color, emissive = 0x000000, emissiveIntensity = 0, metalness = 0, roughness = 0.45 }) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness,
    flatShading: true,
  })
}

const obsidianMat = material({ color: 0x32393b, emissive: 0x060504, emissiveIntensity: 0.04, metalness: 0.82, roughness: 0.36 })
const gunmetalMat = material({ color: 0x505b5e, emissive: 0x060504, emissiveIntensity: 0.035, metalness: 0.78, roughness: 0.38 })
const graphiteMat = material({ color: 0x262d30, emissive: 0x030303, emissiveIntensity: 0.035, metalness: 0.74, roughness: 0.42 })
const steelMat = material({ color: 0x6d7472, emissive: 0x050504, emissiveIntensity: 0.03, metalness: 0.72, roughness: 0.38 })
const wornSteelMat = material({ color: 0x8a8a7c, emissive: 0x070604, emissiveIntensity: 0.04, metalness: 0.66, roughness: 0.42 })
const hazardGoldMat = material({ color: 0xb88432, emissive: 0x261300, emissiveIntensity: 0.08, metalness: 0.62, roughness: 0.34 })
const mutedAmberMat = material({ color: 0xc48738, emissive: 0x9c4d00, emissiveIntensity: 0.32, metalness: 0.2, roughness: 0.3 })
const oreCoreMat = material({ color: 0xdfaa61, emissive: 0xaa5a00, emissiveIntensity: 0.58, metalness: 0.1, roughness: 0.2 })
const darkGlassMat = material({ color: 0x101820, emissive: 0x472300, emissiveIntensity: 0.32, metalness: 0.28, roughness: 0.16 })
const engineMat = material({ color: 0xe9b66c, emissive: 0xc66a00, emissiveIntensity: 0.78, metalness: 0.08, roughness: 0.16 })

function addMesh(group, geometry, meshMaterial, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], name = '') {
  const mesh = new THREE.Mesh(geometry, meshMaterial)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  mesh.name = name
  group.add(mesh)
  return mesh
}

function wedgeGeometry(sections) {
  const vertices = []
  for (const s of sections) {
    const hw = s.w / 2
    const hh = s.h / 2
    vertices.push(-hw, -hh, s.z, hw, -hh, s.z, hw, hh, s.z, -hw, hh, s.z)
  }
  const indices = []
  for (let i = 0; i < sections.length - 1; i++) {
    const a = i * 4
    const b = a + 4
    indices.push(
      a, b, a + 1, a + 1, b, b + 1,
      a + 1, b + 1, a + 2, a + 2, b + 1, b + 2,
      a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
      a + 3, b + 3, a, a, b + 3, b,
    )
  }
  indices.push(0, 1, 2, 0, 2, 3)
  const last = (sections.length - 1) * 4
  indices.push(last, last + 2, last + 1, last, last + 3, last + 2)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function addEngine(group, x, y, z, scale = 1) {
  addMesh(group, new THREE.CylinderGeometry(0.42 * scale, 0.56 * scale, 0.82 * scale, 12), graphiteMat, [x, y, z], [Math.PI / 2, 0, 0], [1, 1, 1], 'obsidian_ring_engine_cowling')
  addMesh(group, new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 0.08 * scale, 12), engineMat, [x, y, z + 0.48 * scale], [Math.PI / 2, 0, 0], [1, 1, 1], 'obsidian_ring_engine_core')
}

function addDrumArmorPanel(group, angle, z, name, meshMaterial) {
  const radius = 1.95
  const x = Math.cos(angle) * radius
  const y = Math.sin(angle) * radius
  addMesh(group, new THREE.BoxGeometry(0.82, 0.18, 0.52), meshMaterial, [x, y, z], [0, 0, angle], [1, 1, 1], name)
}

const ship = new THREE.Group()
ship.name = 'Holder_Deep_Core_Mining_Ring'

addMesh(ship, new THREE.BoxGeometry(3.18, 1.98, 3.82), gunmetalMat, [0, -0.04, -0.42], [0, 0, 0], [1, 1, 1], 'obsidian_pressure_hull')
addMesh(ship, wedgeGeometry([
  { z: -3.72, w: 1.22, h: 0.62 },
  { z: -2.86, w: 1.84, h: 0.92 },
  { z: -1.86, w: 2.42, h: 1.08 },
]), gunmetalMat, [0, 0, 0], [0, 0, 0], [1, 1, 1], 'armored_original_mining_nose')

addMesh(ship, new THREE.BoxGeometry(1.76, 0.78, 0.98), graphiteMat, [0, 0.68, -2.12], [0, 0, 0], [1, 1, 1], 'low_obsidian_canopy_block')
addMesh(ship, new THREE.BoxGeometry(1.16, 0.32, 0.24), darkGlassMat, [0, 0.88, -2.66], [0, 0, 0], [1, 1, 1], 'amber_mining_visor')
addMesh(ship, new THREE.BoxGeometry(2.45, 0.16, 2.76), gunmetalMat, [0, 1.0, -0.24], [0, 0, 0], [1, 1, 1], 'gunmetal_top_armor_slab')
addMesh(ship, new THREE.BoxGeometry(1.78, 0.12, 2.25), graphiteMat, [0, -1.02, -0.18], [0, 0, 0], [1, 1, 1], 'underside_graphite_equipment_bay')

for (const side of [-1, 1]) {
  const sideName = side < 0 ? 'left' : 'right'
  addMesh(ship, new THREE.BoxGeometry(0.18, 1.42, 2.78), steelMat, [side * 1.66, -0.04, -0.38], [0, 0, 0], [1, 1, 1], `${sideName}_reinforced_hull_side_panel`)
  addMesh(ship, new THREE.BoxGeometry(0.08, 0.08, 1.88), mutedAmberMat, [side * 1.76, 0.7, -0.24], [0, 0, 0], [1, 1, 1], `${sideName}_upper_amber_power_rail`)
  addMesh(ship, new THREE.BoxGeometry(0.08, 0.08, 1.58), mutedAmberMat, [side * 1.76, -0.72, 0.05], [0, 0, 0], [1, 1, 1], `${sideName}_lower_amber_power_rail`)
}

addMesh(ship, new THREE.CylinderGeometry(1.7, 1.7, 2.82, 18), gunmetalMat, [0, -0.02, 1.96], [Math.PI / 2, 0, 0], [1, 1, 1], 'prestige_refinery_drum')
addMesh(ship, new THREE.CylinderGeometry(1.02, 1.02, 2.98, 18), graphiteMat, [0, -0.02, 1.96], [Math.PI / 2, 0, 0], [1, 1, 1], 'dark_refinery_core')
addMesh(ship, new THREE.CylinderGeometry(0.42, 0.42, 3.08, 18), oreCoreMat, [0, -0.02, 1.96], [Math.PI / 2, 0, 0], [1, 1, 1], 'amber_ore_refinery_core')
addMesh(ship, new THREE.CylinderGeometry(1.52, 1.52, 0.12, 18), gunmetalMat, [0, -0.02, 0.58], [Math.PI / 2, 0, 0], [1, 1, 1], 'front_refinery_drum_face')
addMesh(ship, new THREE.CylinderGeometry(0.72, 0.72, 0.14, 18), graphiteMat, [0, -0.02, 0.5], [Math.PI / 2, 0, 0], [1, 1, 1], 'front_refinery_intake_face')
addMesh(ship, new THREE.CylinderGeometry(0.42, 0.42, 0.16, 18), oreCoreMat, [0, -0.02, 0.42], [Math.PI / 2, 0, 0], [1, 1, 1], 'front_amber_intake_core')

addMesh(ship, new THREE.TorusGeometry(1.75, 0.16, 8, 28), steelMat, [0, -0.02, 0.72], [0, 0, 0], [1, 1, 1], 'front_refinery_drum_band')
addMesh(ship, new THREE.TorusGeometry(1.82, 0.14, 8, 30), mutedAmberMat, [0, -0.02, 1.96], [0, 0, 0], [1, 1, 1], 'middle_muted_amber_drum_band')
addMesh(ship, new THREE.TorusGeometry(1.75, 0.16, 8, 28), steelMat, [0, -0.02, 3.2], [0, 0, 0], [1, 1, 1], 'rear_refinery_drum_band')
addMesh(ship, new THREE.BoxGeometry(3.76, 0.2, 0.38), hazardGoldMat, [0, 1.68, 1.96], [0, 0, 0], [1, 1, 1], 'attached_mining_ring_carapace')

for (const [index, angle] of [Math.PI / 2, Math.PI * 0.22, -Math.PI * 0.22, -Math.PI / 2].entries()) {
  addDrumArmorPanel(ship, angle, 1.28, `front_gunmetal_drum_armor_panel_${index}`, steelMat)
  addDrumArmorPanel(ship, angle, 2.64, `rear_hazard_drum_armor_panel_${index}`, hazardGoldMat)
}

for (const side of [-1, 1]) {
  const sideName = side < 0 ? 'left' : 'right'
  addMesh(ship, new THREE.BoxGeometry(0.5, 0.42, 2.48), graphiteMat, [side * 1.18, -0.55, -2.42], [0, side * 0.04, 0], [1, 1, 1], `${sideName}_heavy_mining_feed_arm`)
  addMesh(ship, new THREE.BoxGeometry(0.12, 0.09, 1.62), mutedAmberMat, [side * 1.5, -0.5, -2.42], [0, side * 0.05, 0], [1, 1, 1], `${sideName}_feed_arm_amber_rail`)
  addMesh(ship, new THREE.ConeGeometry(0.5, 1.36, 8), wornSteelMat, [side * 1.18, -0.55, -3.9], [-Math.PI / 2, 0, 0], [1, 1, 1], side < 0 ? 'worn_steel_mining_bit_l' : 'worn_steel_mining_bit_r')
  addMesh(ship, new THREE.BoxGeometry(0.28, 0.22, 2.28), gunmetalMat, [side * 1.62, -0.08, 1.94], [0, side * 0.04, 0], [1, 1, 1], `${sideName}_attached_refinery_strake`)
  addMesh(ship, new THREE.BoxGeometry(0.1, 0.08, 1.5), mutedAmberMat, [side * 1.84, 0.12, 1.96], [0, side * 0.08, 0], [1, 1, 1], `${sideName}_drum_amber_power_conduit`)

  addEngine(ship, side * 0.94, 0.58, 3.62, 1.02)
  addEngine(ship, side * 0.94, -0.66, 3.62, 1.02)
}

addMesh(ship, new THREE.BoxGeometry(2.72, 0.38, 0.66), gunmetalMat, [0, -0.66, 3.28], [0, 0, 0], [1, 1, 1], 'rear_gunmetal_engine_bumper')
addMesh(ship, new THREE.BoxGeometry(1.38, 0.52, 0.94), graphiteMat, [0, -0.14, 3.58], [0, 0, 0], [1, 1, 1], 'central_refinery_engine_block')
addEngine(ship, 0, -0.1, 4.08, 1.18)

addMesh(ship, new THREE.BoxGeometry(0.1, 0.06, 2.55), mutedAmberMat, [0.22, 1.04, -0.08], [0, 0.02, 0], [1, 1, 1], 'right_dorsal_amber_energy_trace')
addMesh(ship, new THREE.BoxGeometry(0.1, 0.06, 2.55), mutedAmberMat, [-0.22, 1.04, -0.08], [0, -0.02, 0], [1, 1, 1], 'left_dorsal_amber_energy_trace')
addMesh(ship, new THREE.BoxGeometry(0.72, 0.12, 0.22), hazardGoldMat, [0, 1.18, -1.46], [0, 0, 0], [1, 1, 1], 'hazard_command_crest')

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const scene = new THREE.Scene()
scene.add(ship)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/holder-abyssal-driller.glb')
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
