import * as THREE from 'three'

// Real-imagery maps for the named solar system (NASA/USGS-derived, public domain).
// Earth is LOD-limited: the closest level keeps the procedural texture so the up-close
// look stays consistent with the procedural landing terrain and collision (see
// applyPlanetAssetTextures's keepProceduralCloseup). Saturn is absent: no public-domain
// surface map exists; it stays procedural with banded rings instead.
const ASSET_ROOT = '/textures/planets'

export interface PlanetAssetUrls {
  map: string
  normalMap?: string
}

const PLANET_ASSET_URLS: Readonly<Record<string, PlanetAssetUrls>> = {
  Mercury: { map: `${ASSET_ROOT}/mercury.jpg`, normalMap: `${ASSET_ROOT}/mercury-normal.jpg` },
  Venus: { map: `${ASSET_ROOT}/venus.jpg` },
  Earth: { map: `${ASSET_ROOT}/earth.jpg` },
  Mars: { map: `${ASSET_ROOT}/mars.jpg`, normalMap: `${ASSET_ROOT}/mars-normal.jpg` },
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
 *  assets (procedural bodies) or the albedo fails to load — the caller keeps the
 *  procedural look, so a 404/offline can never break the scene. A failed normal map is
 *  non-fatal: the albedo still applies, matching the pre-normal behavior. */
export async function loadPlanetAssetTextures(name: string, anisotropy = 8): Promise<PlanetAssetTextures | null> {
  const urls = planetAssetUrls(name)
  if (!urls) return null
  const loader = new THREE.TextureLoader()
  const [mapResult, normalResult] = await Promise.allSettled([
    loader.loadAsync(urls.map),
    urls.normalMap ? loader.loadAsync(urls.normalMap) : Promise.resolve(undefined),
  ])
  const map = mapResult.status === 'fulfilled' ? mapResult.value : undefined
  const normalMap = normalResult.status === 'fulfilled' ? normalResult.value : undefined
  if (mapResult.status === 'rejected') {
    // albedo is mandatory — dispose any loaded normal and keep the procedural look
    normalMap?.dispose()
    return null
  }
  // a missing/failed normal map is non-fatal: albedo alone matches the pre-normal behavior
  if (!map) return null
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = anisotropy
  if (normalMap) normalMap.anisotropy = anisotropy
  return { map, normalMap }
}

export interface ApplyPlanetAssetOptions {
  /** Earth: keep the procedural map on the CLOSEST LOD level so the up-close look stays
   *  consistent with the procedural landing terrain and collision heights. */
  keepProceduralCloseup?: boolean
}

/** Swap a built solar-planet group's surfaces over to real-imagery maps. Surface meshes are
 *  the MeshStandardMaterial ones — atmosphere/clouds/rings use Basic/Shader materials.
 *  Returns how many materials were updated (every LOD level counts unless skipped).
 *  NOTE: the replaced procedural maps must NOT be disposed here — they belong to the shared
 *  texture caches in planetTextures.ts; disposing them would corrupt cache entries reused
 *  by other builds. */
export function applyPlanetAssetTextures(
  group: THREE.Object3D,
  assets: PlanetAssetTextures,
  options: ApplyPlanetAssetOptions = {},
): number {
  const skip = new Set<THREE.Object3D>()
  if (options.keepProceduralCloseup) {
    group.traverse((obj) => {
      if (obj instanceof THREE.LOD && obj.levels.length > 0) skip.add(obj.levels[0].object)
    })
  }
  let applied = 0
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || skip.has(obj)) return
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
