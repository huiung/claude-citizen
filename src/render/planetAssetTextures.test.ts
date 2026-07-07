import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyPlanetAssetTextures, planetAssetUrls } from './planetAssetTextures'

describe('planetAssetUrls', () => {
  it('maps the four real-imagery planets to /textures/planets files', () => {
    expect(planetAssetUrls('Mercury')?.map).toBe('/textures/planets/mercury.jpg')
    expect(planetAssetUrls('Venus')?.map).toBe('/textures/planets/venus.jpg')
    expect(planetAssetUrls('Mars')?.map).toBe('/textures/planets/mars.jpg')
    expect(planetAssetUrls('Jupiter')?.map).toBe('/textures/planets/jupiter.jpg')
  })

  it('returns null for Earth (orbit view must match procedural landing terrain) and unknown bodies', () => {
    expect(planetAssetUrls('Earth')).toBeNull()
    expect(planetAssetUrls('XQ-77')).toBeNull()
    // no public-domain Saturn map exists — stays procedural
    expect(planetAssetUrls('Saturn')).toBeNull()
  })
})

describe('applyPlanetAssetTextures', () => {
  function planetLikeGroup() {
    const group = new THREE.Group()
    const surface = new THREE.MeshStandardMaterial({ bumpMap: new THREE.Texture() })
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), surface))
    const cloud = new THREE.MeshBasicMaterial()
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), cloud))
    return { group, surface, cloud }
  }

  it('swaps the surface map on every MeshStandardMaterial mesh, leaving clouds/atmo alone', () => {
    const { group, surface, cloud } = planetLikeGroup()
    const map = new THREE.Texture()
    expect(applyPlanetAssetTextures(group, { map })).toBe(1)
    expect(surface.map).toBe(map)
    expect(cloud.map).toBeNull()
  })

  it('installs a normal map in place of the procedural bump when provided', () => {
    const { group, surface } = planetLikeGroup()
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    applyPlanetAssetTextures(group, { map, normalMap })
    expect(surface.normalMap).toBe(normalMap)
    expect(surface.bumpMap).toBeNull()
  })

  it('counts every LOD level surface it touched', () => {
    const group = new THREE.Group()
    const lod = new THREE.LOD()
    for (const dist of [0, 10, 20]) {
      lod.addLevel(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()), dist)
    }
    group.add(lod)
    expect(applyPlanetAssetTextures(group, { map: new THREE.Texture() })).toBe(3)
  })
})
