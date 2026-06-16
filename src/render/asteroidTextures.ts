import * as THREE from 'three'

export interface AsteroidTextureSet {
  colorMap: THREE.CanvasTexture
  bumpMap: THREE.CanvasTexture
}

const cache = new Map<string, AsteroidTextureSet>()
const oreCache = new Map<string, THREE.CanvasTexture>()

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = fade(x - ix), fy = fade(y - iy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fy,
  ) * 2 - 1
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0
  let amp = 0.55
  let scale = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * scale, y * scale, seed + i * 719) * amp
    norm += amp
    amp *= 0.5
    scale *= 2.1
  }
  return sum / norm
}

function makeTexture(canvas: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  if (color) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export function generateAsteroidTextures(seed: number, baseColor = 0x6b6258, size = 256): AsteroidTextureSet {
  const key = `${seed}:${baseColor}:${size}`
  const cached = cache.get(key)
  if (cached) return cached

  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = size
  colorCanvas.height = size
  const bumpCanvas = document.createElement('canvas')
  bumpCanvas.width = size
  bumpCanvas.height = size

  const colorCtx = colorCanvas.getContext('2d')!
  const bumpCtx = bumpCanvas.getContext('2d')!
  const colorData = colorCtx.createImageData(size, size)
  const bumpData = bumpCtx.createImageData(size, size)
  const base = new THREE.Color(baseColor)
  const dark = base.clone().multiplyScalar(0.48)
  const light = base.clone().multiplyScalar(1.35)
  const rust = new THREE.Color(0x8a5b3c)
  const out = new THREE.Color()

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const broad = fbm(u * 5.2, v * 5.2, seed, 5)
      const grain = fbm(u * 32, v * 32, seed + 17, 4)
      const cracks = Math.pow(1 - Math.abs(fbm(u * 16 + broad, v * 16 - broad, seed + 53, 3)), 9)
      const strata = Math.sin((u * 2.2 + v * 8.5 + broad * 1.6) * Math.PI * 2) * 0.5 + 0.5
      out.copy(dark).lerp(light, THREE.MathUtils.clamp((broad + grain * 0.35 + 1) * 0.5, 0, 1))
      out.lerp(rust, Math.max(0, strata - 0.72) * 0.24)
      out.multiplyScalar(1 - cracks * 0.45)

      const i = (y * size + x) * 4
      colorData.data[i] = Math.round(THREE.MathUtils.clamp(out.r, 0, 1) * 255)
      colorData.data[i + 1] = Math.round(THREE.MathUtils.clamp(out.g, 0, 1) * 255)
      colorData.data[i + 2] = Math.round(THREE.MathUtils.clamp(out.b, 0, 1) * 255)
      colorData.data[i + 3] = 255

      const h = Math.round(THREE.MathUtils.clamp(0.52 + broad * 0.18 + grain * 0.18 - cracks * 0.3, 0, 1) * 255)
      bumpData.data[i] = h
      bumpData.data[i + 1] = h
      bumpData.data[i + 2] = h
      bumpData.data[i + 3] = 255
    }
  }

  colorCtx.putImageData(colorData, 0, 0)
  bumpCtx.putImageData(bumpData, 0, 0)

  const set = {
    colorMap: makeTexture(colorCanvas, true),
    bumpMap: makeTexture(bumpCanvas, false),
  }
  cache.set(key, set)
  return set
}

export function makeAsteroidMaterial(seed: number, baseColor = 0x6b6258, size = 256): THREE.MeshStandardMaterial {
  const maps = generateAsteroidTextures(seed, baseColor, size)
  return new THREE.MeshStandardMaterial({
    map: maps.colorMap,
    bumpMap: maps.bumpMap,
    bumpScale: 0.08,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  })
}

export function generateOreTexture(seed: number, color = 0x4fd0e0, size = 128): THREE.CanvasTexture {
  const key = `ore:${seed}:${color}:${size}`
  const cached = oreCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(size, size)
  const base = new THREE.Color(color)
  const hot = new THREE.Color(0xd9ffff)
  const deep = base.clone().multiplyScalar(0.35)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5
      const v = y / size - 0.5
      const dist = Math.sqrt(u * u + v * v)
      const vein = Math.pow(1 - Math.abs(fbm((u + 0.5) * 8, (v + 0.5) * 22, seed, 4)), 5)
      const core = Math.max(0, 1 - dist * 2.4)
      const sparkle = Math.max(0, noise((u + 0.5) * 38, (v + 0.5) * 38, seed + 83))
      const glow = THREE.MathUtils.clamp(core * 0.55 + vein * 0.65 + Math.pow(sparkle, 9) * 0.8, 0, 1)
      const out = deep.clone().lerp(base, glow).lerp(hot, Math.max(0, glow - 0.72) * 2.4)
      const i = (y * size + x) * 4
      data.data[i] = Math.round(THREE.MathUtils.clamp(out.r, 0, 1) * 255)
      data.data[i + 1] = Math.round(THREE.MathUtils.clamp(out.g, 0, 1) * 255)
      data.data[i + 2] = Math.round(THREE.MathUtils.clamp(out.b, 0, 1) * 255)
      data.data[i + 3] = 255
    }
  }

  ctx.putImageData(data, 0, 0)
  const tex = makeTexture(canvas, true)
  oreCache.set(key, tex)
  return tex
}

export function makeOreMaterial(seed: number, color = 0x4fd0e0): THREE.MeshStandardMaterial {
  const map = generateOreTexture(seed, color, 128)
  return new THREE.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: new THREE.Color(color),
    emissiveIntensity: 2.6,
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.05,
    flatShading: true,
  })
}
