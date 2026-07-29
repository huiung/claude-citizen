import * as THREE from 'three'

/** Ground-bounce fill for hull materials.
 *
 *  The problem: on a daylit pad the hull's underside renders black. The scene has exactly one
 *  directional source (the sun PointLight, no falloff) plus `AmbientLight(0x223344, 0.85)`, and
 *  nothing lights a surface from below. Real daylight does — half the light on the underside of a
 *  parked aircraft is sunlight bounced off the apron.
 *
 *  The ambient is not the fallback it looks like. Measured on a `?earthview=seoul-foot` capture, the
 *  hull's downward faces read #000103 — the ambient contributes about 1/255, not a readable shadow
 *  side. Two factors compound: `RE_IndirectDiffuse` multiplies irradiance by `BRDF_Lambert`, which
 *  divides by PI, and ACES tone mapping at exposure 1.15 then crushes what is left. So the doc
 *  comment on `buildLights` ("Ambient keeps shadow sides readable") does not hold at these numbers.
 *
 *  Why this is not a light. Adding a light to a three.js scene extends the per-fragment light loop
 *  for EVERY lit material — planets, stations, asteroids — and cannot be scoped to the ship by
 *  placement. Raising the scene ambient instead is a different regression: ambient is direction-free,
 *  so it would lift a planet's genuine night side and wash out the terminator and the night-city
 *  lights, which is exactly what a second fixed light here did once before. Both were rejected on
 *  those grounds, not on appearance.
 *
 *  What this does instead: injects one hemispheric irradiance term into the hull materials' own
 *  fragment shader, at `lights_fragment_maps`, so it joins the same `irradiance` accumulator the
 *  ambient uses and goes through the same BRDF. Nothing outside hull materials is touched, the light
 *  loop does not grow, and the term is gated by a uniform driven from altitude and local sun
 *  elevation — so it is zero in space and zero on a night side without any state plumbing.
 *
 *  The uniform is present from the moment the hull loads and only its VALUE changes, which is what
 *  keeps the disembark frame free of a hitch: changing the number of lights, or adding a #define,
 *  invalidates three.js's program cache and forces every affected material to recompile. Holding the
 *  cost is one uniform branch plus ~10 ALU on hull fragments, skipped entirely when the fill is off.
 */

/** Colour of the bounce, as sRGB. Sunlight (0xfff0be) off pad concrete (0x9aa2ab) and the tan land
 *  around a real-Earth city — so a desaturated warm grey rather than a neutral one. A cool fill here
 *  reads as moonlight and fights the sunlit side of the same hull. */
const GROUND_FILL_COLOR = 0xb0a48f

/** Irradiance multiplier at full strength.
 *
 *  Measured on `?earthview=seoul-foot`, not derived. Sampled at the same hull pixels across three
 *  captures, the hauler's belly reads #000103 with no fill, #1e2323 at 1.0 and #3c4240 at 2.2, while
 *  the sunlit crown moves only #6c → #74. Against that crown (linear 0.196) the belly at 2.2 sits at
 *  linear 0.051, i.e. 26% of the sunlit value — the generous end of the 1:4 to 1:10 shadow-to-sun
 *  range daylight photography works in, which is the right end here because the surface underneath is
 *  bright concrete a few metres away.
 *
 *  Why the number is larger than a first-principles estimate suggests: this feeds `irradiance`, which
 *  `RE_IndirectDiffuse` multiplies by `BRDF_Lambert` (so ÷PI) and by `diffuseColor`, which
 *  `MeshStandardMaterial` has already scaled by (1 - metalness). Hulls are capped at metalness 0.4,
 *  so 60% of the term survives. PI × 1/0.6 is most of the factor of 5 between this and the naive
 *  "irradiance ≈ target luminance" reading.
 *
 *  Pushing further starts to read as a second sun from below — the giveaway is the underside going
 *  BRIGHTER than the shadowed vertical flanks it joins, which no real bounce does. */
const GROUND_FILL_INTENSITY = 2.2

/** Altitude band (world units ≈ metres) over which the bounce fades out.
 *
 *  Ground bounce is a near-field effect: it is the surface directly below acting as a light source,
 *  so it falls off as that surface subtends less of the sky. Full strength up to roughly a hull
 *  length above the deck, gone by the altitude at which a city is a texture rather than a place. */
const GROUND_FILL_ALT_FULL = 40
const GROUND_FILL_ALT_NONE = 900

/** Sun elevation (dot of the sun direction with local up) over which the bounce fades in. Below the
 *  horizon there is no sunlight to bounce; the band matches the sky dome's own day gate
 *  (`smoothstep(-0.12, 0.18, sunUp)`) so the fill and the sky agree on where dusk is. */
const GROUND_FILL_SUN_LOW = -0.12
const GROUND_FILL_SUN_HIGH = 0.18

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 0..1 strength of the ground bounce, from altitude above the surface and the sun's elevation at
 *  the observer. Pure so the two gates that keep this out of space and off the night side are
 *  testable without a GPU — they are the whole reason this is allowed to exist. */
export function groundFillStrength(altitude: number, sunUp: number): number {
  const near = 1 - smoothstep(GROUND_FILL_ALT_FULL, GROUND_FILL_ALT_NONE, Math.max(0, altitude))
  return near * smoothstep(GROUND_FILL_SUN_LOW, GROUND_FILL_SUN_HIGH, sunUp)
}

/** Shared uniforms — one object, referenced by every patched hull material, so driving the fill is
 *  one write per frame rather than a traversal. `uGroundFill` carries colour AND strength together:
 *  a separate scalar would be a second uniform to keep in step for no benefit. */
const uniforms = {
  uGroundFill: { value: new THREE.Color(0, 0, 0) },
  /** World-space up at the ship. World rather than view space so this does not depend on the camera
   *  matrix being current at the moment it is written. */
  uGroundFillUp: { value: new THREE.Vector3(0, 1, 0) },
}

const _fillColor = new THREE.Color(GROUND_FILL_COLOR)

/** Drive the fill. `up` is the outward radial at the ship; `strength` comes from
 *  `groundFillStrength`. Called once per frame; a strength of 0 leaves the shader's branch untaken. */
export function updateGroundFill(up: THREE.Vector3, strength: number): void {
  uniforms.uGroundFill.value.copy(_fillColor).multiplyScalar(GROUND_FILL_INTENSITY * Math.max(0, strength))
  uniforms.uGroundFillUp.value.copy(up)
}

/** The injected GLSL. Split out so a test can assert it landed in the compiled shader — a three.js
 *  upgrade that renames `lights_fragment_maps` or `geometryNormal` would otherwise turn this into a
 *  silent no-op, which looks exactly like the bug it fixes.
 *
 *  `inverseTransformDirection` is a three.js builtin from the `common` chunk (present in every
 *  material), and rotates the view-space shading normal back to world space. The hemisphere weight
 *  is the HemisphereLight one: 1 for a surface facing straight down, 0.5 edge-on, 0 facing the sky. */
export const GROUND_FILL_GLSL = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  // Uniform branch — coherent across the whole draw, so this costs nothing while the fill is off.
  if ( uGroundFill.r + uGroundFill.g + uGroundFill.b > 0.0 ) {
    vec3 gfWorldNormal = inverseTransformDirection( geometryNormal, viewMatrix );
    float gfWeight = 0.5 - 0.5 * dot( gfWorldNormal, uGroundFillUp );
    irradiance += uGroundFill * gfWeight;
  }
#endif
`

/** onBeforeCompile for hull materials. One shared function reference on purpose: three.js's default
 *  `customProgramCacheKey` is `onBeforeCompile.toString()`, so every hull material patched by this
 *  keeps sharing one compiled program instead of getting one each. */
function patchGroundFill(shader: { fragmentShader: string; uniforms: Record<string, unknown> }): void {
  shader.uniforms.uGroundFill = uniforms.uGroundFill
  shader.uniforms.uGroundFillUp = uniforms.uGroundFillUp
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `uniform vec3 uGroundFill;
uniform vec3 uGroundFillUp;
void main() {`,
    )
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${GROUND_FILL_GLSL}`)
}

/** Attach the fill to one material. Called from `tuneHullMaterialsForNoEnvironment`'s traverse rather
 *  than doing its own: that loop already walks every hull material exactly once, already dedupes
 *  shared materials, and already owns the rule for which surfaces are their own light source and must
 *  be left alone. A second traverse here would be a second copy of all three.
 *
 *  Idempotent, so re-tuning a cached model cannot stack patches. */
export function attachGroundFillToMaterial(mat: THREE.Material): void {
  if (mat.onBeforeCompile === patchGroundFill) return
  mat.onBeforeCompile = patchGroundFill
  mat.needsUpdate = true
}

export const GROUND_FILL_INTERNALS = {
  GROUND_FILL_COLOR, GROUND_FILL_INTENSITY, GROUND_FILL_ALT_FULL, GROUND_FILL_ALT_NONE, patchGroundFill, uniforms,
}
