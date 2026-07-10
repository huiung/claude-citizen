// Descent immersion helpers — pure math driven per frame from updateAtmoSky in main.
// All thresholds are tuned for the playable planet scale (Earth R = 4300).

/** Daylight air hides distant celestial bodies (planets, backdrop worlds, galaxy bodies).
 *  Hysteresis so the toggle can't flicker while hovering at one altitude: hide once the
 *  sky washout passes 0.35, show again only when it drops under 0.25. Night side keeps
 *  fade at 0 — planets stay visible in a night sky, as in life. */
export function computeCelestialHide(fade: number, wasHidden: boolean): boolean {
  if (fade > 0.35) return true
  if (fade < 0.25) return false
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
  // night 0x0a0f1c → day horizon 0xbcd6ee
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
 *  the ship's position — clear sky passes clean, monsoon overcast whites the screen out. */
export function computeCloudFogBoost(alt: number, cover: number): number {
  const d = (alt - 4300 * CLOUD_SHELL_ALT_FRAC) / CLOUD_BAND
  return Math.exp(-d * d * 3) * Math.min(1, Math.max(0, cover))
}
