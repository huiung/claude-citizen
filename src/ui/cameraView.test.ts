import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  COCKPIT_NEAR_PLANE,
  cockpitEyeOffset,
  defaultRearDistance,
  isCanopyNodeName,
  nextCameraMode,
  orbitCameraOffset,
  queueOrbitZoomDelta,
  rearCameraOffset,
  resolveCockpitEyeAnchor,
  showHullInteriorFaces,
  zoomOrbitDistance,
  zoomRearDistance,
} from './cameraView'

describe('camera view controls', () => {
  it('cycles rear -> orbit -> cockpit and back', () => {
    expect(nextCameraMode('rear')).toBe('orbit')
    expect(nextCameraMode('orbit')).toBe('cockpit')
    expect(nextCameraMode('cockpit')).toBe('rear')
  })

  it('moves the orbit camera around the ship far enough to see the nose', () => {
    const rear = orbitCameraOffset(0, 0)
    const front = orbitCameraOffset(Math.PI / 0.45, 0)

    expect(rear.z).toBeGreaterThan(0)
    expect(front.z).toBeLessThan(0)
    expect(Math.abs(front.x)).toBeLessThan(0.001)
  })

  it('zooms orbit distance with clamped mouse wheel steps', () => {
    expect(zoomOrbitDistance(8.3, -600)).toBe(6.5)
    expect(zoomOrbitDistance(8.3, 600)).toBe(10.1)
    expect(zoomOrbitDistance(5, -600)).toBe(4.5)
    expect(zoomOrbitDistance(13.8, 600)).toBe(14)
  })

  it('uses a wider rear combat camera and clamps rear wheel zoom', () => {
    expect(defaultRearDistance()).toBe(14)
    expect(rearCameraOffset(0).z).toBe(14)
    expect(rearCameraOffset(1, 20).z).toBe(24)
    expect(zoomRearDistance(14, -1000)).toBe(10)
    expect(zoomRearDistance(14, 1000)).toBe(20)
    expect(zoomRearDistance(25, 1000)).toBe(26)
  })

  it('caps queued wheel bursts so zoom is consumed once per frame', () => {
    expect(queueOrbitZoomDelta(0, 200)).toBe(200)
    expect(queueOrbitZoomDelta(800, 800)).toBe(900)
    expect(queueOrbitZoomDelta(-800, -800)).toBe(-900)
  })
})

/** A stand-in for a loaded hull, shaped like the real thing: `loadCraftModelForType` returns an
 *  outer Group wrapping a scaled and recentred inner model, and the outer Group carries the ship's
 *  live world transform. Both layers matter — the anchor has to survive the inner scale/offset and
 *  be independent of the outer transform. */
function hullFixture(
  nodes: readonly { name: string; z: number; y?: number }[],
  hullDepth = 12,
): THREE.Group {
  const group = new THREE.Group()
  const inner = new THREE.Group()
  inner.scale.setScalar(1.5)      // normalizeCraftModel scales to the class's target size
  inner.position.set(0.3, 0, 0.2) // and recentres the model on the origin
  group.add(inner)
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2, 2, hullDepth), new THREE.MeshStandardMaterial())
  chassis.name = 'unnamed_chassis' // deliberately not a canopy name
  inner.add(chassis)
  for (const node of nodes) {
    // Thin in y, as the real canopies are: they are glass plates on the hull's skin, not shells.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.6), new THREE.MeshStandardMaterial())
    mesh.name = node.name
    mesh.position.set(0, node.y ?? 1.1, node.z)
    inner.add(mesh)
  }
  group.position.set(120, -8, 4000)
  group.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.2))
  return group
}

describe('cockpit camera', () => {
  it('recognises the canopy node each hull actually ships', () => {
    for (const name of [
      'narrow_cyan_predator_canopy', 'raised_cockpit_pod', 'large_cyan_bubble_canopy',
      'wide_cyan_bridge_window', 'low_cockpit', 'control bridge', 'central deck window 0',
      // miner and abyssal-driller name their cockpit after the crew and the glass shape, not the
      // word "canopy" — the miner was thought to have no cockpit node purely because of that.
      'blocky_operator_cab', 'wide_worksite_visor', 'amber_mining_visor',
    ]) {
      expect(isCanopyNodeName(name)).toBe(true)
    }
    for (const name of [
      'hull_plate', 'engine_nacelle', 'port_cargo_window_row_-1.7',
      'cabin_strut', 'power_cable_run', // /cab/ unanchored would wrongly claim both of these
    ]) {
      expect(isCanopyNodeName(name)).toBe(false)
    }
  })

  it('puts the eye above and behind the glass, never inside it', () => {
    // interceptor's real narrow_cyan_predator_canopy box at game scale: 0.47 x 0.23 x 1.11. A plate,
    // with solid fuselage behind it, so the eye has to clear it in y rather than burrow into it.
    const canopy = new THREE.Box3(new THREE.Vector3(-0.24, -0.05, -0.7), new THREE.Vector3(0.24, 0.17, 0.42))
    const eye = cockpitEyeOffset(canopy, 8.4)
    expect(eye.x).toBe(0)
    expect(eye.y).toBeGreaterThan(0.17) // above the glass's crown, not buried in the chassis
    expect(eye.z).toBeGreaterThan(0.42) // and aft of its trailing edge, so the glass stays in frame
  })

  it('seats the pilot at the most forward canopy, not the first one found', () => {
    // holder-doge-runner's exact trap: a nose canopy and a tail bridge, and `bridge$` matches the
    // tail. Traversal order would put the eye behind the engines looking up its own hull.
    const eye = resolveCockpitEyeAnchor(hullFixture([
      { name: 'flush_blue_canopy', z: -1.85 },
      { name: 'dark_gold_tail_bridge', z: 3.08 },
    ], 12))
    // nose canopy's trailing edge is at -2.125 in hull space, plus the 0.7 aft-bias cap
    expect(eye.z).toBeCloseTo(-1.425, 3)
    expect(eye.z).toBeLessThan(0) // and nowhere near the tail bridge, which starts at +4.37
  })

  it('lifts the eye clear of structure the canopy sits under', () => {
    // holder-eclipse-corvette's shape: raised_command_bridge tops out at y 0.55 while the hull
    // around it reaches y 2.1, so an eye placed off the canopy alone is inside the superstructure.
    const canopy = [{ name: 'raised_command_bridge', z: -1, y: 0.4 }]
    const withTower = hullFixture(canopy)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 3), new THREE.MeshStandardMaterial())
    tower.name = 'armoured_superstructure'
    tower.position.set(0, 1.5, -1.4)
    withTower.children[0].add(tower) // the inner, scaled model group
    const towerTop = 5.25 // (1.5 + 2) * 1.5 scale

    expect(resolveCockpitEyeAnchor(withTower).y).toBeGreaterThan(towerTop)
    expect(resolveCockpitEyeAnchor(withTower).y).toBeLessThan(towerTop + 0.3) // cleared, not launched
    // Without the tower the same canopy gives a much lower eye — the lift is what moved it.
    expect(resolveCockpitEyeAnchor(hullFixture(canopy)).y).toBeLessThan(2)
  })

  it('lifts the eye above structure standing directly ahead of it', () => {
    // Clearing only what the eye is buried in still let the corvette's forward superstructure fill
    // the whole frame — a lit wall of hull, sky in the top corners only.
    const canopy = [{ name: 'raised_command_bridge', z: -1, y: 0.4 }]
    const build = (wallInnerZ: number): THREE.Group => {
      const hull = hullFixture(canopy)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 1), new THREE.MeshStandardMaterial())
      wall.name = 'forward_armour_block'
      wall.position.set(0, 1.5, wallInnerZ)
      hull.children[0].add(wall)
      return hull
    }
    const wallTop = 5.25 // (1.5 + 2) * 1.5 scale

    // Inside the quarter-hull probe: the eye has to clear it or it is the entire view.
    expect(resolveCockpitEyeAnchor(build(-2.4)).y).toBeGreaterThan(wallTop)
    // Beyond the probe: far enough down the hull to read as scenery, so it gets no vote. Otherwise
    // every hull's own nose would push the eye above the whole ship.
    expect(resolveCockpitEyeAnchor(build(-4)).y).toBeLessThan(2)
  })

  it('reads the anchor in hull space, so the world transform cannot move it', () => {
    const nodes = [{ name: 'low_cockpit', z: -1.4 }]
    const still = hullFixture(nodes)
    still.position.set(0, 0, 0)
    still.quaternion.identity()
    const flying = hullFixture(nodes) // parked out at (120, -8, 4000) and rotated
    const parked = resolveCockpitEyeAnchor(still)
    const moved = resolveCockpitEyeAnchor(flying)
    // Not exact equality: inverting a matrix carrying a 4000-unit translation costs a few ulps, and
    // ~1e-12 of drift on an 8-unit hull is nothing. Anything that actually mislocated the eye — a
    // world-space bounding box, a forgotten matrix update — would be off by whole units.
    for (const axis of ['x', 'y', 'z'] as const) expect(moved[axis]).toBeCloseTo(parked[axis], 9)
  })

  it('anchors a hull with no canopy node at all to its forward skin', () => {
    // The procedural buildCraft() hulls have unnamed meshes, and they are what a pilot flies for the
    // frames before the GLB arrives — or permanently, if it 404s.
    const eye = resolveCockpitEyeAnchor(hullFixture([], 8))
    // hull spans z -5.8..6.2 and y -1.5..1.5 in hull space (depth 8 * 1.5 scale, offset +0.2)
    expect(eye.z).toBeGreaterThan(-5.8) // over the hull, not floating out past the nose
    expect(eye.z).toBeLessThan(0.2) // and forward of its centre, where a cockpit belongs
    expect(eye.y).toBeGreaterThan(1.5) // resting on the skin rather than sunk into the chassis
    expect(eye.y).toBeLessThan(1.9)
  })

  it('survives a hull with no meshes rather than returning NaN', () => {
    // setPlayerCraft rebuilds the rig on every hull swap, including before a model has arrived.
    expect(resolveCockpitEyeAnchor(new THREE.Group()).toArray()).toEqual([0, 0, 0])
  })

  it('shows interior faces while the cockpit is active and restores the authored sides', () => {
    const hull = hullFixture([{ name: 'low_cockpit', z: -1.4 }])
    const materials: THREE.Material[] = []
    hull.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) materials.push(mesh.material as THREE.Material)
    })
    expect(materials.length).toBeGreaterThan(1)
    materials[0].side = THREE.BackSide // an authored side that is neither the default nor DoubleSide

    const faces = showHullInteriorFaces(hull)
    for (const material of materials) expect(material.side).toBe(THREE.DoubleSide)

    faces.restore()
    expect(materials[0].side).toBe(THREE.BackSide)
    for (const material of materials.slice(1)) expect(material.side).toBe(THREE.FrontSide)
  })

  it('uses a near plane tight enough to keep the canopy in front of it', () => {
    // The tightest clearance the module will place the eye at is 0.06 (cockpitEyeOffset's floor);
    // a near plane at or beyond that clips the canopy out of the one view it exists to show.
    expect(COCKPIT_NEAR_PLANE).toBeLessThan(0.06)
  })
})
