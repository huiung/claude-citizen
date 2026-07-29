import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyHullGreebles, GREEBLE_GROUP_NAME, HULL_GREEBLE_INTERNALS, stripHullGreebles } from './hullGreebles'

const { GREEBLE_SHAPES, COCKPIT_NAME, COCKPIT_CLEAR_FRACTION, isSelfLit } = HULL_GREEBLE_INTERNALS

/** Materials copied out of the shipped GLBs, so the classifier is tested against the values it actually
 *  has to separate rather than against invented ones. */
const AUTHORED_SELF_LIT: [string, number, number, [number, number, number]][] = [
  ['engine_blue_glow', 0, 0.9, [0.275, 0.807, 1.0]],
  ['engine_orange_glow', 0, 0.9, [1.0, 0.171, 0.054]],
  ['white_hot_core', 0, 0.9, [1.0, 1.0, 1.0]],
  ['red_navigation_light', 0, 0.9, [1.0, 0.037, 0.112]],
  ['green_navigation_light', 0, 0.9, [0.122, 1.0, 0.323]],
]
const AUTHORED_HULL: [string, number, number, [number, number, number]][] = [
  ['hull_deep_teal', 0.45, 0.45, [0.027, 0.159, 0.231]],
  ['hull_oxide_green', 0.45, 0.45, [0.05, 0.212, 0.098]],
  ['hull_industrial_ochre', 0.35, 0.55, [0.347, 0.195, 0.045]],
  ['hull_cargo_graphite', 0.62, 0.42, [0.093, 0.12, 0.15]],
  ['dark_gunmetal', 0.72, 0.36, [0.007, 0.011, 0.017]],
]

function material(spec: [string, number, number, [number, number, number]]): THREE.MeshStandardMaterial {
  const [name, metalness, roughness, rgb] = spec
  const mat = new THREE.MeshStandardMaterial({ name, metalness, roughness })
  mat.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace)
  return mat
}

/** A stand-in for a generated hull: one big structural box, a canopy, an engine glow disc, and a thin
 *  barrel. Deliberately shaped like the real assets rather than like a convenient test case — the four
 *  base hulls are all intersecting boxes and cylinders with meaningful node names, and every rule in the
 *  greeble pass keys off one of those two facts. */
function makeTestHull(): THREE.Group {
  const root = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2, 9),
    new THREE.MeshStandardMaterial({ name: 'hull_cargo_graphite', color: 0x18202a, metalness: 0.62 }),
  )
  body.name = 'long_armored_cargo_spine'
  root.add(body)

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ name: 'cyan_glass_emissive', color: 0x66e0ff, emissive: 0x2a6688 }),
  )
  canopy.name = 'wide_cyan_bridge_window'
  canopy.position.set(0, 1.0, -4.3)
  root.add(canopy)

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 12),
    new THREE.MeshStandardMaterial({ name: 'engine_blue_glow', color: 0x7fd4ff, emissive: 0x7fd4ff }),
  )
  glow.name = 'port_external_engine_glow'
  glow.position.set(-1.0, 0, 4.6)
  root.add(glow)

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6),
    new THREE.MeshStandardMaterial({ name: 'dark_gunmetal', color: 0x020304, metalness: 0.72 }),
  )
  barrel.name = 'port_long_railgun'
  barrel.position.set(-2.2, 0, -3)
  root.add(barrel)

  return root
}

function greebleMeshes(root: THREE.Object3D): THREE.InstancedMesh[] {
  const found: THREE.InstancedMesh[] = []
  root.traverse((obj) => {
    if ((obj as THREE.InstancedMesh).isInstancedMesh) found.push(obj as THREE.InstancedMesh)
  })
  return found
}

function totalTriangles(root: THREE.Object3D): number {
  let tris = 0
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const index = mesh.geometry.getIndex()
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const per = (index ? index.count : position.count) / 3
    tris += per * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1)
  })
  return tris
}

describe('applyHullGreebles', () => {
  it('raises a crude hull by an order of magnitude in triangles', () => {
    const hull = makeTestHull()
    const before = totalTriangles(hull)
    applyHullGreebles(hull)
    const after = totalTriangles(hull)
    // The whole point of the pass. `before` here is ~40 triangles of boxes and a disc.
    expect(after).toBeGreaterThan(before * 10)
  })

  it('costs one draw call per SHAPE, not per greeble', () => {
    // The reason this uses InstancedMesh at all: hundreds of separate draw calls would be a real
    // regression where thousands of extra triangles are not.
    const hull = makeTestHull()
    const meshes = applyHullGreebles(hull)
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.length).toBeLessThanOrEqual(GREEBLE_SHAPES.length)
    const instances = meshes.reduce((sum, m) => sum + m.count, 0)
    expect(instances).toBeGreaterThan(meshes.length * 10)
  })

  it('is deterministic', () => {
    // Two studio captures that differ by the greeble layout are not a comparison of anything, so this
    // is a property the verification harnesses depend on rather than a nicety.
    const readAll = (): number[] => {
      const hull = makeTestHull()
      applyHullGreebles(hull)
      const out: number[] = []
      for (const mesh of greebleMeshes(hull)) {
        out.push(mesh.count)
        out.push(...Array.from(mesh.instanceMatrix.array))
        if (mesh.instanceColor) out.push(...Array.from(mesh.instanceColor.array))
      }
      return out
    }
    expect(readAll()).toEqual(readAll())
  })

  it('keeps a camera-sized clearance around the cockpit', () => {
    // The cockpit camera sits just above and behind the canopy with a 0.05 near plane. A greeble there
    // either fills the forward view or clips through it.
    const hull = makeTestHull()
    applyHullGreebles(hull)
    const canopy = hull.getObjectByName('wide_cyan_bridge_window') as THREE.Mesh
    const hullBox = new THREE.Box3().setFromObject(hull.getObjectByName('long_armored_cargo_spine')!)
    const span = Math.max(...hullBox.getSize(new THREE.Vector3()).toArray())
    const forbidden = new THREE.Box3().setFromObject(canopy).expandByScalar(span * COCKPIT_CLEAR_FRACTION)

    const position = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    for (const mesh of greebleMeshes(hull)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        expect(forbidden.containsPoint(position.setFromMatrixPosition(matrix))).toBe(false)
      }
    }
  })

  it('places nothing on a part barely thicker than a greeble', () => {
    // A cannon barrel can present a face wide enough to qualify on area alone while being thinner than
    // the greeble itself, and what that produced was a starburst of blades reading as debris.
    const hull = makeTestHull()
    applyHullGreebles(hull)
    const barrel = new THREE.Box3().setFromObject(hull.getObjectByName('port_long_railgun')!)
    // Grown by a whole greeble: nothing should be near it, let alone on it.
    barrel.expandByScalar(0.2)
    const position = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    for (const mesh of greebleMeshes(hull)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        expect(barrel.containsPoint(position.setFromMatrixPosition(matrix))).toBe(false)
      }
    }
  })

  it('carries a colour per instance, so one material serves a whole palette', () => {
    const hull = makeTestHull()
    const meshes = applyHullGreebles(hull)
    for (const mesh of meshes) {
      expect(mesh.instanceColor).not.toBeNull()
      // White base: the instance attribute IS the colour, not a tint on top of one, which is what lets
      // a greeble on a teal wing be teal and one on a gunmetal spine be gunmetal in the same draw call.
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff)
    }
  })

  it('lifts greeble colours to the hull luminance floor', () => {
    // Greeble colour arrives as a per-instance attribute, which `tuneHullMaterials` cannot reach — so if
    // this pass did not apply the floor itself, greebles would keep the GLBs' authored near-black values
    // and read as holes in a hull that had been lifted around them.
    const hull = makeTestHull()
    const meshes = applyHullGreebles(hull)
    const color = new THREE.Color()
    let checked = 0
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getColorAt(i, color)
        const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
        // The floor is 0.42 and the per-instance tone jitter bottoms out at 0.8.
        expect(luminance).toBeGreaterThan(0.42 * 0.8 * 0.95)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('does nothing to an asset that is already dense', () => {
    // The season hub is 59,852 triangles across 528 meshes and is not what read as crude. One pass has
    // to cover it and a 388-triangle fighter with no per-asset table.
    const dense = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(50, 120, 120), // ~28k triangles
      new THREE.MeshStandardMaterial({ color: 0x445566 }),
    )
    dense.add(mesh)
    expect(applyHullGreebles(dense)).toEqual([])
    expect(dense.getObjectByName(GREEBLE_GROUP_NAME)).toBeUndefined()
  })

  it('is disabled by a target of zero', () => {
    const hull = makeTestHull()
    expect(applyHullGreebles(hull, { triangleTarget: 0 })).toEqual([])
  })

  it('cannot stack when run twice on the same model', () => {
    // The model loader caches the source model and the studio re-runs passes over it, so a second call
    // is a real code path rather than a hypothetical.
    const hull = makeTestHull()
    applyHullGreebles(hull)
    const first = totalTriangles(hull)
    expect(applyHullGreebles(hull)).toEqual([])
    expect(totalTriangles(hull)).toBe(first)
  })

  it('can be stripped and rebuilt', () => {
    const hull = makeTestHull()
    const bare = totalTriangles(hull)
    applyHullGreebles(hull)
    stripHullGreebles(hull)
    expect(totalTriangles(hull)).toBe(bare)
    expect(applyHullGreebles(hull).length).toBeGreaterThan(0)
  })
})

describe('greebled hulls survive the loader clone', () => {
  it('keeps instance matrices and colours through Object3D.clone', () => {
    // `createCraftModelLoader` runs every pass on a CACHED source and gives each spawned ship
    // `source.clone(true)`. If InstancedMesh did not survive that, no ship a player ever sees would have
    // greebles — the same class of failure that made the environment probe measure zero.
    const hull = makeTestHull()
    applyHullGreebles(hull)
    const clone = hull.clone(true)
    const originals = greebleMeshes(hull)
    const clones = greebleMeshes(clone)
    expect(clones.length).toBe(originals.length)
    for (let i = 0; i < originals.length; i++) {
      expect(clones[i].count).toBe(originals[i].count)
      expect(Array.from(clones[i].instanceMatrix.array)).toEqual(Array.from(originals[i].instanceMatrix.array))
      expect(clones[i].instanceColor).not.toBeNull()
      expect(Array.from(clones[i].instanceColor!.array)).toEqual(Array.from(originals[i].instanceColor!.array))
    }
  })
})

describe('name rules', () => {
  it('cover the cockpit vocabulary every flyable hull actually uses', () => {
    for (const name of [
      'narrow_cyan_predator_canopy', 'large_cyan_bubble_canopy', 'forward_command_bridge',
      'wide_cyan_bridge_window', 'wide_worksite_visor', 'blocky_operator_cab', 'raised_cockpit_pod',
      'low_cockpit', 'slit_canopy', 'amber_mining_visor',
    ]) {
      expect(COCKPIT_NAME.test(name)).toBe(true)
    }
  })

  it('does not reserve ordinary structure as a cockpit', () => {
    // Over-reserving is not a harmless failure: the cockpit clearance is a tenth of the hull, so a
    // structural member caught by it takes a large bite out of the ship.
    for (const name of [
      'long_armored_cargo_spine', 'industrial_rectangular_chassis', 'wide_manta_assault_body',
      'needle_core_octahedral_body', 'jagged_arrowhead_core', 'oversized_rear_ore_tank',
      'port_crescent_claw_wing', 'port_outrigger_strut_front', 'ventral keel', 'faceted prow',
      'flight deck spine', 'outer flight pod -1', 'sovereign_heavy_core',
    ]) {
      expect(COCKPIT_NAME.test(name)).toBe(false)
    }
  })
})

describe('self-lit classification', () => {
  it('catches every glow, core and nav light the GLBs actually ship', () => {
    for (const spec of AUTHORED_SELF_LIT) expect(isSelfLit(material(spec))).toBe(true)
  })

  it('catches materials with a real emissive factor', () => {
    for (const spec of [
      ['cyan_glass_emissive', 0.06, 0.12, [0.162, 0.807, 1.0]] as const,
      ['teal_emissive_panels', 0.18, 0.25, [0.156, 1.0, 0.578]] as const,
      ['amber_work_lights', 0.1, 0.2, [1.0, 0.521, 0.102]] as const,
    ]) {
      const mat = material(spec as [string, number, number, [number, number, number]])
      mat.emissive.setRGB(0.5, 0.3, 0.1, THREE.LinearSRGBColorSpace)
      expect(isSelfLit(mat)).toBe(true)
    }
  })

  it('leaves every hull material alone', () => {
    // The whole reason this is a value test rather than a name test. A name test for `core` and `light`
    // matched `needle_core_octahedral_body`, `jagged_arrowhead_core` and `flight deck spine` — three
    // main structural members — and reserved them along with a clearance zone around each.
    for (const spec of AUTHORED_HULL) expect(isSelfLit(material(spec))).toBe(false)
  })

  it('separates the two authored families with margin on both sides', () => {
    // Not a coincidence to be relied on silently: the generator authored glows at metalness 0 /
    // roughness 0.9 / bright, and hulls at metalness 0.35+ / roughness 0.55- / dark. If a future asset
    // ever narrows that gap, this fails here rather than in a capture.
    const lit = AUTHORED_SELF_LIT.map(material)
    const hull = AUTHORED_HULL.map(material)
    expect(Math.max(...lit.map((m) => m.metalness))).toBeLessThan(Math.min(...hull.map((m) => m.metalness)))
    expect(Math.min(...lit.map((m) => m.roughness))).toBeGreaterThan(Math.max(...hull.map((m) => m.roughness)))
  })
})
