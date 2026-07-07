// Generates public/textures/planets/{earth.jpg, mercury-normal.jpg, mars-normal.jpg}
// from public-domain NASA/USGS sources. One-shot asset tool: node scripts/generate-planet-normals.mjs
//
// Sources (all public domain, verified):
// - Earth albedo: Commons "Whole_world_-_land_and_oceans.jpg" (NASA Blue Marble 2002, cloudless)
// - Mercury heights: Commons "Mercury_Messenger_DEM_Global_665m_v2_max.png" (USGS true DEM, 8-bit gray)
// - Mars heights: NASA PDS MOLA MEGDR megt90n000eb.img (16-bit BE raw, 5760x2880, real elevations)
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

const UA = 'claude-citizen-asset-fetch/1.0 (+https://github.com/huiung/claude-citizen)'
const OUT = 'public/textures/planets'
const W = 2048, H = 1024
// Relief strength — height grids are normalized 0..1, so pixel-to-pixel slopes are tiny;
// these amplify them into visible (but not cartoonish) shading. Tuned by eye at verification.
const MERCURY_STRENGTH = 220
const MARS_STRENGTH = 180
// MEGDR longitude origin is 0°E while the Viking albedo mosaic is centered on 0° with a
// -180..180 domain — shift the height grid by half a revolution so craters line up with
// the albedo. If runtime verification shows features misaligned by half the map, flip this.
const MARS_LON_SHIFT = true

async function fetchBuffer(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) return Buffer.from(await res.arrayBuffer())
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); continue }
    throw new Error(`HTTP ${res.status}: ${url}`)
  }
  throw new Error(`rate-limited after retries: ${url}`)
}

const sips = (args) => execFileSync('sips', args, { stdio: 'pipe' })

/** Bilinear-resample a Float32 grid (sw×sh) to W×H. Longitude (x) wraps. */
function resample(src, sw, sh) {
  const dst = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = ((y + 0.5) / H) * sh - 0.5
    const y0 = Math.min(sh - 1, Math.max(0, Math.floor(sy)))
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = Math.min(1, Math.max(0, sy - y0))
    for (let x = 0; x < W; x++) {
      const sx = ((x + 0.5) / W) * sw - 0.5
      const xf = Math.floor(sx)
      const x0 = ((xf % sw) + sw) % sw
      const x1 = (x0 + 1) % sw
      const fx = sx - xf
      const a = src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx
      const b = src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx
      dst[y * W + x] = a * (1 - fy) + b * fy
    }
  }
  return dst
}

/** 3x3 box blur (x wraps, y clamps) — kills 8-bit quantization stair-steps before sobel. */
function blur(grid) {
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx++) s += grid[yy * W + ((x + dx + W) % W)]
      }
      out[y * W + x] = s / 9
    }
  }
  return out
}

/** Normalized height grid → tangent-space normal map PNG buffer (OpenGL green-up). */
function normalPng(grid, strength) {
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W
      const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1)
      const dx = (grid[y * W + xp] - grid[y * W + xm]) * strength
      // dy is +H_v (the image-row flip is baked in); the normal formula needs -H_v for green: n = normalize(-H_u, -H_v, 1)
      const dy = (grid[ym * W + x] - grid[yp * W + x]) * strength
      const inv = 1 / Math.hypot(dx, dy, 1)
      const i = (y * W + x) * 4
      png.data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      png.data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
      png.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      png.data[i + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

/** temp PNG → 2048×1024 jpg via sips. */
function pngToJpg(pngBuffer, outName, quality = 85) {
  const tmp = join(tmpdir(), `${outName}-${process.pid}.png`)
  writeFileSync(tmp, pngBuffer)
  sips(['-z', String(H), String(W), tmp, '--out', `${OUT}/${outName}.jpg`, '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)])
}

// --- Earth: albedo only (no normal — oceans dominate; procedural closeup keeps relief) ---
async function earth() {
  const buf = await fetchBuffer('https://commons.wikimedia.org/wiki/Special:FilePath/Whole%20world%20-%20land%20and%20oceans.jpg?width=2600')
  const tmp = join(tmpdir(), `earth-src-${process.pid}.jpg`)
  writeFileSync(tmp, buf)
  sips(['-z', String(H), String(W), tmp, '--out', `${OUT}/earth.jpg`, '-s', 'format', 'jpeg', '-s', 'formatOptions', '85'])
  console.log('earth.jpg written')
}

// --- Mercury: USGS DEM PNG (8-bit gray) → normal ---
async function mercury() {
  const buf = await fetchBuffer('https://commons.wikimedia.org/wiki/Special:FilePath/Mercury%20Messenger%20DEM%20Global%20665m%20v2%20max.png?width=2600')
  const png = PNG.sync.read(buf)
  const grid = new Float32Array(png.width * png.height)
  for (let i = 0; i < grid.length; i++) grid[i] = png.data[i * 4] / 255
  pngToJpg(normalPng(blur(resample(grid, png.width, png.height)), MERCURY_STRENGTH), 'mercury-normal')
  console.log('mercury-normal.jpg written')
}

// --- Mars: PDS MEGDR raw Int16BE 5760×2880 → normal ---
async function mars() {
  const buf = await fetchBuffer('https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img')
  const sw = 5760, sh = 2880
  if (buf.length !== sw * sh * 2) throw new Error(`unexpected MEGDR size: ${buf.length}`)
  let min = Infinity, max = -Infinity
  const raw = new Float32Array(sw * sh)
  for (let i = 0; i < sw * sh; i++) {
    const v = buf.readInt16BE(i * 2)
    raw[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  const shifted = new Float32Array(sw * sh)
  const half = MARS_LON_SHIFT ? sw / 2 : 0
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) shifted[y * sw + x] = (raw[y * sw + ((x + half) % sw)] - min) / (max - min)
  }
  pngToJpg(normalPng(blur(resample(shifted, sw, sh)), MARS_STRENGTH), 'mars-normal')
  console.log(`mars-normal.jpg written (heights ${min}..${max} m)`)
}

await earth()
await mercury()
await mars()
