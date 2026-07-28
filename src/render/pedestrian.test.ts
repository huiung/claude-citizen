import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildPedestrian } from './pedestrian'
import { WALKER_HEIGHT } from '../sim/onFoot'

/** World box of the figure's solid parts. The contact shadow is a ground decal wider than the
 *  body and must not vote on the figure's own dimensions. */
function bodyBox(group: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  group.updateWorldMatrix(true, true)
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if ((mesh.material as THREE.Material).transparent) return // the shadow decal
    box.expandByObject(mesh)
  })
  return box
}

describe('buildPedestrian', () => {
  it('is a 1.8-unit human, standing on the origin', () => {
    // The whole scale argument for planetfall rests on this: one world unit is one metre near the
    // ground (DOCK_RANGE is documented as metres, hulls are 4-17 units long), so if the figure
    // drifts off 1.8 the ship stops towering over it and the arrival stops reading.
    const ped = buildPedestrian(0x4f8a5f)
    const box = bodyBox(ped.group)
    expect(box.max.y).toBeCloseTo(WALKER_HEIGHT, 1)
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02) // feet on the ground plane, not through it
    expect(box.min.y).toBeLessThan(0.06)
    ped.dispose()
  })

  it('is narrower and thinner than it is tall', () => {
    const ped = buildPedestrian(0x4f8a5f)
    const size = bodyBox(ped.group).getSize(new THREE.Vector3())
    expect(size.x).toBeLessThan(size.y)
    expect(size.z).toBeLessThan(size.y)
    ped.dispose()
  })

  it('carries its life-support pack behind it, so -Z is the front', () => {
    // Forward is -Z throughout this project (the hulls declare `extras: { forward: "-Z" }`), and
    // the caller aims the figure with a Matrix4.lookAt that assumes it. If the pack ever ends up on
    // the -Z side the walker moonwalks and nothing else in the code would notice.
    const ped = buildPedestrian(0x4f8a5f)
    const box = bodyBox(ped.group)
    expect(box.max.z).toBeGreaterThan(-box.min.z)
    ped.dispose()
  })

  it('lays a contact shadow flat on the ground under the feet', () => {
    const ped = buildPedestrian(0x4f8a5f)
    ped.group.updateWorldMatrix(true, true)
    const shadow = ped.group.children.find(
      (child) => (child as THREE.Mesh).isMesh && ((child as THREE.Mesh).material as THREE.Material).transparent,
    ) as THREE.Mesh
    expect(shadow).toBeDefined()
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(shadow.quaternion)
    expect(Math.abs(normal.y)).toBeCloseTo(1, 5) // facing straight up
    expect(shadow.position.y).toBeGreaterThan(0)
    expect(shadow.position.y).toBeLessThan(0.1)
    ped.dispose()
  })

  it('swings the limbs in opposition and settles to a stand at rest', () => {
    const ped = buildPedestrian(0x4f8a5f)
    ped.update(Math.PI / 2, 1)
    const pivots = ped.group.children[0].children.filter((c) => c.type === 'Group')
    const swings = pivots.map((p) => p.rotation.x)
    expect(Math.max(...swings)).toBeGreaterThan(0.1)
    expect(Math.min(...swings)).toBeLessThan(-0.1)
    expect(swings.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 5) // legs and arms cancel

    ped.update(Math.PI / 2, 0)
    for (const p of pivots) expect(p.rotation.x).toBeCloseTo(0, 6)
    ped.dispose()
  })

  it('releases its geometries and materials on dispose', () => {
    const ped = buildPedestrian(0x4f8a5f)
    let disposed = 0
    ped.group.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.addEventListener('dispose', () => { disposed++ })
    })
    ped.dispose()
    expect(disposed).toBeGreaterThan(0)
  })
})
