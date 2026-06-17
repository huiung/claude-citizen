import * as THREE from 'three'
import type { SurfaceKind } from '../sim/solarSystem'
import { generateCloudTexture, generatePlanetTextures, samplePlanetSurface } from './planetTextures'
import { makeAsteroidMaterial, makeOreMaterial } from './asteroidTextures'

/** Deterministic pseudo-random — same world for every visitor, no assets. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildStarfield(): THREE.Points {
  const rand = mulberry32(42)
  const count = 6000
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // Uniform on sphere shell, far away
    const r = 18000 + rand() * 4000
    const theta = rand() * Math.PI * 2
    const z = rand() * 2 - 1
    const s = Math.sqrt(1 - z * z)
    positions[i * 3] = r * s * Math.cos(theta)
    positions[i * 3 + 1] = r * s * Math.sin(theta)
    positions[i * 3 + 2] = r * z
    color.setHSL(0.55 + rand() * 0.15, rand() * 0.4, 0.6 + rand() * 0.4)
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({ size: 18, vertexColors: true, sizeAttenuation: true, fog: false })
  return new THREE.Points(geo, mat)
}

/** Procedural deep-space backdrop: a huge inward-facing sphere whose fragment shader
 *  paints fbm "nebula" clouds and a brighter Milky-Way band. Additive + depth-disabled
 *  so it always reads as the sky behind everything. Caller keeps it centred on the player. */
export function buildNebula(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColorA: { value: new THREE.Color(0x2a1a4a) }, // violet
      uColorB: { value: new THREE.Color(0x103a5a) }, // teal-blue
      uColorC: { value: new THREE.Color(0x4a1c34) }, // dim magenta
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform vec3 uColorA, uColorB, uColorC;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float n = fbm(d * 3.0);
        float n2 = fbm(d * 6.0 + 4.0);
        float band = pow(1.0 - abs(d.y), 3.0); // bright belt across the y=0 plane
        float cloud = smoothstep(0.45, 0.95, n) * 0.8 + band * 0.5 * smoothstep(0.3, 0.8, n2);
        vec3 col = mix(uColorA, uColorB, n2);
        col = mix(col, uColorC, smoothstep(0.5, 1.0, n));
        col += vec3(0.55, 0.65, 0.9) * band * 0.3;
        float intensity = cloud * 0.55;
        gl_FragColor = vec4(col * intensity, intensity);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(30000, 64, 48), mat)
  mesh.renderOrder = -1
  return mesh
}

/** Fresnel atmosphere shell — glows along the limb (edge), fades to clear over the disc.
 *  BackSide + additive so it reads as light scattering around the planet, not a painted skin. */
function makeAtmosphere(radius: number, atmoColor: number, power: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(atmoColor) }, uPower: { value: power } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      uniform vec3 uColor;
      uniform float uPower;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uPower);
        gl_FragColor = vec4(uColor * fres, fres);
      }
    `,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 48, 32), mat)
}

export function buildPlanet(): THREE.Group {
  const group = new THREE.Group()
  // Spawn-side backdrop world — a textured Mars-type planet, kept distinct from the
  // named Earth far out in the system so the two don't read as duplicates.
  group.add(makePlanetSurface(2200, 0xc25433, 'mars', 7, 6, 1.2))
  group.add(makeAtmosphere(2200, 0x9fb4c8, 3.2))
  // Well off the -z spawn sightline (up and to the side) so it doesn't crowd the named
  // planets/Sun in the first view — a side landmark, not part of the "planet showcase".
  group.position.set(12800, 5400, 400)
  return group
}

// Shared world positions — render and sim (docking) read the same source.
export const REFINERY_POS = new THREE.Vector3(120, 30, -350)
export const COLONY_POS = new THREE.Vector3(-1900, -800, -7000)

// Mineable ORE asteroids near the spawn corridor — sim (mining) and render share these.
export const MINEABLE_SITES: ReadonlyArray<{ id: string; position: THREE.Vector3; reserves: number }> = [
  { id: 'rock-1', position: new THREE.Vector3(70, 10, -140), reserves: 220 },
  { id: 'rock-2', position: new THREE.Vector3(-60, -25, -180), reserves: 220 },
  { id: 'rock-3', position: new THREE.Vector3(160, -20, -240), reserves: 300 },
]

/** A large, visually distinct mineable rock with glowing ORE veins. Caller positions/scales it.
 *  `rare` swaps the cyan veins for a gold glow — a high-value deep-space jackpot vein. */
export function buildMineableAsteroid(rare = false): THREE.Group {
  const group = new THREE.Group()
  const rand = mulberry32(rare ? 137 : 99)
  const rockMat = makeAsteroidMaterial(rare ? 137 : 99, rare ? 0x6b5a3a : 0x5a5048, 256)
  const geo = new THREE.IcosahedronGeometry(20, 3)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = v.clone().normalize()
    const n = (
      Math.sin(d.x * 4.7 + 1.7) * Math.cos(d.y * 3.9) * 0.18 +
      Math.sin(d.y * 8.3 + 0.4) * Math.cos(d.z * 7.1) * 0.1 +
      Math.sin(d.z * 13.7 + d.x * 5.9) * 0.06
    )
    v.multiplyScalar(0.92 + n)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  group.add(new THREE.Mesh(geo, rockMat))

  // Glowing ORE veins so pilots can spot a mineable rock at a glance — gold if it's a rare vein.
  const veinMat = makeOreMaterial(rare ? 4137 : 4099, rare ? 0xffc24d : 0x4fd0e0)
  const glowMat = new THREE.MeshBasicMaterial({
    color: rare ? 0xffd870 : 0x76f4ff,
    transparent: true,
    opacity: rare ? 0.26 : 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  for (let i = 0; i < 9; i++) {
    const vein = new THREE.Mesh(new THREE.CapsuleGeometry(0.7 + rand() * 0.35, 5 + rand() * 5, 3, 7), veinMat)
    const a = rand() * Math.PI * 2
    const b = rand() * Math.PI
    const r = 15 + rand() * 6
    const normal = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a))
    vein.position.copy(normal).multiplyScalar(r)
    vein.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
    vein.rotateX((rand() - 0.5) * 1.2)
    group.add(vein)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(2.4 + rand() * 1.5, 8, 6), glowMat)
    glow.position.copy(vein.position)
    group.add(glow)
  }
  return group
}

export function buildStation(): THREE.Group {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, metalness: 0.6, roughness: 0.4 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, flatShading: true, metalness: 0.7, roughness: 0.35 })

  const ring = new THREE.Mesh(new THREE.TorusGeometry(60, 7, 8, 24), hull)
  group.add(ring)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 26, 8), dark)
  hub.rotation.x = Math.PI / 2
  group.add(hub)
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 52), hull)
    spoke.rotation.z = (i / 4) * Math.PI * 2
    spoke.position.set(Math.cos(spoke.rotation.z) * 30, Math.sin(spoke.rotation.z) * 30, 0)
    spoke.lookAt(0, 0, 0)
    group.add(spoke)
  }
  // Docking beacon lights
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x66ff88 }),
    )
    light.position.set(0, 0, side * 16)
    group.add(light)
  }
  group.position.copy(REFINERY_POS)
  return group
}

/** Mining colony near the planet — the other end of the trade loop. Distinct silhouette. */
export function buildColony(): THREE.Group {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0xb58a3a, flatShading: true, metalness: 0.5, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x33291a, flatShading: true, metalness: 0.6, roughness: 0.5 })

  // Central drum
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 70, 8), hull)
  group.add(drum)
  // Cap domes
  for (const y of [-40, 40]) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(34, 20, 8), dark)
    cap.position.y = y
    cap.rotation.x = y > 0 ? 0 : Math.PI
    group.add(cap)
  }
  // Mining arms jutting outward
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(70, 5, 5), dark)
    const a = (i / 5) * Math.PI * 2
    arm.position.set(Math.cos(a) * 45, (i - 2) * 12, Math.sin(a) * 45)
    arm.rotation.y = -a
    group.add(arm)
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 0), hull)
    pod.position.set(Math.cos(a) * 82, (i - 2) * 12, Math.sin(a) * 82)
    group.add(pod)
  }
  // Amber docking beacons (vs the station's green)
  for (const y of [-44, 44]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffb347 }),
    )
    light.position.set(0, y, 0)
    group.add(light)
  }
  group.position.copy(COLONY_POS)
  return group
}

export function buildAsteroids(): THREE.Group {
  const group = new THREE.Group()
  const rand = mulberry32(1337)
  const mats = [
    makeAsteroidMaterial(1337, 0x6b6258, 256),
    makeAsteroidMaterial(1441, 0x5d5952, 256),
    makeAsteroidMaterial(1559, 0x74685d, 256),
  ]
  const baseGeos = [0, 1, 2].map(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      v.multiplyScalar(0.75 + rand() * 0.5)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    return geo
  })
  for (let i = 0; i < 70; i++) {
    const rock = new THREE.Mesh(baseGeos[i % 3], mats[i % 3])
    // Scatter in a loose belt around the spawn corridor
    const angle = rand() * Math.PI * 2
    const radius = 250 + rand() * 900
    rock.position.set(
      Math.cos(angle) * radius,
      (rand() - 0.5) * 500,
      Math.sin(angle) * radius - 300,
    )
    rock.scale.setScalar(2 + rand() * 14)
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(rock)
  }
  return group
}

/** Giant glowing star. Pair with a PointLight at the same position in main. */
export function buildSun(radius: number, color: number): THREE.Group {
  const group = new THREE.Group()

  // Living star surface: animated 3D value-noise granulation, pushed into HDR so the
  // existing bloom pass catches the bright cells. Time is driven from the frame loop.
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vPos;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 p = normalize(vPos);
        float n = fbm(p * 3.5 + vec3(uTime * 0.072));
        float n2 = fbm(p * 9.0 - vec3(uTime * 0.12));
        float h = n * 0.65 + n2 * 0.35;
        vec3 col = mix(vec3(0.6, 0.12, 0.02), vec3(1.0, 0.45, 0.05), smoothstep(0.25, 0.55, h));
        col = mix(col, vec3(1.0, 0.85, 0.4), smoothstep(0.55, 0.82, h));
        col += vec3(1.0, 0.7, 0.3) * pow(max(h, 0.0), 4.0) * 0.8; // hot flecks
        col *= 1.4; // HDR push so bloom catches the bright granules (kept modest so the core doesn't blow out)
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 5), sunMat))

  // Two additive corona shells — a tight warm halo + a soft faint bleed. Kept small,
  // low-opacity and higher-poly so the limb reads as glow rather than a hard shell.
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.1, 48, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  ))
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.25, 48, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  ))

  group.userData.sunMat = sunMat
  return group
}

/** One surface mesh at a given tessellation + displacement scale — used as an LOD level.
 *  Higher `dispScale` raises mountains/valleys (close-up detail); lower flattens (far away). */
function makePlanetSurface(
  radius: number, color: number, surface: SurfaceKind, seed: number, detail: number, dispScale: number,
): THREE.Mesh {
  const isGas = surface === 'gas'
  const segments = detail >= 6 ? 96 : 56
  const geo = new THREE.SphereGeometry(radius, segments, Math.max(24, Math.floor(segments / 2)))
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const nx = v.x / radius, ny = v.y / radius, nz = v.z / radius
    const sampled = samplePlanetSurface(surface, seed, nx, ny, nz, color, radius)
    const disp = isGas || surface === 'venus' ? 0 : sampled.height * radius * 0.055
    v.setLength(radius + disp * dispScale)
    pos.setXYZ(i, v.x, v.y, v.z)
  }

  geo.computeVertexNormals()
  const mapSize = radius >= 4000 || isGas ? 1024 : 512
  const maps = generatePlanetTextures(surface, seed, color, mapSize, radius)
  const material = new THREE.MeshStandardMaterial({
    map: maps.colorMap,
    bumpMap: maps.bumpMap,
    bumpScale: radius * 0.018,
    roughness: isGas ? 0.72 : 0.96,
    metalness: 0,
  })
  return new THREE.Mesh(geo, material)
}

/** A named-solar-system planet: LOD surface (detailed terrain up close, low-poly far) + atmosphere (+ rings).
 *  Rocky/earthy bodies get an LOD; gas giants are a single banded sphere. Returned group holds the LOD —
 *  the caller must call .update(camera) on it each frame. */
export function buildSolarPlanet(
  radius: number, color: number, hasRings: boolean, surface: SurfaceKind, seed: number,
): THREE.Group {
  const group = new THREE.Group()
  const isGas = surface === 'gas'
  if (isGas) {
    group.add(makePlanetSurface(radius, color, surface, seed, 4, 1))
  } else {
    const lod = new THREE.LOD()
    lod.addLevel(makePlanetSurface(radius, color, surface, seed, 6, 1.5), 0) // close: detailed terrain
    lod.addLevel(makePlanetSurface(radius, color, surface, seed, 4, 0.5), radius * 3.5) // far: low-poly, flatter
    group.add(lod)
  }

  // Fresnel atmosphere — glowing limb tinted by kind (denser air ⇒ softer, wider falloff)
  const atmoColor = surface === 'earth' ? 0x88bbff : surface === 'venus' ? 0xe8c070 : isGas ? 0xd8c0a0 : 0x9fb4c8
  const atmoPower = surface === 'venus' || isGas ? 2.2 : 3.2 // thicker air bleeds further across the disc
  group.add(makeAtmosphere(radius, atmoColor, atmoPower))

  // Earth-type bodies get a translucent cloud shell drifting just above the surface.
  const clouds = generateCloudTexture(surface, seed, radius >= 4000 ? 1024 : 512, radius)
  if (clouds) {
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.018, 72, 36),
      new THREE.MeshBasicMaterial({ map: clouds, transparent: true, opacity: 0.4, depthWrite: false }),
    ))
  }

  if (hasRings) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.4, radius * 2.3, 96),
      new THREE.MeshBasicMaterial({ color: 0xccbb99, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    )
    ring.rotation.x = Math.PI / 2.3
    group.add(ring)
  }
  return group
}

export function buildLights(scene: THREE.Scene): void {
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4)
  sun.position.set(8000, 3000, 5000)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x223344, 0.7))
}

// --- Quantum warp streaks (camera-local hyperspace lines) ---
const WARP_COUNT = 700
const WARP_RANGE = 1600 // depth span ahead of the camera the streaks recycle through

/** Radial field of streaks in CAMERA-LOCAL space — attach to the camera so they stay
 *  aligned with the direction of travel. Idle by default; drive with updateWarpField. */
export function buildWarpField(): THREE.LineSegments {
  const rand = mulberry32(7)
  const positions = new Float32Array(WARP_COUNT * 2 * 3)
  const meta = new Float32Array(WARP_COUNT * 3) // per-streak local x, y, z0
  for (let i = 0; i < WARP_COUNT; i++) {
    const ang = rand() * Math.PI * 2
    const radius = 6 + rand() * 260
    meta[i * 3] = Math.cos(ang) * radius
    meta[i * 3 + 1] = Math.sin(ang) * radius
    meta[i * 3 + 2] = -WARP_RANGE * rand() // negative z = ahead of the camera
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const seg = new THREE.LineSegments(geo, mat)
  seg.userData.meta = meta
  seg.frustumCulled = false
  seg.visible = false
  return seg
}

/** Drive the warp streaks. `intensity` 0..1 (off → full quantum). When `inward` (spool-up),
 *  streaks are sucked toward the vanishing point ahead — tension. Otherwise they stream past
 *  the camera — travel. Opacity eases so the whole sequence is smooth. */
export function updateWarpField(seg: THREE.LineSegments, intensity: number, dt: number, inward = false): void {
  const mat = seg.material as THREE.LineBasicMaterial
  mat.opacity += (intensity - mat.opacity) * Math.min(1, dt * 6)
  if (mat.opacity < 0.01) { seg.visible = false; return }
  seg.visible = true
  const meta = seg.userData.meta as Float32Array
  const attr = seg.geometry.getAttribute('position') as THREE.BufferAttribute
  const arr = attr.array as Float32Array
  const flow = 1400 * Math.max(intensity, 0.15) * (inward ? -1 : 1) // negative = pulled ahead into the vanishing point
  const len = 30 + 300 * intensity // streak length scales with speed
  for (let i = 0; i < WARP_COUNT; i++) {
    let z = meta[i * 3 + 2] + flow * dt
    if (z > 0) z -= WARP_RANGE       // streaming past: recycle back out ahead
    else if (z < -WARP_RANGE) z += WARP_RANGE // sucked ahead: recycle near the camera
    meta[i * 3 + 2] = z
    const x = meta[i * 3], y = meta[i * 3 + 1], j = i * 6
    arr[j] = x; arr[j + 1] = y; arr[j + 2] = z // far end (ahead)
    arr[j + 3] = x; arr[j + 4] = y; arr[j + 5] = z + len // near end (toward camera)
  }
  attr.needsUpdate = true
}

// --- Space dust (parallax motes for a sense of speed) ---
const DUST_COUNT = 480
const DUST_HALF = 360 // motes wrap within ±this around the camera

/** A box of faint motes the ship flies through — they streak past and sell speed. World-space. */
export function buildDustField(): THREE.Points {
  const rand = mulberry32(99)
  const positions = new Float32Array(DUST_COUNT * 3)
  for (let i = 0; i < DUST_COUNT * 3; i++) positions[i] = (rand() * 2 - 1) * DUST_HALF
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0x6a7a90, size: 2.2, transparent: true, opacity: 0.5, sizeAttenuation: true, depthWrite: false,
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  return pts
}

/** Keep motes wrapped in a box around the camera — the ship's own motion makes them stream past. */
export function updateDustField(pts: THREE.Points, cam: THREE.Vector3): void {
  const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute
  const arr = attr.array as Float32Array
  for (let i = 0; i < DUST_COUNT; i++) {
    for (let a = 0; a < 3; a++) {
      const k = i * 3 + a
      const rel = arr[k] - cam.getComponent(a)
      if (rel > DUST_HALF) arr[k] -= 2 * DUST_HALF
      else if (rel < -DUST_HALF) arr[k] += 2 * DUST_HALF
    }
  }
  attr.needsUpdate = true
}

/** A capital ship — a procedural dreadnought ~120× a fighter, with a lit hull, a bridge
 *  tower, lateral ribs, and rows of tiny glowing windows (the "city in space" scale cue).
 *  Static set-dressing: place it once and let the player fly its length for the awe. */
export function buildCapitalShip(seed = 7): THREE.Group {
  const g = new THREE.Group()
  const rand = mulberry32(seed)
  const hull = new THREE.MeshStandardMaterial({ color: 0x49515c, flatShading: true, metalness: 0.6, roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e232a, flatShading: true, metalness: 0.6, roughness: 0.45 })
  const winA = new THREE.MeshBasicMaterial({ color: 0xffe0a0 }) // warm windows
  const winB = new THREE.MeshBasicMaterial({ color: 0x9fe0ff }) // cool windows
  const L = 620

  // Main spine + angular prow.
  g.add(new THREE.Mesh(new THREE.BoxGeometry(64, 84, L), hull))
  const prow = new THREE.Mesh(new THREE.ConeGeometry(54, 150, 4), hull)
  prow.rotation.x = -Math.PI / 2; prow.rotation.z = Math.PI / 4
  prow.position.z = -(L / 2 + 58)
  g.add(prow)
  // Ventral keel.
  const keel = new THREE.Mesh(new THREE.BoxGeometry(30, 28, L * 0.8), dark)
  keel.position.y = -52
  g.add(keel)

  // Bridge tower + command block.
  const tower = new THREE.Mesh(new THREE.BoxGeometry(42, 70, 130), hull)
  tower.position.set(0, 78, -L * 0.18)
  g.add(tower)
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(52, 26, 64), dark)
  bridge.position.set(0, 120, -L * 0.18)
  g.add(bridge)

  // Dorsal greeble modules + lateral ribs.
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(40, 24, 50), dark)
    m.position.set(0, 54, -L * 0.06 + i * 92)
    g.add(m)
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(12, 70, 24), hull)
      rib.position.set(side * 38, 0, -L * 0.34 + i * 92)
      g.add(rib)
    }
  }

  // Window rows — tiny emissive boxes down both flanks; the scale cue.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 26; i++) {
        if (rand() < 0.25) continue // some cabins are dark
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 5), rand() < 0.35 ? winA : winB)
        w.position.set(side * 33, -24 + row * 22, -L * 0.42 + i * (L * 0.84 / 25))
        g.add(w)
      }
    }
  }

  // Stern engine cluster — large glowing bells with white-hot cores.
  for (const [x, y] of [[-24, 18], [24, 18], [-24, -18], [24, -18], [0, 0]] as [number, number][]) {
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(13, 16, 30, 8), dark)
    bell.rotation.x = Math.PI / 2
    bell.position.set(x, y, L / 2 + 12)
    g.add(bell)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(11, 16), new THREE.MeshBasicMaterial({ color: 0x8fd0ff }))
    glow.position.set(x, y, L / 2 + 28)
    g.add(glow)
    const core = new THREE.Mesh(new THREE.CircleGeometry(5, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    core.position.set(x, y, L / 2 + 28.5)
    g.add(core)
  }

  return g
}

/** A glowing loot/treasure crate — gold when rare, cyan otherwise. Caller spins it;
 *  the emissive core + wireframe shell pop under bloom. */
export function buildLootCrate(rare: boolean): THREE.Group {
  const g = new THREE.Group()
  const color = rare ? 0xffd24d : 0x6fe8ff
  g.add(new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85, flatShading: true, metalness: 0.4, roughness: 0.5 }),
  ))
  g.add(new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 1.3, 1.3),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.6 }),
  ))
  return g
}
