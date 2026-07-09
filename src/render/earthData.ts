import * as THREE from 'three'

// Real-Earth data source — NASA imagery, all public domain:
//  - color-2048/3600.jpg: Blue Marble Next Generation w/ topography+bathymetry, July 2004
//    (NASA Earth Observatory / Reto Stockli, neo.gsfc.nasa.gov)
//  - elev-1024.png: GEBCO_08 land elevation grayscale (ocean = black)
//  - bath-1024.png: GEBCO_08 bathymetry grayscale (land = white, deeper ocean = darker)
//  - clouds-2048.jpg: NASA cloud_combined
// One equirect convention is shared by the rasters, the sphere textures, and city
// placement, so what you see is where you land.

/** Land pixels are white (255) in the bathymetry map; anything darker is water. */
const BATH_LAND_THRESHOLD = 240
/** Height ranges match the procedural Earth (ocean -0.18..-0.26, land 0.06..0.40) so the
 *  collision clamp, altitude HUD, and the 0.05 city-placement threshold keep working. */
const SEA_LEVEL_HEIGHT = -0.18
const SEA_DEPTH_RANGE = 0.08
const LAND_BASE_HEIGHT = 0.06
const LAND_HEIGHT_RANGE = 0.34

interface EarthRasters {
  elev: Uint8ClampedArray
  bath: Uint8ClampedArray
  width: number
  height: number
}

let rasters: EarthRasters | null = null
let colorStartup: THREE.Texture | null = null
let colorHigh: THREE.Texture | null = null
let clouds: THREE.Texture | null = null

/** three SphereGeometry UV convention: u=0 → -X, u=0.25 → +Z, v=0 → north pole (+Y).
 *  Equirect textures put longitude -180° at the left edge. */
export function latLonToDir(latDeg: number, lonDeg: number): THREE.Vector3 {
  const theta = ((90 - latDeg) * Math.PI) / 180
  const phi = ((lonDeg + 180) / 360) * Math.PI * 2
  const sinT = Math.sin(theta)
  return new THREE.Vector3(-sinT * Math.cos(phi), Math.cos(theta), sinT * Math.sin(phi))
}

export function dirToEquirectUv(nx: number, ny: number, nz: number): { u: number; v: number } {
  let u = Math.atan2(nz, -nx) / (Math.PI * 2)
  if (u < 0) u += 1
  const v = Math.acos(THREE.MathUtils.clamp(ny, -1, 1)) / Math.PI
  return { u, v }
}

/** Bilinear sample of one grayscale raster; u wraps (longitude), v clamps (poles). */
function bilinear(data: Uint8ClampedArray, width: number, height: number, u: number, v: number): number {
  const px = u * width - 0.5
  const py = THREE.MathUtils.clamp(v * height - 0.5, 0, height - 1)
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const fx = px - x0
  const fy = py - y0
  const xa = ((x0 % width) + width) % width
  const xb = (xa + 1) % width
  const ya = THREE.MathUtils.clamp(y0, 0, height - 1)
  const yb = THREE.MathUtils.clamp(y0 + 1, 0, height - 1)
  const top = data[ya * width + xa] * (1 - fx) + data[ya * width + xb] * fx
  const bot = data[yb * width + xa] * (1 - fx) + data[yb * width + xb] * fx
  return top * (1 - fy) + bot * fy
}

export function isEarthDataReady(): boolean {
  return rasters !== null
}

/** Real-Earth terrain sample: bathymetry decides water, elevation shapes the land. */
export function sampleEarthElevation(nx: number, ny: number, nz: number): { height: number; water: boolean } {
  const r = rasters!
  const { u, v } = dirToEquirectUv(nx, ny, nz)
  const bath = bilinear(r.bath, r.width, r.height, u, v)
  if (bath < BATH_LAND_THRESHOLD) {
    const depth = THREE.MathUtils.clamp((BATH_LAND_THRESHOLD - bath) / BATH_LAND_THRESHOLD, 0, 1)
    return { height: SEA_LEVEL_HEIGHT - depth * SEA_DEPTH_RANGE, water: true }
  }
  const elev = bilinear(r.elev, r.width, r.height, u, v)
  return { height: LAND_BASE_HEIGHT + (elev / 255) * LAND_HEIGHT_RANGE, water: false }
}

export function earthColorTexture(quality: 'startup' | 'high'): THREE.Texture | null {
  return quality === 'high' ? (colorHigh ?? colorStartup) : (colorStartup ?? colorHigh)
}

export function earthCloudTexture(): THREE.Texture | null {
  return clouds
}

function grayscaleTexture(values: (i: number) => number, width: number, height: number): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const g = values(i)
    img.data[i * 4] = g
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = g
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** Land relief for bumpMap — the elevation raster as-is (ocean stays flat black). */
export function makeEarthBumpTexture(): THREE.Texture | null {
  if (!rasters) return null
  const r = rasters
  return grayscaleTexture((i) => r.elev[i], r.width, r.height)
}

/** Ocean glint map: smooth water (roughness ~0.2), matte land (~0.95). */
export function makeEarthRoughnessTexture(): THREE.Texture | null {
  if (!rasters) return null
  const r = rasters
  return grayscaleTexture((i) => (r.bath[i] < BATH_LAND_THRESHOLD ? 51 : 242), r.width, r.height)
}

async function loadRaster(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const gray = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] // grayscale source — R channel is enough
  return { data: gray, width: canvas.width, height: canvas.height }
}

/** cloud_combined ships white-on-black — turn luminance into alpha so the cloud shell
 *  keeps using ordinary transparent blending (black jpg background would paint the
 *  oceans dark otherwise). */
async function loadCloudAlphaTexture(url: string): Promise<THREE.Texture> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = px[i] // alpha = luminance (grayscale source)
    px[i] = px[i + 1] = px[i + 2] = 255 // pure white clouds, opacity carries the shape
  }
  ctx.putImageData(data, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function loadColorTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.anisotropy = 4
      resolve(tex)
    }, undefined, reject)
  })
}

/** Boot-time load of all real-Earth data. Resolves when the rasters and at least the
 *  startup color map are usable; any failure leaves the module not-ready so the
 *  procedural Earth keeps working (offline, tests, asset outage). */
export async function loadEarthData(): Promise<void> {
  if (rasters) return
  try {
    const [elev, bath, startupTex, cloudTex] = await Promise.all([
      loadRaster('/textures/earth/elev-1024.png'),
      loadRaster('/textures/earth/bath-1024.png'),
      loadColorTexture('/textures/earth/color-2048.jpg'),
      loadCloudAlphaTexture('/textures/earth/clouds-2048.jpg').catch(() => null),
    ])
    if (elev.width !== bath.width || elev.height !== bath.height) throw new Error('earth raster size mismatch')
    colorStartup = startupTex
    clouds = cloudTex
    rasters = { elev: elev.data, bath: bath.data, width: elev.width, height: elev.height }
    // The high-res color map can trickle in afterwards — earthColorTexture('high')
    // falls back to the startup map until it lands.
    loadColorTexture('/textures/earth/color-3600.jpg').then((t) => { colorHigh = t }).catch(() => {})
  } catch {
    rasters = null // stay procedural
  }
}

export function _setEarthRastersForTests(elev: Uint8ClampedArray, bath: Uint8ClampedArray, width: number, height: number): void {
  rasters = { elev, bath, width, height }
}

export function _resetEarthDataForTests(): void {
  rasters = null
  colorStartup = null
  colorHigh = null
  clouds = null
}
