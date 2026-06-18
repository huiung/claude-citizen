import * as THREE from 'three'
import type { SurfaceKind } from '../sim/solarSystem'

export type PlanetTextureKind = SurfaceKind | 'moon' | 'ice'

export interface PlanetTextureSet {
  colorMap: THREE.CanvasTexture
  bumpMap?: THREE.CanvasTexture
}

interface Sample {
  color: THREE.Color
  height: number
}

interface Crater {
  x: number
  y: number
  z: number
  radius: number
  strength: number
}

const textureCache = new Map<string, PlanetTextureSet>()
const cloudCache = new Map<string, THREE.CanvasTexture>()
const craterCache = new Map<string, Crater[]>()
const _a = new THREE.Color()
const _b = new THREE.Color()
const _c = new THREE.Color()

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647) ^ seed
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz)
  const c000 = hash3(ix, iy, iz, seed)
  const c100 = hash3(ix + 1, iy, iz, seed)
  const c010 = hash3(ix, iy + 1, iz, seed)
  const c110 = hash3(ix + 1, iy + 1, iz, seed)
  const c001 = hash3(ix, iy, iz + 1, seed)
  const c101 = hash3(ix + 1, iy, iz + 1, seed)
  const c011 = hash3(ix, iy + 1, iz + 1, seed)
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed)
  const x00 = THREE.MathUtils.lerp(c000, c100, fx)
  const x10 = THREE.MathUtils.lerp(c010, c110, fx)
  const x01 = THREE.MathUtils.lerp(c001, c101, fx)
  const x11 = THREE.MathUtils.lerp(c011, c111, fx)
  const y0 = THREE.MathUtils.lerp(x00, x10, fy)
  const y1 = THREE.MathUtils.lerp(x01, x11, fy)
  return THREE.MathUtils.lerp(y0, y1, fz) * 2 - 1
}

function fbm(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let sum = 0
  let amp = 0.5
  let scale = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * scale, y * scale, z * scale, seed + i * 1013) * amp
    norm += amp
    amp *= 0.5
    scale *= 2.03
  }
  return sum / norm
}

function ridged(n: number): number {
  return 1 - Math.abs(n)
}

function featureFrequency(kind: PlanetTextureKind, radius: number): number {
  const ref = kind === 'gas' ? 13000 : kind === 'moon' || kind === 'ice' ? 1800 : 4300
  return THREE.MathUtils.clamp(Math.sqrt(radius / ref), 0.55, 2.6)
}

function craterAngularScale(radius: number): number {
  return THREE.MathUtils.clamp(1800 / radius, 0.28, 1.9)
}

function craterCount(base: number, radius: number): number {
  return Math.round(THREE.MathUtils.clamp(base * Math.pow(radius / 1800, 0.62), base * 0.55, base * 3.4))
}

function buildCraters(seed: number, count: number, angularScale: number): Crater[] {
  const key = `${seed}:${count}:${angularScale.toFixed(3)}`
  const cached = craterCache.get(key)
  if (cached) return cached
  const rand = mulberry32(seed)
  const craters: Crater[] = []
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    craters.push({
      x: Math.cos(a) * r,
      y: z,
      z: Math.sin(a) * r,
      radius: (0.025 + rand() * 0.095) * angularScale,
      strength: 0.35 + rand() * 0.65,
    })
  }
  craterCache.set(key, craters)
  return craters
}

function craterField(x: number, y: number, z: number, craters: Crater[]): number {
  let h = 0
  for (const crater of craters) {
    const dot = THREE.MathUtils.clamp(x * crater.x + y * crater.y + z * crater.z, -1, 1)
    const d = Math.acos(dot)
    if (d > crater.radius) continue
    const t = d / crater.radius
    const bowl = -Math.pow(1 - t, 2.4) * 0.75
    const rim = Math.exp(-Math.pow((t - 0.82) * 8, 2)) * 0.45
    h += (bowl + rim) * crater.strength
  }
  return h
}

function mixColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return _c.copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1))
}

export function samplePlanetSurface(
  kind: PlanetTextureKind,
  seed: number,
  x: number,
  y: number,
  z: number,
  baseColor = 0x999999,
  radius = 4300,
): Sample {
  const scale = featureFrequency(kind, radius)
  const continents = fbm(x * 1.45 * scale + 8, y * 1.45 * scale, z * 1.45 * scale - 3, seed, 6)
  const detail = fbm(x * 8.5 * scale, y * 8.5 * scale, z * 8.5 * scale, seed + 37, 4)
  const fine = fbm(x * 28 * scale, y * 28 * scale, z * 28 * scale, seed + 73, 3)
  const polar = Math.abs(y)

  if (kind === 'earth') {
    const landMask = continents + detail * 0.24
    // Polar ice caps.
    if (polar > 0.84) return { color: _a.setRGB(0.88, 0.93, 0.96).clone(), height: 0.18 + fine * 0.03 }
    // Oceans — deeper water reads darker/bluer.
    if (landMask < -0.08) {
      const depth = THREE.MathUtils.clamp((-landMask - 0.08) * 2.5, 0, 1)
      return { color: mixColor(_a.setRGB(0.04, 0.16, 0.34), _b.setRGB(0.08, 0.34, 0.55), 1 - depth).clone(), height: -0.18 - depth * 0.08 }
    }
    // Coastal sand.
    if (landMask < 0.02) return { color: _a.setRGB(0.72, 0.62, 0.38).clone(), height: 0.02 }

    // --- Land: biome colour (moisture × latitude × elevation) + carved rivers ---
    const mountain = ridged(detail + fine * 0.35)
    const elevation = 0.06 + mountain * 0.34
    // Wetter toward continental lows, drier on highs; fine noise breaks biomes into patches.
    const moisture = THREE.MathUtils.clamp(0.5 - continents * 0.45 + fine * 0.18, 0, 1)
    // Colder toward the poles → boreal/tundra tints and lower snowline.
    const cold = THREE.MathUtils.clamp((polar - 0.5) * 2.2, 0, 1)

    // Desert → grassland → forest by moisture (in-place lerp chain; _b is the moving target).
    const land = _a.setRGB(0.78, 0.69, 0.45)
    land.lerp(_b.setRGB(0.45, 0.54, 0.26), THREE.MathUtils.smoothstep(moisture, 0.22, 0.5))
    land.lerp(_b.setRGB(0.12, 0.34, 0.15), THREE.MathUtils.smoothstep(moisture, 0.5, 0.82))
    // High latitudes drift to muted boreal green-grey.
    land.lerp(_b.setRGB(0.42, 0.47, 0.40), cold * 0.55)
    // Exposed rock on steep highlands, then snow on the highest/coldest peaks.
    land.lerp(_b.setRGB(0.52, 0.50, 0.47), THREE.MathUtils.smoothstep(mountain, 0.64, 0.82))
    land.lerp(_b.setRGB(0.93, 0.94, 0.96), THREE.MathUtils.clamp((mountain - 0.84) * 4 + cold * mountain * 0.5, 0, 1))

    // Rivers: ridged-noise channels, strongest on wet lowlands, drawn as dark water and slightly carved.
    const riverline = ridged(fbm(x * 3.6 * scale + 20, y * 3.6 * scale - 9, z * 3.6 * scale + 5, seed + 131, 5))
    const river = Math.pow(Math.max(0, riverline), 9) * (1 - THREE.MathUtils.clamp(mountain, 0, 1)) * moisture
    land.lerp(_b.setRGB(0.09, 0.27, 0.40), THREE.MathUtils.clamp(river * 3, 0, 0.9))

    return { color: land.clone(), height: elevation - river * 0.04 }
  }

  if (kind === 'mars') {
    const craters = craterField(x, y, z, buildCraters(seed + 901, craterCount(20, radius), craterAngularScale(radius)))
    // Canyons: sharp ridged channels (Valles-Marineris-like), carved deep and shadowed.
    const canyon = Math.pow(ridged(fbm(x * 2.3 * scale - 4, y * 2.3 * scale, z * 2.3 * scale, seed + 11, 4)), 6)
    // Wind-carved dune streaks (stretched along longitude).
    const dunes = fbm(x * 26 * scale, y * 7 * scale, z * 26 * scale, seed + 53, 3)
    // Broad terrain → oxidation: dark basaltic lows, rusty mid, bright dust highlands.
    const oxide = THREE.MathUtils.clamp((continents + 0.2) * 0.7 + 0.5, 0, 1)
    const rust = _a.setRGB(0.30, 0.14, 0.09) // dark basalt
    rust.lerp(_b.setRGB(0.62, 0.30, 0.16), THREE.MathUtils.smoothstep(oxide, 0.2, 0.55)) // iron oxide
    rust.lerp(_b.setRGB(0.82, 0.52, 0.32), THREE.MathUtils.smoothstep(oxide, 0.55, 0.9)) // bright dust plains
    rust.lerp(_b.setRGB(0.88, 0.62, 0.40), Math.max(0, dunes) * 0.18) // dune banding
    rust.lerp(_b.setRGB(0.13, 0.07, 0.05), canyon * 0.8) // canyon shadow
    rust.lerp(_b.setRGB(0.88, 0.86, 0.82), THREE.MathUtils.smoothstep(polar, 0.82, 0.92)) // soft polar frost
    return { color: rust.clone(), height: continents * 0.2 + detail * 0.11 + craters * 0.26 - canyon * 0.3 }
  }

  if (kind === 'rocky' || kind === 'moon') {
    const isMoon = kind === 'moon'
    const craters = craterField(x, y, z, buildCraters(
      seed + 1201,
      craterCount(isMoon ? 38 : 30, radius),
      craterAngularScale(radius) * (isMoon ? 1.15 : 0.9),
    ))
    // Scarps/ridges + broad elevation for dark lows ↔ bright highlands.
    const scarp = Math.pow(ridged(fbm(x * 4 * scale, y * 4 * scale, z * 4 * scale, seed + 211, 4)), 4)
    const elev = THREE.MathUtils.clamp((continents + detail * 0.5) * 0.5 + 0.5, 0, 1)
    let gray: THREE.Color
    if (isMoon) {
      gray = _a.setRGB(0.15, 0.15, 0.16) // dark basaltic maria in the lows
      gray.lerp(_b.setRGB(0.64, 0.63, 0.60), THREE.MathUtils.smoothstep(elev, 0.34, 0.74)) // bright anorthosite highlands
    } else {
      gray = _a.set(baseColor).multiplyScalar(0.5) // shadowed base hue
      gray.lerp(_b.set(baseColor).multiplyScalar(1.35), THREE.MathUtils.smoothstep(elev, 0.3, 0.8)) // sunlit highlands
    }
    gray.lerp(_b.setRGB(0.72, 0.70, 0.66), Math.max(0, fine) * 0.12) // fine regolith mottling
    gray.lerp(_b.setRGB(0.90, 0.87, 0.80), Math.max(0, craters) * 0.42) // bright crater rims / ejecta
    gray.lerp(_b.setRGB(0.08, 0.08, 0.09), scarp * 0.28) // scarp shadows
    return { color: gray.clone(), height: continents * 0.22 + detail * 0.12 + craters * 0.36 + scarp * 0.07 }
  }

  if (kind === 'ice') {
    const cracks = Math.pow(ridged(fbm(x * 7.5 * scale, y * 7.5 * scale, z * 7.5 * scale, seed + 211, 4)), 7)
    const ice = mixColor(_a.setRGB(0.65, 0.78, 0.85), _b.setRGB(0.93, 0.96, 0.96), (continents + 1) * 0.5)
    ice.lerp(_b.setRGB(0.18, 0.34, 0.45), cracks * 0.7)
    return { color: ice.clone(), height: continents * 0.08 - cracks * 0.1 }
  }

  if (kind === 'venus') {
    // Thick sulphuric cloud deck: soft latitude banding + swirling vortices + pale wisps.
    const bands = Math.sin(y * 9 * scale + fbm(x * 3 * scale, y * 3 * scale, z * 3 * scale, seed + 311, 4) * 2.0) * 0.5 + 0.5
    const swirl = fbm(x * 5 * scale + y * 2, y * 5 * scale, z * 5 * scale - x * 2, seed + 317, 6)
    const wisp = fbm(x * 16 * scale, y * 16 * scale, z * 16 * scale, seed + 331, 4)
    const clouds = _a.setRGB(0.78, 0.60, 0.30) // amber base
    clouds.lerp(_b.setRGB(0.96, 0.86, 0.58), bands * 0.6) // bright cream bands
    clouds.lerp(_b.setRGB(0.60, 0.38, 0.17), Math.max(0, swirl) * 0.4) // darker swirl
    clouds.lerp(_b.setRGB(0.99, 0.93, 0.74), Math.max(0, wisp) * 0.18) // pale high wisps
    return { color: clouds.clone(), height: 0 }
  }

  // Banded gas giant: coarse + fine latitude belts warped by turbulence, plus a great-spot storm.
  const base = _a.set(baseColor)
  const warp = fbm(x * 5 * scale, y * 5 * scale, z * 5 * scale, seed + 419, 4) * 2.2
  const bands = Math.sin(y * 22 * scale + warp) * 0.5 + 0.5
  const fineBands = Math.sin(y * 54 * scale + warp * 1.3) * 0.5 + 0.5
  const turbulence = fbm(x * 11 * scale + y * 5, y * 11 * scale, z * 11 * scale - y * 6, seed + 433, 5)
  const storm = Math.exp(-Math.pow((x - 0.32) * 10, 2) - Math.pow((y + 0.18) * 16, 2) - Math.pow((z - 0.45) * 10, 2))
  const gas = base.clone().multiplyScalar(0.7)
  gas.lerp(_b.setRGB(0.92, 0.82, 0.60), bands * 0.7) // bright belts
  gas.lerp(_b.setRGB(0.55, 0.38, 0.24), (1 - fineBands) * 0.25) // dark fine belts
  gas.lerp(_b.setRGB(0.45, 0.28, 0.18), Math.max(0, turbulence) * 0.22) // turbulent mixing
  gas.lerp(_b.setRGB(0.88, 0.46, 0.26), storm * 0.85) // great red spot
  return { color: gas.clone(), height: 0 }
}

function makeTexture(canvas: HTMLCanvasElement, isColor: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export function generatePlanetTextures(
  kind: PlanetTextureKind,
  seed: number,
  baseColor: number,
  size = 512,
  radius = 4300,
): PlanetTextureSet {
  const width = size
  const height = Math.max(2, Math.floor(size / 2))
  const scaleKey = Math.round(radius)
  const key = `${kind}:${seed}:${baseColor}:${scaleKey}:${width}x${height}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = width
  colorCanvas.height = height
  const colorCtx = colorCanvas.getContext('2d')!
  const colorData = colorCtx.createImageData(width, height)

  const bumpCanvas = document.createElement('canvas')
  bumpCanvas.width = width
  bumpCanvas.height = height
  const bumpCtx = bumpCanvas.getContext('2d')!
  const bumpData = bumpCtx.createImageData(width, height)

  for (let py = 0; py < height; py++) {
    const v = py / (height - 1)
    const lat = Math.PI * (0.5 - v)
    const cy = Math.sin(lat)
    const r = Math.cos(lat)
    for (let px = 0; px < width; px++) {
      const u = px / width
      const lon = u * Math.PI * 2
      const x = Math.cos(lon) * r
      const z = Math.sin(lon) * r
      const sample = samplePlanetSurface(kind, seed, x, cy, z, baseColor, radius)
      const i = (py * width + px) * 4
      colorData.data[i] = Math.round(THREE.MathUtils.clamp(sample.color.r, 0, 1) * 255)
      colorData.data[i + 1] = Math.round(THREE.MathUtils.clamp(sample.color.g, 0, 1) * 255)
      colorData.data[i + 2] = Math.round(THREE.MathUtils.clamp(sample.color.b, 0, 1) * 255)
      colorData.data[i + 3] = 255
      const h = Math.round(THREE.MathUtils.clamp(sample.height * 0.9 + 0.5, 0, 1) * 255)
      bumpData.data[i] = h
      bumpData.data[i + 1] = h
      bumpData.data[i + 2] = h
      bumpData.data[i + 3] = 255
    }
  }

  colorCtx.putImageData(colorData, 0, 0)
  bumpCtx.putImageData(bumpData, 0, 0)

  const set: PlanetTextureSet = {
    colorMap: makeTexture(colorCanvas, true),
    bumpMap: kind === 'gas' || kind === 'venus' ? undefined : makeTexture(bumpCanvas, false),
  }
  textureCache.set(key, set)
  return set
}

export function generateCloudTexture(kind: PlanetTextureKind, seed: number, size = 512, radius = 4300): THREE.CanvasTexture | null {
  if (kind !== 'earth') return null
  const width = size
  const height = Math.max(2, Math.floor(size / 2))
  const scale = featureFrequency(kind, radius)
  const key = `${kind}:clouds:${seed}:${Math.round(radius)}:${width}x${height}`
  const cached = cloudCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(width, height)

  for (let py = 0; py < height; py++) {
    const v = py / (height - 1)
    const lat = Math.PI * (0.5 - v)
    const y = Math.sin(lat)
    const r = Math.cos(lat)
    for (let px = 0; px < width; px++) {
      const u = px / width
      const lon = u * Math.PI * 2
      const x = Math.cos(lon) * r
      const z = Math.sin(lon) * r
      const broad = fbm(x * 3.4 * scale + 12, y * 3.4 * scale, z * 3.4 * scale - 7, seed + 501, 5)
      const wisps = fbm(x * 17 * scale + y * 4, y * 17 * scale, z * 17 * scale - x * 4, seed + 557, 4)
      const bands = Math.pow(1 - Math.abs(y), 0.45)
      const cover = THREE.MathUtils.smoothstep(broad + wisps * 0.34 + bands * 0.16, 0.18, 0.58)
      const alpha = Math.round(THREE.MathUtils.clamp(cover * 0.72, 0, 0.72) * 255)
      const i = (py * width + px) * 4
      data.data[i] = 245
      data.data[i + 1] = 250
      data.data[i + 2] = 255
      data.data[i + 3] = alpha
    }
  }

  ctx.putImageData(data, 0, 0)
  const tex = makeTexture(canvas, true)
  cloudCache.set(key, tex)
  return tex
}
