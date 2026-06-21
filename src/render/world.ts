import * as THREE from 'three'
import type { SurfaceKind } from '../sim/solarSystem'
import { SUN_POSITION } from '../sim/solarSystem'
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
function makeAtmosphere(radius: number, atmoColor: number, power: number, dayColor = 0xffb070): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(atmoColor) },
      uDayColor: { value: new THREE.Color(dayColor) },
      uPower: { value: power },
      uSunPos: { value: SUN_POSITION.clone() }, // world-space sun — drives the day/night limb
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main(){
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      uniform vec3 uColor;
      uniform vec3 uDayColor;
      uniform float uPower;
      uniform vec3 uSunPos;
      void main(){
        // Limb glow (Fresnel) — brightest where the shell grazes the view ray.
        float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vView))), uPower);
        // Day/night from the sun direction at this point on the shell.
        vec3 sunDir = normalize(uSunPos - vWorldPos);
        float ndl = dot(normalize(vWorldNormal), sunDir); // -1 night .. +1 day
        float day = smoothstep(-0.3, 0.25, ndl);          // soft terminator
        // Warm sunset band peaks across the terminator, on the lit side.
        float sunset = pow(clamp(1.0 - abs(ndl), 0.0, 1.0), 2.0) * day;
        vec3 col = mix(uColor, uDayColor, sunset);
        float lit = mix(0.04, 1.0, day);                  // night limb nearly fades out
        gl_FragColor = vec4(col * fres * lit, fres * lit);
      }
    `,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 48, 32), mat)
}

// Spawn-side backdrop world — a textured Mars-type planet, up and to the side of the -z
// sightline so it doesn't crowd the named planets. Exported so collision + the atmosphere
// veil treat it like any other planet.
export const SPAWN_PLANET = { position: new THREE.Vector3(12800, 5400, 400), radius: 2200, surface: 'mars' as SurfaceKind }

export function buildPlanet(): THREE.Group {
  const group = new THREE.Group()
  group.add(makePlanetSurface(SPAWN_PLANET.radius, 0xc25433, SPAWN_PLANET.surface, 7, 4, 0.8, 1024))
  group.add(makeAtmosphere(SPAWN_PLANET.radius, 0x9fb4c8, 3.2))
  group.position.copy(SPAWN_PLANET.position)
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

/** Degen launch monument — a giant reusable-rocket landmark with a golden dog-coin
 *  emblem. It is decorative world dressing only: no branded logos, no gameplay stats. */
export function buildMuchLaunchTower(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Much Launch Tower'

  const white = new THREE.MeshStandardMaterial({ color: 0xe8eee6, flatShading: true, metalness: 0.18, roughness: 0.52 })
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x15191d, flatShading: true, metalness: 0.62, roughness: 0.42 })
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x59636e, flatShading: true, metalness: 0.7, roughness: 0.38 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0b640, flatShading: true, metalness: 0.55, roughness: 0.36, emissive: 0x3a2100, emissiveIntensity: 0.18 })
  const amber = new THREE.MeshBasicMaterial({ color: 0xffc24d })
  const orangeGlow = new THREE.MeshBasicMaterial({ color: 0xff7a2e })
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x9ff7ff })

  const box = (name: string, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, rot: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat)
    mesh.name = name
    mesh.position.set(pos[0], pos[1], pos[2])
    mesh.rotation.set(rot[0], rot[1], rot[2])
    group.add(mesh)
    return mesh
  }
  const cyl = (name: string, rt: number, rb: number, h: number, pos: [number, number, number], mat: THREE.Material, radial = 16): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, radial), mat)
    mesh.name = name
    mesh.position.set(pos[0], pos[1], pos[2])
    group.add(mesh)
    return mesh
  }
  // Launch pad and tower.
  box('launch pad deck', [320, 24, 260], [0, -18, 0], charcoal)
  box('flame trench glow', [80, 6, 120], [0, -32, 0], orangeGlow)
  box('tower spine', [24, 430, 24], [-105, 180, 0], towerMat)
  for (let i = 0; i < 9; i++) {
    const y = -10 + i * 46
    box(`tower deck ${i}`, [78, 7, 54], [-105, y, 0], towerMat)
    box(`tower diagonal a ${i}`, [8, 64, 8], [-105, y + 20, -24], towerMat, [0, 0, 0.65])
    box(`tower diagonal b ${i}`, [8, 64, 8], [-105, y + 20, 24], towerMat, [0, 0, -0.65])
  }
  box('crew arm upper', [100, 8, 10], [-54, 250, 0], towerMat)
  box('crew arm lower', [82, 7, 9], [-60, 112, 0], towerMat)
  for (let i = 0; i < 7; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), i % 2 ? amber : windowMat)
    lamp.name = `tower beacon ${i}`
    lamp.position.set(-92, 12 + i * 48, 29)
    group.add(lamp)
  }

  // Reusable rocket: intentionally generic, low-poly and chunky.
  cyl('rocket lower booster', 34, 38, 255, [18, 95, 0], white, 18)
  cyl('rocket upper stage', 26, 32, 130, [18, 290, 0], white, 18)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(26, 72, 18), white)
  nose.name = 'rocket nose cone'
  nose.position.set(18, 391, 0)
  group.add(nose)
  cyl('black interstage', 35, 35, 30, [18, 230, 0], charcoal, 18)
  cyl('black engine skirt', 40, 34, 42, [18, -54, 0], charcoal, 18)
  for (const z of [-28, 28]) {
    box(`landing fin ${z}`, [12, 68, 42], [18, -82, z], charcoal, [0.42, 0, 0])
  }
  for (const x of [-7, 18, 43]) {
    const bell = cyl(`engine bell ${x}`, 8, 12, 20, [x, -88, 0], charcoal, 10)
    bell.rotation.x = Math.PI
    const glow = new THREE.Mesh(new THREE.CircleGeometry(8, 12), orangeGlow)
    glow.name = `engine glow ${x}`
    glow.position.set(x, -101, 0)
    glow.rotation.x = -Math.PI / 2
    group.add(glow)
  }

  // Actual doge decal supplied by the project owner. Two placements keep it readable
  // from both the spawn approach and close fly-bys.
  const dogeTex = new THREE.TextureLoader().load('/assets/decals/doge.png')
  dogeTex.colorSpace = THREE.SRGBColorSpace
  const dogeMat = new THREE.MeshBasicMaterial({ map: dogeTex, transparent: true, depthWrite: false })
  const sideDoge = new THREE.Mesh(new THREE.PlaneGeometry(94, 63), dogeMat)
  sideDoge.name = 'doge side decal'
  sideDoge.position.set(57.6, 156, 0)
  sideDoge.rotation.y = Math.PI / 2
  group.add(sideDoge)
  const frontDoge = new THREE.Mesh(new THREE.PlaneGeometry(82, 55), dogeMat)
  frontDoge.name = 'doge front decal'
  frontDoge.position.set(18, 154, 39.4)
  group.add(frontDoge)

  // Moon/coin gag around the pad, readable from a distance.
  const moon = new THREE.Mesh(new THREE.SphereGeometry(36, 24, 16), gold)
  moon.name = 'to the moons beacon'
  moon.position.set(130, 290, -80)
  group.add(moon)
  const bite = new THREE.Mesh(new THREE.SphereGeometry(34, 24, 16), new THREE.MeshBasicMaterial({ color: 0x010206 }))
  bite.name = 'moon crescent cutout'
  bite.position.set(144, 300, -68)
  group.add(bite)

  const signCanvas = document.createElement('canvas')
  signCanvas.width = 512
  signCanvas.height = 160
  const ctx = signCanvas.getContext('2d')!
  ctx.fillStyle = '#07100d'
  ctx.fillRect(0, 0, signCanvas.width, signCanvas.height)
  ctx.strokeStyle = '#ffcf66'
  ctx.lineWidth = 10
  ctx.strokeRect(9, 9, signCanvas.width - 18, signCanvas.height - 18)
  ctx.fillStyle = '#ffcf66'
  ctx.font = '700 54px monospace'
  ctx.fillText('MUCH LAUNCH', 54, 72)
  ctx.font = '700 30px monospace'
  ctx.fillText('TO THE MOONS', 102, 116)
  const signTex = new THREE.CanvasTexture(signCanvas)
  signTex.colorSpace = THREE.SRGBColorSpace
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 47),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
  )
  sign.name = 'much launch sign'
  sign.position.set(-12, 45, 135)
  sign.rotation.y = Math.PI
  group.add(sign)

  return group
}

/** Rare frog shrine — a Pepe-inspired low-poly monument. It avoids copied artwork:
 *  the read comes from the silhouette (wide frog face, sleepy eyes, flat mouth). */
export function buildRareFrogShrine(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Rare Frog Shrine'

  const stone = new THREE.MeshStandardMaterial({ color: 0x27312c, flatShading: true, metalness: 0.15, roughness: 0.74 })
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x111713, flatShading: true, metalness: 0.2, roughness: 0.8 })
  const limeGlow = new THREE.MeshBasicMaterial({ color: 0x76ff7a })

  const box = (name: string, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, rot: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat)
    mesh.name = name
    mesh.position.set(pos[0], pos[1], pos[2])
    mesh.rotation.set(rot[0], rot[1], rot[2])
    group.add(mesh)
    return mesh
  }
  const cyl = (name: string, rt: number, rb: number, h: number, pos: [number, number, number], mat: THREE.Material, radial = 16): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, radial), mat)
    mesh.name = name
    mesh.position.set(pos[0], pos[1], pos[2])
    group.add(mesh)
    return mesh
  }
  cyl('rare pond plinth', 150, 170, 26, [0, -18, 0], darkStone, 10)
  cyl('rare pond glow', 124, 136, 8, [0, -4, 0], limeGlow, 18)
  cyl('frog shrine pedestal', 86, 102, 80, [0, 36, 0], stone, 8)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const marker = box(`pond monolith ${i}`, [12, 54 + (i % 2) * 18, 12], [Math.cos(a) * 150, 24, Math.sin(a) * 150], i % 2 ? stone : darkStone)
    marker.rotation.y = -a
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), limeGlow)
    lamp.name = `pond signal ${i}`
    lamp.position.set(Math.cos(a) * 150, 60 + (i % 2) * 18, Math.sin(a) * 150)
    group.add(lamp)
  }

  // Real meme signal screen. The earlier sculpted frog face read too far from the
  // source, so the shrine now uses the provided image as the artifact itself.
  const pepeTex = new THREE.TextureLoader().load('/assets/decals/pepe.jpeg')
  pepeTex.colorSpace = THREE.SRGBColorSpace
  box('rare pepe signal pylon', [32, 150, 18], [0, 92, 20], stone)
  box('rare pepe signal screen backplate', [168, 168, 10], [0, 168, 76], darkStone)
  const pepeScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(154, 154),
    new THREE.MeshBasicMaterial({ map: pepeTex }),
  )
  pepeScreen.name = 'rare pepe signal screen'
  pepeScreen.position.set(0, 168, 82)
  group.add(pepeScreen)
  box('rare pepe screen top frame', [184, 9, 9], [0, 258, 83], limeGlow)
  box('rare pepe screen bottom frame', [184, 9, 9], [0, 78, 83], limeGlow)
  box('rare pepe screen left frame', [9, 184, 9], [-90, 168, 83], limeGlow)
  box('rare pepe screen right frame', [9, 184, 9], [90, 168, 83], limeGlow)

  // A faint halo/crown reads like an artifact instead of a literal character model.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(92, 2.8, 8, 40), limeGlow)
  halo.name = 'rare signal halo'
  halo.position.set(0, 168, -40)
  halo.rotation.x = Math.PI / 2
  group.add(halo)
  for (const x of [-82, -44, 44, 82]) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(10, 0), limeGlow)
    gem.name = `rare signal gem ${x}`
    gem.position.set(x, 70, 86)
    group.add(gem)
  }

  const signCanvas = document.createElement('canvas')
  signCanvas.width = 512
  signCanvas.height = 160
  const ctx = signCanvas.getContext('2d')!
  ctx.fillStyle = '#06110a'
  ctx.fillRect(0, 0, signCanvas.width, signCanvas.height)
  ctx.strokeStyle = '#76ff7a'
  ctx.lineWidth = 10
  ctx.strokeRect(9, 9, signCanvas.width - 18, signCanvas.height - 18)
  ctx.fillStyle = '#bfffc0'
  ctx.font = '700 54px monospace'
  ctx.fillText('RARE PEPE', 82, 72)
  ctx.font = '700 30px monospace'
  ctx.fillText('POND LINK: ONLINE', 84, 116)
  const signTex = new THREE.CanvasTexture(signCanvas)
  signTex.colorSpace = THREE.SRGBColorSpace
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(158, 49),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
  )
  sign.name = 'rare pond sign'
  sign.position.set(0, 48, 175)
  group.add(sign)

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
  textureSize?: number,
): THREE.Mesh {
  const isGas = surface === 'gas'
  const segments = detail >= 8 ? 192 : detail >= 6 ? 96 : 56
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
  // Solid, detailed bodies (earth/mars/mercury) get extra resolution for crisp close-ups.
  const mapSize = textureSize ?? (surface === 'earth' || surface === 'mars' || surface === 'rocky' ? 2048 : radius >= 4000 || isGas ? 1024 : 512)
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
export interface SolarPlanetOptions {
  quality?: 'startup' | 'high'
  startupTextureSize?: number
}

export function buildSolarPlanet(
  radius: number, color: number, hasRings: boolean, surface: SurfaceKind, seed: number,
  options: SolarPlanetOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  const isGas = surface === 'gas'
  const quality = options.quality ?? 'startup'
  const startupTextureSize = options.startupTextureSize ?? 512
  if (isGas) {
    group.add(makePlanetSurface(radius, color, surface, seed, 4, 1, quality === 'high' ? undefined : startupTextureSize))
  } else if (quality === 'high') {
    const lod = new THREE.LOD()
    lod.addLevel(makePlanetSurface(radius, color, surface, seed, 8, 1.6), 0) // up close: highest tessellation + tallest terrain
    lod.addLevel(makePlanetSurface(radius, color, surface, seed, 6, 1.4), radius * 1.8) // mid
    lod.addLevel(makePlanetSurface(radius, color, surface, seed, 4, 0.5), radius * 4.5) // far: low-poly, flatter
    group.add(lod)
  } else {
    group.add(makePlanetSurface(radius, color, surface, seed, 4, 0.8, startupTextureSize))
  }

  // Fresnel atmosphere — glowing limb tinted by kind (denser air ⇒ softer, wider falloff)
  const atmoColor = surface === 'earth' ? 0x88bbff : surface === 'venus' ? 0xe8c070 : isGas ? 0xd8c0a0 : 0x9fb4c8
  const atmoPower = surface === 'venus' || isGas ? 2.2 : 3.2 // thicker air bleeds further across the disc
  group.add(makeAtmosphere(radius, atmoColor, atmoPower))

  // Earth-type bodies get a translucent cloud shell drifting just above the surface.
  const startupCloudSize = startupTextureSize > 512 ? 512 : 256
  const clouds = generateCloudTexture(surface, seed, quality === 'high' ? (radius >= 4000 ? 1024 : 512) : startupCloudSize, radius)
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
  const ends = new Float32Array(WARP_COUNT * 2) // per-vertex: 0 = far (vanishing point), 1 = near (camera)
  for (let i = 0; i < WARP_COUNT; i++) { ends[i * 2] = 0; ends[i * 2 + 1] = 1 }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
  // Shader streaks: hot white-cyan core at the vanishing point fading to deep blue toward the
  // camera, brightening with warp intensity — reads as a tunnel sucked into the distance.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uIntensity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aEnd;
      varying float vEnd;
      void main() {
        vEnd = aEnd;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uIntensity;
      varying float vEnd;
      void main() {
        vec3 hot = vec3(0.9, 0.97, 1.0);   // vanishing-point core
        vec3 cool = vec3(0.16, 0.42, 1.0); // trailing blue
        vec3 col = mix(hot, cool, vEnd) * (1.0 + uIntensity * 1.6);
        float a = uOpacity * mix(1.0, 0.1, vEnd); // bright ahead, fades toward the camera
        gl_FragColor = vec4(col, a);
      }
    `,
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
  const mat = seg.material as THREE.ShaderMaterial
  const op = mat.uniforms.uOpacity.value as number
  mat.uniforms.uOpacity.value = op + (intensity - op) * Math.min(1, dt * 6)
  mat.uniforms.uIntensity.value = intensity
  if ((mat.uniforms.uOpacity.value as number) < 0.01) { seg.visible = false; return }
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
