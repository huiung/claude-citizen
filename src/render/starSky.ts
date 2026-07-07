import * as THREE from 'three'

/** Shared galactic-plane normal — the starfield density and the nebula's bright band
 *  align to the same tilted great circle, so the sky reads as one structure. */
export const MILKY_WAY_NORMAL = new THREE.Vector3(0.18, 0.94, 0.28).normalize()

// Deterministic PRNG — duplicated from world.ts (private there; importing world here
// would create a cycle since world's buildStarfield delegates to this module).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface StarColor { r: number; g: number; b: number }

/** Approximate blackbody tint: t=0 cool orange (~3000K) → ~0.55 near-white → t=1 blue-white (~10000K). */
export function starTemperatureColor(t: number): StarColor {
  const x = Math.min(1, Math.max(0, t))
  const lerp = (a: number, b: number, s: number) => a + (b - a) * s
  const warm: StarColor = { r: 1.0, g: 0.62, b: 0.42 }
  const white: StarColor = { r: 1.0, g: 0.97, b: 0.92 }
  const blue: StarColor = { r: 0.66, g: 0.78, b: 1.0 }
  if (x < 0.55) {
    const s = x / 0.55
    return { r: lerp(warm.r, white.r, s), g: lerp(warm.g, white.g, s), b: lerp(warm.b, white.b, s) }
  }
  const s = (x - 0.55) / 0.45
  return { r: lerp(white.r, blue.r, s), g: lerp(white.g, blue.g, s), b: lerp(white.b, blue.b, s) }
}

export interface StarAttributes {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
}

/** Star attribute generation, pure and deterministic. ~55% of stars scatter along the
 *  galactic plane with a gaussian-ish falloff; sizes/brightness follow a power law
 *  (many faint, few bright); tint follows the blackbody ramp. */
export function computeStarAttributes(count = 18000, seed = 42): StarAttributes {
  const rand = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)

  // Orthonormal basis of the galactic plane.
  const n = MILKY_WAY_NORMAL
  const u = new THREE.Vector3(1, 0, 0).cross(n).normalize()
  const v = n.clone().cross(u).normalize()
  const dir = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    if (rand() < 0.55) {
      // In-band: point on the plane circle + gaussian-ish offset along the normal.
      const ang = rand() * Math.PI * 2
      const off = (rand() + rand() + rand() - 1.5) * 0.21 // ~gaussian (Irwin-Hall of 3), sigma≈0.105
      dir.copy(u).multiplyScalar(Math.cos(ang))
        .addScaledVector(v, Math.sin(ang))
        .addScaledVector(n, off)
        .normalize()
    } else {
      // Field star: uniform on the sphere.
      const theta = rand() * Math.PI * 2
      const z = rand() * 2 - 1
      const s = Math.sqrt(1 - z * z)
      dir.set(s * Math.cos(theta), s * Math.sin(theta), z)
    }
    const r = 18000 + rand() * 4000
    positions[i * 3] = dir.x * r
    positions[i * 3 + 1] = dir.y * r
    positions[i * 3 + 2] = dir.z * r

    const m = rand() // magnitude driver — most stars faint, a handful bright
    sizes[i] = 7 + Math.pow(m, 6.0) * 90
    const brightness = 0.45 + Math.pow(m, 3.0) * 0.55
    const tint = starTemperatureColor(rand())
    colors[i * 3] = tint.r * brightness
    colors[i * 3 + 1] = tint.g * brightness
    colors[i * 3 + 2] = tint.b * brightness
  }
  return { positions, colors, sizes }
}

/** The whole night sky as ONE Points draw call. A custom shader gives each star its own
 *  point size (PointsMaterial only supports a uniform size); brightness is folded into
 *  the vertex color, which additive blending turns into per-star luminosity. */
export function buildStarSky(count = 18000, seed = 42): THREE.Points {
  const attrs = computeStarAttributes(count, seed)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(attrs.positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(attrs.colors, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(attrs.sizes, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true, // injects the `color` attribute declaration into the shader
    uniforms: { uScale: { value: 900 } }, // fallback only — replaced via setStarSkyScale on init/resize
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uScale;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 8.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main(){
        float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5)); // soft round sprite
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  })
  return new THREE.Points(geo, mat)
}

/** Match the old PointsMaterial attenuation: point scale is half the DRAWING BUFFER height
 *  (physical pixels, so devicePixelRatio is included). Call on init and on every resize. */
export function setStarSkyScale(sky: THREE.Points, drawingBufferHeight: number): void {
  const mat = sky.material as THREE.ShaderMaterial
  mat.uniforms.uScale.value = drawingBufferHeight * 0.5
}
