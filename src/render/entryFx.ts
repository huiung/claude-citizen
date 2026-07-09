import * as THREE from 'three'

/** Re-entry heat, 0..1 — the single driver for plasma, vignette, shake, and rumble.
 *  Zero unless the ship is BOTH deep enough in the atmosphere, fast (>35% of max),
 *  and actually descending: cruising or climbing never triggers the event.
 *  Roughly heat ∝ density · descent^0.7 · speed^1.8 (curves tuned visually). */
export function computeEntryHeat(density: number, speedFrac: number, descentDot: number): number {
  const d = Math.min(1, Math.max(0, density))
  const dive = Math.pow(Math.min(1, Math.max(0, descentDot)), 0.7)
  const speed = Math.pow(Math.min(1, Math.max(0, (speedFrac - 0.35) / 0.65)), 1.8)
  return Math.min(1, d * dive * speed)
}

/** Plasma stays hidden below this heat so the shell costs zero draw calls in cruise. */
export const PLASMA_COLD_THRESHOLD = 0.01

export interface EntryPlasma {
  mesh: THREE.Mesh
  /** Drive the shell: heat 0..1 (clamped), sheath color, and a seconds clock for flicker. */
  update(heat: number, color: number, timeSec: number): void
  dispose(): void
}

/** Additive plasma sheath around the hull: Fresnel rim, brightest at the bow (local -Z —
 *  the caller adds the mesh to the scene, copies the hull position each frame, and points
 *  it down the velocity vector), streaking off toward the tail with a cheap hash flicker.
 *  Color comes from the owning planet's sunset tint (Earth orange, Mars blue, Venus amber). */
export function buildEntryPlasma(): EntryPlasma {
  const geo = new THREE.SphereGeometry(1, 24, 16)
  // Sheath hugs the hull (crafts are ~4 units long) and trails aft — small enough that
  // the chase camera (~6 units out) stays OUTSIDE it; from inside it reads as a screen
  // wash instead of a rim-lit shell.
  geo.scale(4.2, 3.0, 6.5)
  geo.translate(0, 0, 1.2) // bow tight to the nose, tail streaming behind
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, // the camera sits inside the sheath in chase view
    uniforms: {
      uHeat: { value: 0 },
      uColor: { value: new THREE.Color(0xff9a55) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vView;
      varying vec3 vLocal;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vLocal = normalize(position);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vView;
      varying vec3 vLocal;
      uniform float uHeat;
      uniform vec3 uColor;
      uniform float uTime;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      // The renderer runs a logarithmic depth buffer — without this chunk every fragment
      // over terrain silently fails the depth test (drawn, but invisible).
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        // Rim-bright with a translucent body fill — during a dive the camera looks down
        // the shell's long axis, so a rim-only ring hides behind the hull silhouette.
        float rim = 0.22 + 0.78 * pow(1.0 - abs(dot(normalize(vNormalV), normalize(vView))), 1.2);
        // Bow (local -Z) glows solid; the tail thins into streaks.
        float bow = clamp(-vLocal.z * 0.5 + 0.5, 0.0, 1.0);
        float body = mix(0.4, 1.0, bow * bow);
        // Streaky flicker: bands along the flight axis, scrolling tailward with time.
        float streak = hash(floor(vLocal * vec3(9.0, 9.0, 1.0)) + floor(uTime * 24.0));
        float flicker = 0.72 + 0.28 * streak;
        float h = pow(uHeat, 0.7); // steep response — a half-heat dive already glows
        float glow = rim * body * flicker * h;
        vec3 col = mix(uColor, vec3(1.0, 0.98, 0.9), bow * h * 0.55); // white-hot at the bow
        // Additive: alpha 1 keeps the contribution linear in glow (rgb*alpha would square it).
        gl_FragColor = vec4(col * glow * 1.4, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  return {
    mesh,
    update(heat: number, color: number, timeSec: number) {
      const h = Math.min(1, Math.max(0, heat))
      mat.uniforms.uHeat.value = h
      ;(mat.uniforms.uColor.value as THREE.Color).setHex(color)
      mat.uniforms.uTime.value = timeSec
      mesh.visible = h > PLASMA_COLD_THRESHOLD
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}
