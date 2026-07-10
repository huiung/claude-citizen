// Descent immersion helpers — pure math driven per frame from updateAtmoSky in main.
// All thresholds are tuned for the playable planet scale (Earth R = 4300).

/** The atmosphere hides distant celestial bodies (planets, backdrop worlds, galaxy
 *  bodies) on two axes, each with hysteresis so hovering at one altitude can't flicker
 *  the toggle: day washout (fade 0.35/0.25) — blue sky swallows everything — and
 *  atmosphere depth (altFrac 0.5/0.4) — real night-sky planets are point lights, but
 *  ours sit game-scale close and would loom as huge flat discs over the night ground. */
export function computeCelestialHide(fade: number, altFrac: number, wasHidden: boolean): boolean {
  if (fade > 0.35 || altFrac > 0.5) return true
  if (fade < 0.25 && altFrac < 0.4) return false
  return wasHidden
}

/** Aerial-perspective fog for THREE.Fog. Density follows only the depth into the
 *  atmosphere shell (haze exists at night too); the sun's elevation drives the color
 *  between night ink and day horizon-blue, mirroring the sky shader's smoothstep. */
export function computeAtmoFog(altFrac: number, sunUp: number): { near: number; far: number; color: [number, number, number] } | null {
  if (altFrac <= 0) return null
  const depth = Math.pow(Math.min(1, altFrac), 1.2)
  const near = 6000 - depth * 5300 // → 700 at the surface
  const far = 26000 - depth * 17500 // → 8500 at the surface
  const t = Math.min(1, Math.max(0, (sunUp + 0.12) / 0.3))
  const day = t * t * (3 - 2 * t)
  // Components derived from night 0x0a0f1c → day horizon 0xbcd6ee, but fed to
  // Color.setRGB as LINEAR working-space values — on screen the fog renders about a
  // gamma step brighter than those hexes. Tuned and verified as-is; don't "fix" the
  // color space without re-judging captures.
  const color: [number, number, number] = [
    0.039 + (0.737 - 0.039) * day,
    0.059 + (0.839 - 0.059) * day,
    0.110 + (0.933 - 0.110) * day,
  ]
  return { near, far, color }
}

/** Altitude of the cloud shell above the sphere surface (world.ts uses radius * 1.018). */
export const CLOUD_SHELL_ALT_FRAC = 0.018
/** Half-width of the crossing band where the wisp effect acts (world units of altitude). */
const CLOUD_BAND = 90

/** 0..1 fog boost while crossing the cloud layer, scaled by the actual cloud cover at
 *  the ship's position — clear sky passes clean, monsoon overcast whites the screen out.
 *  `radius` is the planet radius (the shell sits at radius * (1 + CLOUD_SHELL_ALT_FRAC)). */
export function computeCloudFogBoost(alt: number, cover: number, radius: number): number {
  const d = (alt - radius * CLOUD_SHELL_ALT_FRAC) / CLOUD_BAND
  return Math.exp(-d * d * 3) * Math.min(1, Math.max(0, cover))
}

/** onBeforeCompile patch for the real-Earth surface material: up close the color map
 *  has run out of texels and the ground goes airbrush-smooth, so two blocky hash-noise
 *  frequencies (field-sized ~19u cells and district-sized ~104u patches at R=4300)
 *  modulate the albedo. Fades over slant distance — at ~1000u altitude even the nearest
 *  bare ground sits 1-3ku away, so the fade must reach well past the horizon arc
 *  (~2900u) to register; gone by 6000u so orbit views render exactly as before.
 *  smoothstep runs low-to-high edges only: the reversed-edge form is undefined in GLSL
 *  and ANGLE/Metal actually returns 0 for it. */
export function patchEarthGroundDetail(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    /* glsl */ `#include <map_fragment>
    {
      float gdDist = length(vViewPosition);
      float gdAmt = 1.0 - smoothstep(400.0, 6000.0, gdDist);
      if (gdAmt > 0.0) {
        float gd1 = fract(sin(dot(floor(vMapUv * 1400.0), vec2(127.1, 311.7))) * 43758.5453);
        float gd2 = fract(sin(dot(floor(vMapUv * 260.0), vec2(269.5, 183.3))) * 43758.5453);
        diffuseColor.rgb *= 1.0 + ((gd1 - 0.5) * 0.26 + (gd2 - 0.5) * 0.14) * gdAmt;
      }
    }`,
  )
}
