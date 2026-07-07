import * as THREE from 'three'

// Real-imagery maps for the named solar system (NASA-derived, public domain).
// Earth is deliberately absent: its orbit view must stay consistent with the
// procedural landing terrain, so it keeps the generated texture.
// Saturn is also absent: no public-domain surface map exists; it stays procedural
// with banded rings instead.
const ASSET_ROOT = '/textures/planets'

export interface PlanetAssetUrls {
  map: string
  normalMap?: string
}

const PLANET_ASSET_URLS: Readonly<Record<string, PlanetAssetUrls>> = {
  Mercury: { map: `${ASSET_ROOT}/mercury.jpg` },
  Venus: { map: `${ASSET_ROOT}/venus.jpg` },
  Mars: { map: `${ASSET_ROOT}/mars.jpg` },
  Jupiter: { map: `${ASSET_ROOT}/jupiter.jpg` },
}

export function planetAssetUrls(name: string): PlanetAssetUrls | null {
  return PLANET_ASSET_URLS[name] ?? null
}

export interface PlanetAssetTextures {
  map: THREE.Texture
  normalMap?: THREE.Texture
}

/** Load the real-imagery maps for a named planet. Resolves null when the planet has no
 *  assets (Earth, procedural bodies) or a file fails to load — the caller keeps the
 *  procedural look, so a 404/offline can never break the scene. */
export async function loadPlanetAssetTextures(name: string, anisotropy = 8): Promise<PlanetAssetTextures | null> {
  const urls = planetAssetUrls(name)
  if (!urls) return null
  const loader = new THREE.TextureLoader()
  let map: THREE.Texture | undefined
  try {
    const [loadedMap, normalMap] = await Promise.all([
      loader.loadAsync(urls.map),
      urls.normalMap ? loader.loadAsync(urls.normalMap) : Promise.resolve(undefined),
    ])
    map = loadedMap
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = anisotropy
    if (normalMap) normalMap.anisotropy = anisotropy
    return { map, normalMap }
  } catch {
    map?.dispose()
    return null
  }
}

/** Swap a built solar-planet group's surfaces over to real-imagery maps. Surface meshes are
 *  the MeshStandardMaterial ones — atmosphere/clouds/rings use Basic/Shader materials.
 *  Returns how many materials were updated (every LOD level counts).
 *  NOTE: the replaced procedural maps must NOT be disposed here — they belong to the shared
 *  texture caches in planetTextures.ts; disposing them would corrupt cache entries reused
 *  by other builds. */
export function applyPlanetAssetTextures(group: THREE.Object3D, assets: PlanetAssetTextures): number {
  let applied = 0
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const material = obj.material
    if (!(material instanceof THREE.MeshStandardMaterial)) return
    material.map = assets.map
    if (assets.normalMap) {
      material.normalMap = assets.normalMap
      material.bumpMap = null
    }
    material.needsUpdate = true
    applied++
  })
  return applied
}
