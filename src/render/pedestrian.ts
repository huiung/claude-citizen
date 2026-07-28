import * as THREE from 'three'

/**
 * The pilot, out of the ship: a procedural low-poly figure in a pressure suit.
 *
 * Procedural because everything in this repo is (see `ship.ts`'s `buildShip`, `world.ts`) and
 * because there is no humanoid asset anywhere in `public/assets/` to load — eleven ship GLBs and
 * one landmark. A downloaded character would also be the only thing in the scene not built out of
 * boxes and cylinders, which reads worse than a crude figure that matches its surroundings.
 *
 * Built as a spacesuit rather than a person: at 1.8 units against a 4300-unit planet the figure is
 * a silhouette long before it is a face, and a suit's silhouette — backpack, helmet, boots — is
 * legible at a distance where a bare human is a smudge. It also removes every question about skin,
 * hair and clothing that a placeholder has no business answering.
 *
 * Origin is at the FEET and forward is -Z, matching the hulls' `extras: { forward: "-Z" }`, so the
 * caller places it with the same "stand it on the ground, aim it along the heading" logic it
 * already uses for the ship. Dimensions below are absolute metres for a WALKER_HEIGHT figure
 * rather than fractions of it — the proportions of a human body are not a free parameter, and
 * spelling them out is how the 1.8 stays checkable against the 2.2 x 1.8 x 4.2 hull it parks by.
 */

/** Peak limb swing at full speed (radians). Beyond ~0.6 the figure starts to goose-step. */
const LEG_SWING = 0.52
const ARM_SWING = 0.38

export interface Pedestrian {
  group: THREE.Group
  /** `stride` is the walk-cycle phase in radians (see `strideParams`); `motion` is 0..1 and scales
   *  the whole cycle down to a stand at rest, so stopping settles rather than snapping to a pose. */
  update(stride: number, motion: number): void
  dispose(): void
}

/** Soft round contact shadow. The design doc calls grounding "the cheapest large win" and this is
 *  the cheapest part of it: without a dark patch under the boots the figure reads as hovering over
 *  the deck no matter how exactly its feet are placed, because nothing else in the scene casts a
 *  shadow — there is no shadow map anywhere in `src/`. A painted disc is a lie that costs one draw
 *  call and fixes the exact failure a real shadow map would. */
function contactShadowTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - c, y - c) / c)
      const a = Math.pow(1 - r, 1.9) // soft edge, no hard rim
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
      data[i + 3] = Math.round(a * 190)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}

export function buildPedestrian(tint: number): Pedestrian {
  const group = new THREE.Group()
  // Everything except the shadow hangs off `body`, which bobs; the shadow stays on the ground.
  const body = new THREE.Group()
  group.add(body)

  // Suit greys run light for the same reason the city fabric does (see cityChunk's groundMat):
  // sRGB below ~0x60 sits under 10% linear reflectance and reads as a soot-black cutout beside
  // daylit terrain.
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, flatShading: true, roughness: 0.75, metalness: 0.1 })
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x474d55, flatShading: true, roughness: 0.6, metalness: 0.35 })
  const trimMat = new THREE.MeshStandardMaterial({ color: tint, flatShading: true, roughness: 0.5, metalness: 0.3 })
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x123244, flatShading: true, roughness: 0.15, metalness: 0.6, emissive: 0x2fa8d8, emissiveIntensity: 0.7,
  })
  const shadowTex = contactShadowTexture()
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false })

  const geometries: THREE.BufferGeometry[] = []
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    geometries.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }

  // Torso: chest block over a narrower waist, so the front reads from the side too.
  add(body, new THREE.BoxGeometry(0.46, 0.40, 0.28), suitMat, 0, 1.19, 0)
  add(body, new THREE.BoxGeometry(0.40, 0.16, 0.24), jointMat, 0, 0.91, 0)
  // Life-support pack — the most recognisable part of the silhouette from behind, which is the
  // angle a third-person camera holds essentially all of the time.
  add(body, new THREE.BoxGeometry(0.38, 0.42, 0.18), jointMat, 0, 1.22, 0.22)
  add(body, new THREE.BoxGeometry(0.30, 0.06, 0.04), trimMat, 0, 1.44, 0.31)
  // Chest trim: a tint-coloured mark tying the figure to the player's hull.
  add(body, new THREE.BoxGeometry(0.34, 0.05, 0.02), trimMat, 0, 1.33, -0.145)

  // Head: helmet ball plus a visor plate over its front face. Low segment counts on purpose — the
  // rest of the scene is flat-shaded low-poly and a smooth sphere here would look imported.
  add(body, new THREE.CylinderGeometry(0.075, 0.09, 0.09, 6), jointMat, 0, 1.45, 0) // neck ring
  add(body, new THREE.SphereGeometry(0.145, 10, 7), suitMat, 0, 1.63, 0)
  const visor = add(body, new THREE.SphereGeometry(0.129, 10, 7, 0, Math.PI, 0.55, 1.15), visorMat, 0, 1.63, 0)
  visor.rotation.y = Math.PI / 2 // sweep the open half onto the -Z (forward) face

  // Limbs pivot at hip / shoulder, so each is a group with its geometry hanging below the origin.
  const limb = (px: number, py: number, len: number, thick: number): THREE.Group => {
    const pivot = new THREE.Group()
    pivot.position.set(px, py, 0)
    body.add(pivot)
    add(pivot, new THREE.BoxGeometry(thick, len, thick), suitMat, 0, -len / 2, 0)
    return pivot
  }
  const HIP_Y = 0.85
  const legL = limb(-0.115, HIP_Y, 0.78, 0.17)
  const legR = limb(0.115, HIP_Y, 0.78, 0.17)
  const armL = limb(-0.29, 1.42, 0.56, 0.13)
  const armR = limb(0.29, 1.42, 0.56, 0.13)
  // Boots ride on the legs so they swing with them.
  for (const leg of [legL, legR]) {
    add(leg, new THREE.BoxGeometry(0.19, 0.09, 0.28), jointMat, 0, -0.80, -0.04)
  }

  const shadowGeo = new THREE.PlaneGeometry(1.35, 1.35)
  geometries.push(shadowGeo)
  const shadow = new THREE.Mesh(shadowGeo, shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.03 // clear of the deck's z-fighting range without reading as a floating card
  shadow.renderOrder = -1
  group.add(shadow)

  return {
    group,
    update(stride: number, motion: number): void {
      const m = Math.min(1, Math.max(0, motion))
      const swing = Math.sin(stride) * m
      legL.rotation.x = swing * LEG_SWING
      legR.rotation.x = -swing * LEG_SWING
      armL.rotation.x = -swing * ARM_SWING
      armR.rotation.x = swing * ARM_SWING
      // Two bobs per stride (one per footfall). The shadow tightens and darkens as the body drops,
      // so the contact tracks the footfall instead of sliding along under a floating figure.
      const rise = (1 - Math.abs(Math.cos(stride))) * 0.045 * m
      body.position.y = rise
      shadow.scale.setScalar(1 + rise * 1.4)
      shadowMat.opacity = 0.9 - rise * 2.4
    },
    dispose(): void {
      for (const geo of geometries) geo.dispose()
      suitMat.dispose(); jointMat.dispose(); trimMat.dispose(); visorMat.dispose(); shadowMat.dispose()
      shadowTex.dispose()
    },
  }
}
