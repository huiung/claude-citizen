import * as THREE from 'three'

/** Radial brightness/alpha profile for a banded ring system: layered sines make irregular
 *  bright bands, two hard gaps read as Cassini-like divisions, and both edges fade out.
 *  Pure — one RGBA row, so it unit-tests without a canvas. */
export function computeRingBands(width = 512, seed = 7): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(width * 4)
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1)
    const bands =
      0.55 +
      0.25 * Math.sin(t * 43 + seed) +
      0.15 * Math.sin(t * 91 + seed * 2.3) +
      0.05 * Math.sin(t * 211 + seed * 4.1)
    const gap = (center: number, halfWidth: number) => Math.min(1, Math.abs(t - center) / halfWidth)
    const edges = Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.1)
    const alpha = Math.max(0, Math.min(1, bands)) * gap(0.62, 0.025) * gap(0.35, 0.012) * edges
    const warm = 200 + Math.floor(30 * Math.sin(t * 17 + seed))
    data[i * 4 + 0] = warm
    data[i * 4 + 1] = warm - 25
    data[i * 4 + 2] = warm - 70
    data[i * 4 + 3] = Math.floor(alpha * 255)
  }
  return data
}

/** Wraps the band row in a 1-pixel-tall sRGB DataTexture. Linear filtering is set explicitly:
 *  DataTexture defaults to NearestFilter, which reads as blocky concentric steps once the
 *  512-wide strip is magnified across a planet-scale ring. */
export function createRingTexture(width = 512, seed = 7): THREE.DataTexture {
  const texture = new THREE.DataTexture(computeRingBands(width, seed), width, 1, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** RingGeometry ships planar UVs; rewrite them so u runs inner→outer radius, letting the
 *  1-pixel-tall band texture wrap the annulus radially.
 *  Caller must pass innerRadius < outerRadius (equal radii would divide by zero). */
export function remapRingUVs(geometry: THREE.RingGeometry, innerRadius: number, outerRadius: number): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i))
    uv.setXY(i, (r - innerRadius) / (outerRadius - innerRadius), 0.5)
  }
  uv.needsUpdate = true
}
