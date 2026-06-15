import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { createShipState, stepShip, type ControlInput } from './sim/physics'
import { buildCraft } from './render/shipyard'
import { SHIP_STATS, type ShipType } from './sim/shipTypes'
import {
  buildAsteroids, buildColony, buildLights, buildMineableAsteroid, buildPlanet,
  buildSolarPlanet, buildStarfield, buildStation, buildSun, COLONY_POS, MINEABLE_SITES, REFINERY_POS,
} from './render/world'
import { PLANETS, SUN_COLOR, SUN_POSITION, SUN_RADIUS } from './sim/solarSystem'
import { NetClient, type PeerState, type PlayerProgress } from './net/client'
import { dockableTarget, type DockTarget } from './sim/docking'
import { cargoUsed, loadEconomy, OUTPOSTS, saveEconomy } from './sim/economy'
import { createAsteroidField, mineStep } from './sim/mining'
import { createMarket, step as marketStep } from './sim/market'
import { generateContracts } from './sim/contracts'
import { boostMultiplier, cargoCapacity, loadUpgrades, saveUpgrades, topSpeed } from './sim/upgrades'
import { type Celestial, queryCelestials } from './sim/galaxy'
import { cancelTravel, createQuantum, startTravel, stepQuantum } from './sim/quantum'
import {
  canFire, createHealth, createWeapon, fire as fireWeapon, type HitTarget, hullFraction,
  isDead, type Projectile, resolveHits, spawnProjectile, stepProjectiles, stepWeapon,
} from './sim/combat'
import { type Pirate, PIRATE_REWARD, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
import { GameAudio } from './audio/sound'
import { StationMenu } from './ui/stationMenu'
import { inject as injectAnalytics } from '@vercel/analytics'

injectAnalytics() // Vercel Web Analytics (no-op off Vercel / in dev)

const INTERP_DELAY_MS = 120

// --- DOM
const appEl = document.getElementById('app')!
const overlayEl = document.getElementById('overlay')!
const nicknameEl = document.getElementById('nickname') as HTMLInputElement
const launchEl = document.getElementById('launch') as HTMLButtonElement
const hudEl = document.getElementById('hud')!
const statusEl = document.getElementById('status')!
const helpEl = document.getElementById('help')!
const crosshairEl = document.getElementById('crosshair')!
const speedEl = document.getElementById('speed')!
const assistEl = document.getElementById('assist')!
const boostEl = document.getElementById('boost')!
const netEl = document.getElementById('net')!
const onlineEl = document.getElementById('online')!
const walletEl = document.getElementById('wallet')!
const creditsEl = document.getElementById('credits')!
const cargoEl = document.getElementById('cargo')!
const dockPromptEl = document.getElementById('dock-prompt')!
const mineEl = document.getElementById('mine-prompt')!
const hullBarEl = document.getElementById('hull-bar')!
const enemiesEl = document.getElementById('enemies')!
const flashEl = document.getElementById('damage-flash')!
const quantumEl = document.getElementById('quantum')!
const navHintEl = document.getElementById('nav-hint')!
const safeEl = document.getElementById('safe-zone')!
const chatInputEl = document.getElementById('chat-input') as HTMLInputElement
const chatLogEl = document.getElementById('chat-log')!
const statOnlineEl = document.getElementById('stat-online')!
const statRegisteredEl = document.getElementById('stat-registered')!
const minimapWrapEl = document.getElementById('minimap-wrap')!
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement
const mctx = minimapCanvas.getContext('2d')!

nicknameEl.value = localStorage.getItem('callsign') ?? ''

// Anonymous progress token — no accounts. The server persists progress keyed by this.
function loadToken(): string {
  let t = localStorage.getItem('scc.token')
  if (!t) {
    t = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    localStorage.setItem('scc.token', t)
  }
  return t
}
const playerToken = loadToken()

// Landing stats (online / registered pilots) from the relay's /stats endpoint.
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:8080`
const STATS_URL = WS_URL.replace(/^ws/, 'http') + '/stats'
let statsTimer: ReturnType<typeof setInterval> | undefined
function refreshLandingStats(): void {
  fetch(STATS_URL)
    .then((r) => r.json())
    .then((d) => {
      statOnlineEl.textContent = String(d.online ?? '—')
      statRegisteredEl.textContent = String(d.registered ?? '—')
    })
    .catch(() => { /* relay offline — leave placeholders */ })
}
refreshLandingStats()
statsTimer = setInterval(refreshLandingStats, 6000)

// --- Renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
appEl.appendChild(renderer.domElement)

const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(innerWidth, innerHeight)
labelRenderer.domElement.style.position = 'fixed'
labelRenderer.domElement.style.top = '0'
labelRenderer.domElement.style.pointerEvents = 'none'
appEl.appendChild(labelRenderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010206)
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 500000)

const starfield = buildStarfield()
scene.add(starfield, buildPlanet(), buildAsteroids())
const station = buildStation()
const colony = buildColony()
scene.add(station, colony)

// Named solar system — giant backdrop + quantum-travel targets. Trade/outposts stay local.
const sun = buildSun(SUN_RADIUS, SUN_COLOR)
sun.position.copy(SUN_POSITION)
scene.add(sun)
const sunLight = new THREE.PointLight(0xfff0be, 2.5, 0, 0) // no falloff — lights the whole system
sunLight.position.copy(SUN_POSITION)
scene.add(sunLight)
const planetLODs: THREE.LOD[] = []
for (const planet of PLANETS) {
  const mesh = buildSolarPlanet(planet.radius, planet.color, planet.hasRings, planet.surface, planet.seed)
  mesh.position.copy(planet.position)
  scene.add(mesh)
  mesh.traverse((o) => { if (o instanceof THREE.LOD) planetLODs.push(o) })
}
buildLights(scene)

// Mineable asteroids — sim field + render meshes share MINEABLE_SITES positions.
const field = createAsteroidField(MINEABLE_SITES)
const rockMeshes = new Map<string, { mesh: THREE.Group; initial: number }>()
for (const site of MINEABLE_SITES) {
  const mesh = buildMineableAsteroid()
  mesh.position.copy(site.position)
  scene.add(mesh)
  rockMeshes.set(site.id, { mesh, initial: site.reserves })
}

// --- Procedural galaxy: stream celestial bodies in/out around the player.
const STREAM_RADIUS = 80000
const spawnedBodies = new Map<string, THREE.Object3D>()
let lastStream = -Infinity

function celestialRng(seed: number): () => number {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildCelestial(c: Celestial): THREE.Object3D {
  const rand = celestialRng(c.seed)
  const group = new THREE.Group()
  if (c.type === 'planet' || c.type === 'moon') {
    const isPlanet = c.type === 'planet'
    const hue = isPlanet ? rand() : 0.08 + rand() * 0.08
    const sat = isPlanet ? 0.4 + rand() * 0.3 : 0.08
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(c.radius, isPlanet ? 3 : 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, sat, 0.5), flatShading: true, roughness: 0.95 }),
    )
    group.add(body)
    if (isPlanet) {
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(c.radius * 1.05, 24, 16),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((hue + 0.5) % 1, 0.6, 0.6), transparent: true, opacity: 0.1, side: THREE.BackSide }),
      )
      group.add(atmo)
    }
  } else if (c.type === 'asteroid-cluster') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6258, flatShading: true, roughness: 1 })
    const n = 6 + Math.floor(rand() * 8)
    for (let i = 0; i < n; i++) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(c.radius * (0.1 + rand() * 0.22), 0), mat)
      rock.position.set((rand() - 0.5) * c.radius * 2, (rand() - 0.5) * c.radius * 2, (rand() - 0.5) * c.radius * 2)
      group.add(rock)
    }
  } else if (c.type === 'station') {
    const hull = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, metalness: 0.6, roughness: 0.4 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(c.radius, c.radius * 0.12, 8, 18), hull)
    group.add(ring)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(c.radius * 0.22, c.radius * 0.22, c.radius * 0.6, 8), hull)
    hub.rotation.x = Math.PI / 2
    group.add(hub)
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3530, flatShading: true, roughness: 1, metalness: 0.3 })
    const hull = new THREE.Mesh(new THREE.BoxGeometry(c.radius * 0.6, c.radius * 0.6, c.radius * 2), mat)
    hull.rotation.set(rand() * 3, rand() * 3, rand() * 3)
    group.add(hull)
  }
  group.position.copy(c.position)
  return group
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}

function streamCelestials(now: number): void {
  if (now - lastStream < 800) return
  lastStream = now
  const nearby = queryCelestials(ship.position, STREAM_RADIUS)
  const liveIds = new Set(nearby.map((c) => c.id))
  for (const [id, mesh] of spawnedBodies) {
    if (!liveIds.has(id)) {
      scene.remove(mesh)
      disposeObject(mesh)
      spawnedBodies.delete(id)
    }
  }
  for (const c of nearby) {
    if (!spawnedBodies.has(c.id)) {
      const mesh = buildCelestial(c)
      scene.add(mesh)
      spawnedBodies.set(c.id, mesh)
    }
  }
}

// --- Player & hangar
const PLAYER_TINT = 0x4f8a5f
const SHIP_PRICES: Record<ShipType, number> = { hauler: 0, fighter: 3000, miner: 4000, interceptor: 6000 }

function loadHangar(): { selected: ShipType; owned: ShipType[] } {
  try {
    const raw = localStorage.getItem('scc.hangar.v1')
    if (raw) {
      const p = JSON.parse(raw)
      const owned: ShipType[] = Array.isArray(p?.owned) ? p.owned.filter((t: string) => t in SHIP_STATS) : ['hauler']
      const selected: ShipType = (p?.selected in SHIP_STATS) ? p.selected : 'hauler'
      if (!owned.includes('hauler')) owned.push('hauler')
      return { selected: owned.includes(selected) ? selected : 'hauler', owned }
    }
  } catch { /* fall through */ }
  return { selected: 'hauler', owned: ['hauler'] }
}
const hangar = loadHangar()
let selectedShipType: ShipType = hangar.selected
const ownedShips = new Set<ShipType>(hangar.owned)
function saveHangar(): void {
  try {
    localStorage.setItem('scc.hangar.v1', JSON.stringify({ selected: selectedShipType, owned: [...ownedShips] }))
  } catch { /* ignore */ }
}

const ship = createShipState(new THREE.Vector3(0, 0, 0))
let shipMesh = buildCraft(selectedShipType, PLAYER_TINT)
scene.add(shipMesh)

// --- Mining VFX: cyan laser beam + impact glow + floating +ORE text
const beamMat = new THREE.MeshBasicMaterial({
  color: 0x6fe8ff, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.7, 1, 6, 1, true), beamMat)
beam.visible = false
const impactMat = new THREE.MeshBasicMaterial({
  color: 0xaef6ff, transparent: true, opacity: 0.8,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
const impact = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 10), impactMat)
impact.visible = false
scene.add(beam, impact)
const oreFloats: { obj: CSS2DObject; born: number }[] = []
let oreAccum = 0
let lastFloat = 0
const _beamUp = new THREE.Vector3(0, 1, 0)
const _beamDir = new THREE.Vector3()

// --- Combat state
const playerHealth = createHealth(SHIP_STATS[selectedShipType].hull)
const playerWeapon = createWeapon(0.16)
const projectiles: Projectile[] = []
const projectileMeshes = new Map<Projectile, THREE.Mesh>()
const pirates: Pirate[] = []
const pirateMeshes = new Map<string, THREE.Group>()
const explosions: { mesh: THREE.Mesh; born: number }[] = []
let weaponActive = false
let pirateSpawnCount = 0
let nextSpawnAt = Infinity
const MAX_PIRATES = 3
const _fwd = new THREE.Vector3()

// Safe zones — no pirates near the hand-placed outposts. Trade routes between them are risky;
// arriving at a station means you can breathe.
const SAFE_RADIUS = 1600
const SAFE_ANCHORS = [new THREE.Vector3(0, 0, 0), REFINERY_POS, COLONY_POS]
function inSafeZone(pos: THREE.Vector3): boolean {
  return SAFE_ANCHORS.some((a) => pos.distanceToSquared(a) < SAFE_RADIUS * SAFE_RADIUS)
}

// --- Quantum travel
const quantum = createQuantum()
const _qLook = new THREE.Vector3()
let jumpTargetName = '' // destination of the current jump (for the HUD)
let navCache: { name: string; dist: number } | null = null
let lastNav = -Infinity

const _navDir = new THREE.Vector3()
/** Nearest jump destination — arrival point sits just OFF the body's surface (not its center),
 *  so the quantum drop-out lands you outside it, never inside. */
function nearestJumpTarget(): { position: THREE.Vector3; name: string } | null {
  let best: { position: THREE.Vector3; name: string } | null = null
  let bestD = Infinity
  const consider = (center: THREE.Vector3, radius: number, name: string): void => {
    const d = center.distanceToSquared(ship.position)
    if (d >= bestD) return
    bestD = d
    _navDir.copy(ship.position).sub(center)
    if (_navDir.lengthSq() < 1) _navDir.set(0, 0, 1)
    _navDir.normalize()
    best = { position: center.clone().addScaledVector(_navDir, radius * 1.5), name }
  }
  for (const planet of PLANETS) consider(planet.position, planet.radius, planet.name)
  for (const c of queryCelestials(ship.position, STREAM_RADIUS)) {
    if (c.type !== 'planet' && c.type !== 'moon' && c.type !== 'station') continue
    consider(c.position, c.radius, c.type === 'station' ? 'Station' : c.type === 'moon' ? 'Moon' : 'Planet')
  }
  return best
}

/** Throttled nearest-target lookup for the idle "press J to jump" HUD. */
function updateNavCache(now: number): void {
  if (now - lastNav < 400) return
  lastNav = now
  const t = nearestJumpTarget()
  navCache = t ? { name: t.name, dist: ship.position.distanceTo(t.position) } : null
}

const _toShip = new THREE.Vector3()
/** Stop the ship flying through the sun/planets: clamp to the surface, kill inward velocity (slide). */
function resolvePlanetCollisions(): void {
  const hit = (cx: number, cy: number, cz: number, radius: number): void => {
    _toShip.set(ship.position.x - cx, ship.position.y - cy, ship.position.z - cz)
    const dist = _toShip.length()
    const minDist = radius * 1.13 + 30 // sit above the surface (clears terrain displacement)
    if (dist < minDist && dist > 1e-3) {
      _toShip.multiplyScalar(1 / dist) // surface normal
      ship.position.set(cx, cy, cz).addScaledVector(_toShip, minDist)
      const vn = ship.velocity.dot(_toShip)
      if (vn < 0) ship.velocity.addScaledVector(_toShip, -vn)
    }
  }
  hit(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z, SUN_RADIUS)
  for (const p of PLANETS) hit(p.position.x, p.position.y, p.position.z, p.radius)
}

const boltGeo = new THREE.SphereGeometry(0.45, 6, 6)
const playerBoltMat = new THREE.MeshBasicMaterial({ color: 0x8ff0ff })
const pirateBoltMat = new THREE.MeshBasicMaterial({ color: 0xff7b4a })
const explosionGeo = new THREE.SphereGeometry(1, 10, 10)

function makeBolt(faction: 'player' | 'pirate'): THREE.Mesh {
  const mesh = new THREE.Mesh(boltGeo, faction === 'player' ? playerBoltMat : pirateBoltMat)
  mesh.scale.set(1, 1, 2.2) // elongated like a tracer
  return mesh
}

function spawnExplosion(pos: THREE.Vector3, now: number): void {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const mesh = new THREE.Mesh(explosionGeo, mat)
  mesh.position.copy(pos)
  scene.add(mesh)
  explosions.push({ mesh, born: now })
}

function damageFlash(): void {
  flashEl.style.opacity = '0.55'
  setTimeout(() => { flashEl.style.opacity = '0' }, 130)
}

function spawnPirateWave(now: number): void {
  if (pirates.length >= MAX_PIRATES) return
  if (inSafeZone(ship.position)) return
  const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
  const pirate = spawnPirate(`pir-${pirateSpawnCount}`, pos)
  pirates.push(pirate)
  const mesh = buildCraft('interceptor', 0xc0392b)
  mesh.position.copy(pos)
  scene.add(mesh)
  pirateMeshes.set(pirate.id, mesh)
  void now
}

function respawnPlayer(now: number): void {
  spawnExplosion(ship.position, now)
  audio.blip('explosion')
  damageFlash()
  ship.position.set(0, 0, 0)
  ship.velocity.set(0, 0, 0)
  playerHealth.hull = playerHealth.max
  econ.credits = Math.max(0, econ.credits - 100)
  refreshWallet()
}

function syncProjectileMeshes(): void {
  const live = new Set(projectiles)
  for (const [proj, mesh] of projectileMeshes) {
    if (!live.has(proj)) {
      scene.remove(mesh)
      projectileMeshes.delete(proj)
    }
  }
  for (const proj of projectiles) {
    let mesh = projectileMeshes.get(proj)
    if (!mesh) {
      mesh = makeBolt(proj.faction)
      scene.add(mesh)
      projectileMeshes.set(proj, mesh)
    }
    mesh.position.copy(proj.position)
    if (proj.velocity.lengthSq() > 1e-6) mesh.lookAt(proj.position.clone().add(proj.velocity))
  }
}

function updateExplosions(now: number): void {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i]
    const age = (now - e.born) / 650
    if (age >= 1) {
      scene.remove(e.mesh)
      explosions.splice(i, 1)
      continue
    }
    e.mesh.scale.setScalar(2 + age * 20)
    ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age)
  }
}

// --- Game systems (main owns all state; modules are pure)
const econ = loadEconomy()
const upgrades = loadUpgrades()
const market = createMarket()
const contracts = generateContracts(20260614, OUTPOSTS)
const audio = new GameAudio()

const dockTargets: DockTarget[] = [
  { id: 'refinery', position: REFINERY_POS },
  { id: 'colony', position: COLONY_POS },
]
let dockable: string | null = null
let docked = false
let miningActive = false
let lastSave = 0

// Effective stats = chosen craft's base + the delta the upgrade tiers add over a stock hauler.
const baseSpeed = SHIP_STATS.hauler.topSpeed
const baseBoost = SHIP_STATS.hauler.boostMultiplier
const baseCargo = SHIP_STATS.hauler.cargo
function effSpeed(): number { return SHIP_STATS[selectedShipType].topSpeed + (topSpeed(upgrades) - baseSpeed) }
function effBoost(): number { return SHIP_STATS[selectedShipType].boostMultiplier + (boostMultiplier(upgrades) - baseBoost) }
function effCargo(): number {
  return Math.max(1, Math.round(SHIP_STATS[selectedShipType].cargo + (cargoCapacity(upgrades) - baseCargo)))
}

function setPlayerCraft(type: ShipType): void {
  scene.remove(shipMesh)
  disposeObject(shipMesh)
  shipMesh = buildCraft(type, PLAYER_TINT)
  shipMesh.position.copy(ship.position)
  shipMesh.quaternion.copy(ship.quaternion)
  scene.add(shipMesh)
  selectedShipType = type
  playerHealth.max = SHIP_STATS[type].hull
  playerHealth.hull = playerHealth.max
  saveHangar()
}

function updateWalletHUD(): void {
  creditsEl.textContent = String(Math.floor(econ.credits))
  cargoEl.textContent = `${Math.floor(cargoUsed(econ))}/${effCargo()}`
}

function currentProgress(): PlayerProgress {
  return {
    credits: econ.credits,
    cargo: { ORE: econ.cargo.ORE, ALLOY: econ.cargo.ALLOY },
    upgrades: { cargo: upgrades.tiers.cargo, speed: upgrades.tiers.speed, boost: upgrades.tiers.boost },
    hangar: { selected: selectedShipType, owned: [...ownedShips] },
  }
}

function refreshWallet(): void {
  updateWalletHUD()
  saveEconomy(econ)
  saveUpgrades(upgrades)
  net.saveProgress(currentProgress())
}

const stationMenu = new StationMenu({
  onChange: refreshWallet,
  onUndock: undock,
})
document.body.appendChild(stationMenu.root)

function dock(id: string): void {
  docked = true
  miningActive = false
  dockPromptEl.hidden = true
  mineEl.hidden = true
  beam.visible = false
  impact.visible = false
  safeEl.hidden = true
  weaponActive = false
  ship.velocity.set(0, 0, 0)
  audio.setThrust(0, false)
  audio.setMining(false, false)
  audio.blip('dock')
  document.exitPointerLock()
  stationMenu.open({
    outpostId: id, econ, market, upgrades, contracts, audio,
    capacity: effCargo,
    selectedShip: () => selectedShipType,
    ownedShips,
    shipPrices: SHIP_PRICES,
    onBuyShip: (type) => {
      if (ownedShips.has(type) || econ.credits < SHIP_PRICES[type]) return
      econ.credits -= SHIP_PRICES[type]
      ownedShips.add(type)
      saveHangar()
      refreshWallet()
    },
    onSelectShip: (type) => {
      if (ownedShips.has(type)) setPlayerCraft(type)
    },
  })
}

function undock(): void {
  stationMenu.close()
  docked = false
  renderer.domElement.requestPointerLock()
}

// --- Input
const keys = new Set<string>()
let mousePitch = 0
let mouseYaw = 0
let assist = true

addEventListener('keydown', (e) => {
  if (chatOpen) return // chat input owns the keyboard while open
  if (e.code === 'Enter' && running && !docked) { openChat(); return }
  if (e.code === 'Space') e.preventDefault()
  if (e.repeat) return
  keys.add(e.code)
  if (e.code === 'KeyV') {
    assist = !assist
    assistEl.textContent = assist ? 'COUPLED' : 'DECOUPLED'
  }
  if (e.code === 'Space' && running && !docked && dockable) dock(dockable)
  if (e.code === 'KeyJ' && running && !docked) {
    if (quantum.phase === 'idle') {
      const t = nearestJumpTarget()
      if (t) { startTravel(quantum, t.position); jumpTargetName = t.name; audio.blip('dock') }
    } else {
      cancelTravel(quantum)
    }
  }
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return
  mouseYaw -= e.movementX * 0.0024
  mousePitch -= e.movementY * 0.0024
  mouseYaw = THREE.MathUtils.clamp(mouseYaw, -1, 1)
  mousePitch = THREE.MathUtils.clamp(mousePitch, -1, 1)
})
// Left mouse = mining laser, right mouse = weapon (only while flying, mouse captured).
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!(running && !docked && document.pointerLockElement === renderer.domElement)) return
  if (e.button === 0) miningActive = true
  if (e.button === 2) weaponActive = true
})
addEventListener('mouseup', (e) => {
  if (e.button === 0) miningActive = false
  if (e.button === 2) weaponActive = false
})

function readInput(): ControlInput {
  // Mouse deflection decays toward center — feels like a virtual joystick
  mousePitch *= 0.92
  mouseYaw *= 0.92
  return {
    thrust: new THREE.Vector3(
      (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0),
      (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    ),
    pitch: mousePitch,
    yaw: mouseYaw,
    roll: (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    brake: keys.has('KeyX'),
    assist,
  }
}

// --- Remote ships
interface RemoteShip { mesh: THREE.Group; peer: PeerState }
const remotes = new Map<string, RemoteShip>()
const PALETTE = [0xc75d5d, 0x5d8ac7, 0xc7a85d, 0x9b5dc7, 0x5dc7b8, 0xc75da6]

const net = new NetClient(nicknameEl.value || 'PILOT', playerToken, {
  onProgress(p) {
    // Server is the source of truth — adopt saved progress when it arrives.
    econ.credits = p.credits
    econ.cargo.ORE = p.cargo.ORE
    econ.cargo.ALLOY = p.cargo.ALLOY
    upgrades.tiers.cargo = p.upgrades.cargo
    upgrades.tiers.speed = p.upgrades.speed
    upgrades.tiers.boost = p.upgrades.boost
    ownedShips.clear()
    for (const t of p.hangar.owned) if (t in SHIP_STATS) ownedShips.add(t as ShipType)
    ownedShips.add('hauler')
    const sel = (p.hangar.selected in SHIP_STATS ? p.hangar.selected : 'hauler') as ShipType
    setPlayerCraft(ownedShips.has(sel) ? sel : 'hauler')
    saveEconomy(econ)
    saveUpgrades(upgrades)
    saveHangar()
    updateWalletHUD()
  },
  onPeerJoin(peer) {
    const mesh = buildCraft('hauler', PALETTE[peer.color % PALETTE.length])
    const label = document.createElement('div')
    label.className = 'nameplate'
    label.textContent = peer.name
    const labelObj = new CSS2DObject(label)
    labelObj.position.set(0, 2.2, 0)
    mesh.add(labelObj)
    mesh.position.fromArray(peer.p)
    scene.add(mesh)
    remotes.set(peer.id, { mesh, peer })
  },
  onPeerState() { /* interpolation reads peer buffers each frame */ },
  onPeerLeave(id) {
    const remote = remotes.get(id)
    if (remote) {
      scene.remove(remote.mesh)
      remotes.delete(id)
    }
  },
  onStatus(connected, online) {
    netEl.textContent = connected ? 'SECTOR LINK: ONLINE' : 'SECTOR LINK: OFFLINE (solo)'
    onlineEl.textContent = String(online)
  },
  onChat(name, text) {
    addChatLine(name, text)
  },
})

// --- Chat
let chatOpen = false
const chatLines: HTMLElement[] = []

function addChatLine(name: string, text: string): void {
  const line = document.createElement('div')
  line.className = 'chat-line'
  const who = document.createElement('b')
  who.textContent = `${name}: `
  line.append(who, document.createTextNode(text)) // textContent — never innerHTML (no XSS)
  chatLogEl.appendChild(line)
  chatLines.push(line)
  while (chatLines.length > 7) chatLines.shift()?.remove()
  setTimeout(() => {
    line.style.opacity = '0'
    setTimeout(() => line.remove(), 600)
  }, 9000)
}

function openChat(): void {
  if (chatOpen || !running || docked) return
  chatOpen = true
  document.exitPointerLock()
  chatInputEl.hidden = false
  chatInputEl.value = ''
  chatInputEl.focus()
}

function closeChat(): void {
  chatOpen = false
  chatInputEl.hidden = true
  chatInputEl.blur()
  if (running && !docked) renderer.domElement.requestPointerLock()
}

chatInputEl.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.code === 'Enter') {
    const text = chatInputEl.value.trim()
    if (text && !net.sendChat(text)) addChatLine(nicknameEl.value || 'PILOT', text) // offline: echo locally
    closeChat()
  } else if (e.code === 'Escape') {
    closeChat()
  }
})

const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _pa = new THREE.Vector3()
const _pb = new THREE.Vector3()

function updateRemotes(): void {
  const renderTime = performance.now() - INTERP_DELAY_MS
  for (const { mesh, peer } of remotes.values()) {
    if (peer.prev && peer.receivedAt > peer.prev.receivedAt) {
      const span = peer.receivedAt - peer.prev.receivedAt
      const alpha = THREE.MathUtils.clamp((renderTime - peer.prev.receivedAt) / span, 0, 1.25)
      _pa.fromArray(peer.prev.p); _pb.fromArray(peer.p)
      mesh.position.lerpVectors(_pa, _pb, alpha)
      _qa.fromArray(peer.prev.q); _qb.fromArray(peer.q)
      mesh.quaternion.slerpQuaternions(_qa, _qb, Math.min(alpha, 1))
    } else {
      mesh.position.fromArray(peer.p)
      mesh.quaternion.fromArray(peer.q)
    }
  }
}

// --- Mining VFX helpers
function updateMiningVFX(active: boolean, target: THREE.Vector3 | null, now: number): void {
  if (!active || !target) {
    beam.visible = false
    impact.visible = false
    return
  }
  _beamDir.subVectors(target, shipMesh.position)
  const len = _beamDir.length()
  beam.position.copy(shipMesh.position).addScaledVector(_beamDir, 0.5)
  beam.scale.set(1, len, 1)
  beam.quaternion.setFromUnitVectors(_beamUp, _beamDir.normalize())
  beamMat.opacity = 0.4 + 0.25 * Math.sin(now * 0.04)
  beam.visible = true
  impact.position.copy(target)
  impact.scale.setScalar(1 + 0.3 * Math.sin(now * 0.02))
  impact.visible = true
}

function spawnOreFloat(amount: number, pos: THREE.Vector3, now: number): void {
  const div = document.createElement('div')
  div.className = 'ore-float'
  div.textContent = `+${amount} ORE`
  const obj = new CSS2DObject(div)
  obj.position.copy(pos)
  scene.add(obj)
  oreFloats.push({ obj, born: now })
}

function updateOreFloats(now: number): void {
  for (let i = oreFloats.length - 1; i >= 0; i--) {
    const f = oreFloats[i]
    const age = (now - f.born) / 1300
    if (age >= 1) {
      scene.remove(f.obj)
      oreFloats.splice(i, 1)
      continue
    }
    f.obj.position.y += 0.07
    ;(f.obj.element as HTMLElement).style.opacity = String(1 - age)
  }
}

// --- Chase camera
const camOffset = new THREE.Vector3()
const camTarget = new THREE.Vector3()
function updateCamera(dt: number): void {
  camOffset.set(0, 3.2, 9.5).applyQuaternion(ship.quaternion)
  camTarget.copy(ship.position).add(camOffset)
  camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt))
  camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-10 * dt))
}

// --- Launch flow
function launch(): void {
  const callsign = nicknameEl.value.trim() || 'PILOT'
  localStorage.setItem('callsign', callsign)
  net.setName(callsign) // net was created before the callsign was typed — sync it now
  if (statsTimer) clearInterval(statsTimer)
  overlayEl.hidden = true
  overlayEl.style.display = 'none'
  hudEl.hidden = false
  statusEl.hidden = false
  helpEl.hidden = false
  crosshairEl.hidden = false
  walletEl.hidden = false
  minimapWrapEl.hidden = false
  refreshWallet()
  hullBarEl.style.width = '100%'
  nextSpawnAt = performance.now() + 8000 // first hostiles arrive after ~8s
  audio.init()
  audio.resume()
  renderer.domElement.requestPointerLock()
  net.connect()
  running = true
}
launchEl.addEventListener('click', launch)
nicknameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch() })
renderer.domElement.addEventListener('click', () => {
  if (running && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock()
  }
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  labelRenderer.setSize(innerWidth, innerHeight)
})

// --- Main loop
let running = false
let last = performance.now()

// --- Minimap (top-down radar, north-up, player-centered)
const MAP_RANGE = 4500 // world units from player to minimap edge
function drawMinimap(): void {
  const w = minimapCanvas.width
  const c = w / 2
  const R = c - 4
  mctx.clearRect(0, 0, w, w)
  mctx.strokeStyle = 'rgba(63,174,95,0.14)'
  mctx.beginPath(); mctx.arc(c, c, R * 0.5, 0, Math.PI * 2); mctx.stroke()

  const plot = (wx: number, wz: number, color: string, size: number, clampEdge: boolean, outline = false): void => {
    let mx = ((wx - ship.position.x) / MAP_RANGE) * R
    let my = ((wz - ship.position.z) / MAP_RANGE) * R
    const d = Math.hypot(mx, my)
    if (d > R) {
      if (!clampEdge) return
      mx = (mx / d) * R; my = (my / d) * R
    }
    mctx.fillStyle = color
    mctx.beginPath(); mctx.arc(c + mx, c + my, size, 0, Math.PI * 2); mctx.fill()
    if (outline) {
      mctx.strokeStyle = 'rgba(255,255,255,0.85)'; mctx.lineWidth = 1
      mctx.stroke()
    }
  }

  for (const mesh of spawnedBodies.values()) plot(mesh.position.x, mesh.position.z, 'rgba(150,170,190,0.55)', 1.4, false)
  plot(SUN_POSITION.x, SUN_POSITION.z, '#fff0be', 3, true)
  for (const planet of PLANETS) plot(planet.position.x, planet.position.z, '#9bb8e0', 2, true)
  plot(REFINERY_POS.x, REFINERY_POS.z, '#6fdc8c', 3.4, true, true)
  plot(COLONY_POS.x, COLONY_POS.z, '#ffb347', 3.4, true, true)
  for (const p of pirates) plot(p.position.x, p.position.z, '#ff5d5d', 2.2, false)

  // player heading arrow at center
  _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
  const ang = Math.atan2(_fwd.x, -_fwd.z)
  mctx.save(); mctx.translate(c, c); mctx.rotate(ang)
  mctx.fillStyle = '#9fffb0'
  mctx.beginPath(); mctx.moveTo(0, -5); mctx.lineTo(3.5, 4); mctx.lineTo(-3.5, 4); mctx.closePath(); mctx.fill()
  mctx.restore()
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now

  station.rotation.z += dt * 0.05
  colony.rotation.y += dt * 0.03
  starfield.position.copy(ship.position) // keep the star backdrop centered on the player
  if (running) {
    streamCelestials(now)
    for (const lod of planetLODs) lod.update(camera) // swap planet detail by distance
  }

  if (running && !docked && quantum.phase !== 'idle') {
    // Quantum jump in progress: the drive flies the ship; normal flight/combat is suspended.
    const qr = stepQuantum(quantum, ship.position, ship.velocity, dt)
    shipMesh.position.copy(ship.position)
    if (ship.velocity.lengthSq() > 1) {
      _qLook.copy(ship.position).add(ship.velocity)
      shipMesh.lookAt(_qLook)
      ship.quaternion.copy(shipMesh.quaternion)
    }
    quantumEl.hidden = false
    quantumEl.textContent = qr.phase === 'spooling'
      ? `QUANTUM SPOOLING → ${jumpTargetName}…`
      : `QUANTUM TRAVEL → ${jumpTargetName} · ${Math.round(qr.progress * 100)}%`
    navHintEl.textContent = ''
    audio.setThrust(qr.phase === 'traveling' ? 1 : 0.2, qr.phase === 'traveling')
    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
    )
  } else if (running && !docked) {
    // Idle: small nav hint under the minimap (no big banner).
    quantumEl.hidden = true
    updateNavCache(now)
    navHintEl.textContent = navCache ? `[J] jump → ${navCache.name} · ${(navCache.dist / 1000).toFixed(1)} km` : ''
    const input = readInput()
    stepShip(ship, input, dt, { maxSpeed: effSpeed(), boostMultiplier: effBoost() })
    resolvePlanetCollisions()
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)

    speedEl.textContent = String(Math.round(ship.velocity.length()))
    boostEl.style.visibility = input.boost ? 'visible' : 'hidden'

    // Engine audio tracks commanded thrust.
    audio.setThrust(Math.min(1, input.thrust.length()), input.boost)

    // Market prices drift back toward base over time.
    marketStep(market, dt)

    // Mining: transfer ORE from the nearest in-range asteroid while the laser is held.
    const mineResult = mineStep(field, ship.position, econ, dt, miningActive, effCargo())
    if (mineResult.mined > 0 && mineResult.asteroid) {
      updateWalletHUD()
      const rm = rockMeshes.get(mineResult.asteroid.id)
      if (rm) {
        const ratio = Math.max(0, mineResult.asteroid.reserves / rm.initial)
        rm.mesh.scale.setScalar(0.3 + 0.7 * ratio)
        if (mineResult.asteroid.reserves <= 0) rm.mesh.visible = false
      }
      // Accumulate mined ORE into periodic floating "+N ORE" cues.
      oreAccum += mineResult.mined
      if (now - lastFloat > 500 && oreAccum >= 1) {
        spawnOreFloat(Math.floor(oreAccum), mineResult.asteroid.position, now)
        oreAccum -= Math.floor(oreAccum)
        lastFloat = now
      }
      if (now - lastSave > 2000) { saveEconomy(econ); net.saveProgress(currentProgress()); lastSave = now }
    }
    updateMiningVFX(miningActive && mineResult.inRange, mineResult.asteroid?.position ?? null, now)
    audio.setMining(miningActive, mineResult.inRange)
    mineEl.hidden = !(miningActive && mineResult.inRange)

    dockable = dockableTarget(ship.position, ship.velocity.length(), dockTargets)
    dockPromptEl.hidden = dockable === null

    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
    )

    // --- Combat
    stepWeapon(playerWeapon, dt)
    if (weaponActive && canFire(playerWeapon)) {
      _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
      projectiles.push(spawnProjectile(ship.position, _fwd, 'player'))
      fireWeapon(playerWeapon)
      audio.blip('fire')
    }

    // Safe zone: near an outpost, hostiles break off and leave you alone.
    const safe = inSafeZone(ship.position)
    safeEl.hidden = !safe
    if (safe && pirates.length) {
      for (const p of pirates) {
        const mesh = pirateMeshes.get(p.id)
        if (mesh) { scene.remove(mesh); pirateMeshes.delete(p.id) }
      }
      pirates.splice(0)
      for (let i = projectiles.length - 1; i >= 0; i--) {
        if (projectiles[i].faction === 'pirate') projectiles.splice(i, 1)
      }
    }

    if (!safe && now >= nextSpawnAt) {
      spawnPirateWave(now)
      nextSpawnAt = now + 15000
    }

    for (const pirate of pirates) {
      const r = stepPirate(pirate, ship.position, dt)
      if (r.fired) projectiles.push(r.fired) // pirate fire is silent — many at once would be noise
      const mesh = pirateMeshes.get(pirate.id)
      if (mesh) {
        mesh.position.copy(pirate.position)
        mesh.lookAt(ship.position)
      }
    }

    stepProjectiles(projectiles, dt)

    const targets: HitTarget[] = [
      { position: ship.position, radius: 4, health: playerHealth, faction: 'player' },
      ...pirates.map((p) => ({ position: p.position, radius: 5, health: p.health, faction: 'pirate' as const })),
    ]
    const hits = resolveHits(projectiles, targets)
    for (const h of hits) {
      audio.blip('hit')
      if (h.target.faction === 'player') damageFlash()
    }

    for (let i = pirates.length - 1; i >= 0; i--) {
      if (isDead(pirates[i].health)) {
        const p = pirates[i]
        spawnExplosion(p.position, now)
        audio.blip('explosion')
        econ.credits += PIRATE_REWARD
        refreshWallet()
        const mesh = pirateMeshes.get(p.id)
        if (mesh) { scene.remove(mesh); pirateMeshes.delete(p.id) }
        pirates.splice(i, 1)
      }
    }

    if (isDead(playerHealth)) respawnPlayer(now)

    syncProjectileMeshes()
    hullBarEl.style.width = `${Math.round(hullFraction(playerHealth) * 100)}%`
    enemiesEl.textContent = String(pirates.length)
  }

  if (running) {
    updateRemotes()
    updateCamera(dt)
    drawMinimap()
  } else {
    // Menu background: slow orbit around the station
    const t = now * 0.0001
    camera.position.set(Math.cos(t) * 220 + 120, 60, Math.sin(t) * 220 - 350)
    camera.lookAt(station.position)
  }

  updateOreFloats(now)
  updateExplosions(now)

  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}
requestAnimationFrame(frame)
