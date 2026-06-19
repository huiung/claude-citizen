import '@fontsource/share-tech-mono/400.css' // HUD / body — self-hosted, OS-consistent
import '@fontsource/orbitron/700.css' // title display — sci-fi
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { createShipState, stepShip, type ControlInput } from './sim/physics'
import { buildCraft, loadCapitalCarrierModel, loadCapitalModel, loadCraftModelForType, loadPirateModel } from './render/shipyard'
import { SHIP_STATS, type ShipType } from './sim/shipTypes'
import { nextRank, rankForCredits, rankProgress } from './sim/ranks'
import {
  buildAsteroids, buildColony, buildLights, buildMineableAsteroid, buildPlanet,
  buildCapitalShip, buildDustField, buildLootCrate, buildNebula, buildSolarPlanet, buildStarfield, buildStation,
  buildMuchLaunchTower, buildSun, buildWarpField, COLONY_POS, REFINERY_POS, SPAWN_PLANET, updateDustField, updateWarpField,
} from './render/world'
import { PLANETS, SUN_COLOR, SUN_POSITION, SUN_RADIUS, type SurfaceKind } from './sim/solarSystem'
import { NetClient, type PeerState, type PlayerProgress } from './net/client'
import { dockableTarget, type DockTarget } from './sim/docking'
import { cargoUsed, gainCredits, loadEconomy, OUTPOSTS, saveEconomy } from './sim/economy'
import { createAsteroidField, mineStep } from './sim/mining'
import { createMarket, step as marketStep } from './sim/market'
import { generateContracts } from './sim/contracts'
import { boostMultiplier, cargoCapacity, loadUpgrades, miningYield, saveUpgrades, topSpeed } from './sim/upgrades'
import { type Celestial, queryCelestials } from './sim/galaxy'
import { generatePlanetTextures, samplePlanetSurface, type PlanetTextureKind } from './render/planetTextures'
import { makeAsteroidMaterial } from './render/asteroidTextures'
import { cancelTravel, createQuantum, QUANTUM_TUNING, startTravel, stepQuantum } from './sim/quantum'
import {
  canFire, createHealth, createWeapon, fire as fireWeapon, type HitTarget, hullFraction,
  isDead, type Projectile, PROJECTILE_SPEED, resolveHits, spawnProjectile, stepProjectiles, stepWeapon,
} from './sim/combat'
import { type Pirate, PIRATE_REWARD, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
import { GameAudio } from './audio/sound'
import { StationMenu } from './ui/stationMenu'
import { SolarSystemMap, type SolarMapDestinationResult, type SolarMapNavigationTarget } from './ui/solarSystemMap'
import { activeIdentity, loadWalletSession, saveWalletSession } from './net/identity'
import { connectWallet, signMessage, hasWallet, WalletError, NO_WALLET } from './net/wallet'
import { inject as injectAnalytics } from '@vercel/analytics'

injectAnalytics() // Vercel Web Analytics (no-op off Vercel / in dev)

const INTERP_DELAY_MS = 120
const CAPTURE_OG = new URLSearchParams(location.search).get('capture') === 'og'

// --- DOM
const appEl = document.getElementById('app')!
const overlayEl = document.getElementById('overlay')!
const nicknameEl = document.getElementById('nickname') as HTMLInputElement
const launchEl = document.getElementById('launch') as HTMLButtonElement
const hudEl = document.getElementById('hud')!
const statusEl = document.getElementById('status')!
const helpEl = document.getElementById('help')!
const crosshairEl = document.getElementById('crosshair')!
const combatCanvas = document.getElementById('combat-overlay') as HTMLCanvasElement
const cctx = combatCanvas.getContext('2d')!
combatCanvas.width = innerWidth
combatCanvas.height = innerHeight
const speedEl = document.getElementById('speed')!
const assistEl = document.getElementById('assist')!
const boostEl = document.getElementById('boost')!
const netEl = document.getElementById('net')!
const onlineEl = document.getElementById('online')!
const walletEl = document.getElementById('wallet')!
const creditsEl = document.getElementById('credits')!
const cargoEl = document.getElementById('cargo')!
const rankNameEl = document.getElementById('rank-name')!
const rankBarEl = document.getElementById('rank-bar')!
const rankNextEl = document.getElementById('rank-next')!
const promotionEl = document.getElementById('promotion')!
const depthLabelEl = document.getElementById('depth-label')!
const depthBarEl = document.getElementById('depth-bar')!
const altLineEl = document.getElementById('alt-line')!
const altLabelEl = document.getElementById('alt-label')!
const atmoVeilEl = document.getElementById('atmo-veil')!
let lastRankIndex = -1 // -1 until first HUD update, so we don't announce a "promotion" on load
let promoTimer: ReturnType<typeof setTimeout> | undefined
function showPromotion(name: string): void {
  promotionEl.textContent = `⭐ PROMOTED — ${name}`
  promotionEl.hidden = false
  promotionEl.style.opacity = '1'
  clearTimeout(promoTimer)
  promoTimer = setTimeout(() => {
    promotionEl.style.opacity = '0'
    setTimeout(() => { promotionEl.hidden = true }, 500)
  }, 3200)
}
const dockPromptEl = document.getElementById('dock-prompt')!
const mineEl = document.getElementById('mine-prompt')!
const hullBarEl = document.getElementById('hull-bar')!
const enemiesEl = document.getElementById('enemies')!
const flashEl = document.getElementById('damage-flash')!
const quantumEl = document.getElementById('quantum')!
const navHintEl = document.getElementById('nav-hint')!
const objectiveEl = document.getElementById('objective')!
// Onboarding: show a "next objective" only to brand-new pilots. localStorage gate (this device
// hasn't onboarded) is the fast path; a returning token with saved progress also disables it.
let onboardingActive = !CAPTURE_OG && !localStorage.getItem('scc.onboarded')
let sessionKicked = false // signed in elsewhere — freeze the objective HUD on the warning
// Onboarding progress is persisted so a refresh keeps your step (and graduating sticks),
// even without a relay connection.
let minedEver = localStorage.getItem('scc.ob.mined') === '1'
let dockedEver = localStorage.getItem('scc.ob.docked') === '1'
function markOnboard(key: string, set: (v: true) => void): void {
  set(true)
  try { localStorage.setItem(key, '1') } catch { /* storage blocked */ }
}
function finishOnboarding(): void {
  onboardingActive = false
  try { localStorage.setItem('scc.onboarded', '1') } catch { /* storage blocked */ }
}
/** Action-gated steps — just *show* each system, no forced grind:
 *  mine once → open the station (Space) → kill a pirate → done. */
function currentObjective(): string | null {
  if (!onboardingActive) return null
  if (!minedEver) return 'Mine ORE — fly to a cyan-veined asteroid and hold Left-click'
  if (!dockedEver) return 'Dock at an outpost (Space) — trade, upgrade & buy ships here'
  return 'Hunt a pirate — hold Right-click to fire (watch your hull)' // killing one calls finishOnboarding()
}
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

// Wallet session (optional, secondary to the anonymous Pilot Code). When linked, the verified
// pubkey becomes the active identity; otherwise the anonymous token is used.
let walletSession = loadWalletSession(localStorage)
const identity = activeIdentity(playerToken, walletSession)

// Pilot Code = the anonymous token, surfaced so players can back it up / restore on another device.
const myCodeEl = document.getElementById('my-code')!
const copyCodeBtn = document.getElementById('copy-code')!
const restoreCodeEl = document.getElementById('restore-code') as HTMLInputElement
const restoreBtn = document.getElementById('restore-btn')!
const pcStatusEl = document.getElementById('pc-status')!
myCodeEl.textContent = playerToken
copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(playerToken).then(
    () => { pcStatusEl.textContent = 'Copied — keep it safe to restore on another device.' },
    () => { pcStatusEl.textContent = 'Copy failed — select the code and copy manually.' },
  )
})
restoreBtn.addEventListener('click', () => {
  const code = restoreCodeEl.value.trim()
  if (!code) { pcStatusEl.textContent = 'Paste a Pilot Code first.'; return }
  if (code === playerToken) { pcStatusEl.textContent = "That's already your current code."; return }
  localStorage.setItem('scc.token', code)
  pcStatusEl.textContent = 'Loaded — reconnecting…'
  setTimeout(() => location.reload(), 400)
})

// Connect Wallet (optional, SIWS) — link a Solana wallet to claim the pilot. Anonymous play is unaffected.
// Declared here (before NetClient) so the auth callbacks in the events object can see them.
const connectWalletBtn = document.getElementById('connect-wallet') as HTMLButtonElement
const walletStatusEl = document.getElementById('wallet-status')!
let pendingPubkey: string | null = null
let netConnected = false // kept in sync by NetEvents.onStatus — auth needs a live socket

function setWalletStatus(text: string): void { walletStatusEl.textContent = text }

/** Lock the button once a wallet is linked — the server rejects re-auth on a live connection. */
function lockWalletButton(pubkey: string): void {
  connectWalletBtn.disabled = true
  connectWalletBtn.textContent = `✓ ${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`
}

if (walletSession) { lockWalletButton(walletSession.pubkey); setWalletStatus('Wallet linked.') }

connectWalletBtn.addEventListener('click', () => {
  if (!hasWallet()) { setWalletStatus('No Solana wallet found — install Phantom.'); return }
  if (!netConnected) { setWalletStatus('Not connected to server — try again in a moment.'); return }
  setWalletStatus('Connecting…')
  connectWallet().then((pubkey) => {
    pendingPubkey = pubkey
    setWalletStatus('Approve the signature in your wallet…')
    net?.requestChallenge(pubkey)
  }).catch((e) => {
    setWalletStatus(e instanceof WalletError && e.message === NO_WALLET
      ? 'No Solana wallet found — install Phantom.'
      : 'Connection cancelled.')
  })
})

// Landing stats (online / registered pilots) from the relay's /stats endpoint.
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:8080`
const STATS_URL = WS_URL.replace(/^ws/, 'http') + '/stats'
const LEADERBOARD_URL = WS_URL.replace(/^ws/, 'http') + '/leaderboard'
const lbListLandingEl = document.getElementById('lb-list-landing')!
const lbListHudEl = document.getElementById('lb-list-hud')!
const leaderboardPanelEl = document.getElementById('leaderboard-panel')!
let statsTimer: ReturnType<typeof setInterval> | undefined

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}
function renderLeaderboard(listEl: HTMLElement, rows: Array<{ name: string; earned: number }>): void {
  if (!rows.length) { listEl.innerHTML = '<li class="lb-empty">no pilots yet — be the first</li>'; return }
  listEl.innerHTML = rows.map((r, i) => {
    const cr = Number(r.earned) || 0
    return `<li><span class="rank">${i + 1}</span><span class="nm">${escapeHtml(String(r.name))}</span>`
      + `<span class="cr">[${rankForCredits(cr).name}] ${cr.toLocaleString()} cr</span></li>`
  }).join('')
}
function fetchLeaderboard(listEl: HTMLElement): void {
  fetch(LEADERBOARD_URL).then((r) => r.json())
    .then((rows) => renderLeaderboard(listEl, Array.isArray(rows) ? rows : []))
    .catch(() => { /* relay offline */ })
}
function refreshLandingStats(): void {
  fetch(STATS_URL)
    .then((r) => r.json())
    .then((d) => {
      statOnlineEl.textContent = String(d.online ?? '—')
      statRegisteredEl.textContent = String(d.registered ?? '—')
    })
    .catch(() => { /* relay offline — leave placeholders */ })
  fetchLeaderboard(lbListLandingEl)
}
refreshLandingStats()
statsTimer = setInterval(refreshLandingStats, 6000)

// --- Renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping // filmic highlights — plays well with bloom
renderer.toneMappingExposure = 1.15
appEl.appendChild(renderer.domElement)

function requestFlightPointerLock(): void {
  if (document.pointerLockElement === renderer.domElement) return
  if (typeof renderer.domElement.requestPointerLock !== 'function') return
  const lockRequest = renderer.domElement.requestPointerLock()
  if (lockRequest instanceof Promise) lockRequest.catch(() => { /* Pointer lock can be denied in inactive tabs or automation. */ })
}

const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(innerWidth, innerHeight)
labelRenderer.domElement.style.position = 'fixed'
labelRenderer.domElement.style.top = '0'
labelRenderer.domElement.style.pointerEvents = 'none'
appEl.appendChild(labelRenderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010206)
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 500000)

// Bloom post-processing: make the sun, engines, lasers and lit windows actually glow.
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.85) // strength, radius, threshold
composer.addPass(bloomPass)

const nebula = buildNebula()
scene.add(nebula)
const starfield = buildStarfield()
scene.add(starfield, buildPlanet(), buildAsteroids())

const dustField = buildDustField() // parallax motes — sense of speed in flight
scene.add(dustField)
const warpField = buildWarpField() // quantum hyperspace streaks (camera-local)
camera.add(warpField)
scene.add(camera) // camera must be in the graph for its child (warp) to render

const station = buildStation()
const colony = buildColony()
scene.add(station, colony)

// Capital ship — set-dressing for scale. Parked off the spawn corridor; fly its length for awe.
// Keep a stable parent group so collision/flyby code works before and after the GLB loads.
type CapitalCollider = { p: THREE.Vector3; r: number }
type CapitalSetpiece = { root: THREE.Group; colliders: CapitalCollider[] }
const capitalSetpieces: CapitalSetpiece[] = []
const capital = new THREE.Group()
capital.add(buildCapitalShip())
capital.position.set(1000, 320, -2000)
capital.rotation.y = 0.5
scene.add(capital)
const capitalSetpiece: CapitalSetpiece = { root: capital, colliders: fitCapitalColliders(capital) } // procedural hull bounds until the GLB loads
capitalSetpieces.push(capitalSetpiece)
void loadCapitalModel().then((model) => {
  if (!model) return
  for (const child of [...capital.children]) {
    capital.remove(child)
    disposeObject(child)
  }
  capital.add(model)
  capitalSetpiece.colliders = fitCapitalColliders(capital) // refit to the GLB's actual bounds (any scale/axis)
})
const capitalCarrier = new THREE.Group()
capitalCarrier.add(buildCapitalShip(13))
capitalCarrier.position.set(-1450, 560, -2700)
capitalCarrier.rotation.set(0.08, -0.78, 0.03)
scene.add(capitalCarrier)
const capitalCarrierSetpiece: CapitalSetpiece = { root: capitalCarrier, colliders: fitCapitalColliders(capitalCarrier) }
capitalSetpieces.push(capitalCarrierSetpiece)
void loadCapitalCarrierModel().then((model) => {
  if (!model) return
  for (const child of [...capitalCarrier.children]) {
    capitalCarrier.remove(child)
    disposeObject(child)
  }
  capitalCarrier.add(model)
  capitalCarrierSetpiece.colliders = fitCapitalColliders(capitalCarrier)
})
const muchLaunchTower = new THREE.Group()
muchLaunchTower.add(buildMuchLaunchTower())
muchLaunchTower.position.set(-720, 110, -1280)
muchLaunchTower.rotation.set(0.02, 0.38, -0.04)
muchLaunchTower.scale.setScalar(1.25)
scene.add(muchLaunchTower)
capitalSetpieces.push({ root: muchLaunchTower, colliders: fitCapitalColliders(muchLaunchTower) })

// Named solar system — giant backdrop + quantum-travel targets. Trade/outposts stay local.
const sun = buildSun(SUN_RADIUS, SUN_COLOR)
sun.position.copy(SUN_POSITION)
scene.add(sun)
const sunLight = new THREE.PointLight(0xfff0be, 2.5, 0, 0) // no falloff — lights the whole system
sunLight.position.copy(SUN_POSITION)
scene.add(sunLight)
const planetLODs: THREE.LOD[] = []
const planetGroups: THREE.Group[] = []
for (const planet of PLANETS) {
  const mesh = buildSolarPlanet(planet.radius, planet.color, planet.hasRings, planet.surface, planet.seed)
  mesh.position.copy(planet.position)
  mesh.userData.spin = 0.004 + ((planet.seed % 100) / 100) * 0.012 // gentle, per-planet rotation
  scene.add(mesh)
  planetGroups.push(mesh)
  mesh.traverse((o) => { if (o instanceof THREE.LOD) planetLODs.push(o) })
}
buildLights(scene)

// Mineable ore — a dynamic pool that follows the player: depleted or distant rocks are
// removed and fresh veins respawn nearby, so no single spot is an infinite mine.
const field = createAsteroidField([])
const rockMeshes = new Map<string, { mesh: THREE.Group; initial: number; rare: boolean }>()
const ORE_TARGET = 7   // rocks kept near the player
const ORE_NEAR = 200   // closest a fresh vein spawns
const ORE_FAR = 850    // farthest
const ORE_CULL = 1200  // remove rocks beyond this from the player
// Deep space: effects (rare veins, danger) ramp with distance from origin, peaking at DEEP_REF.
const DEEP_REF = 60000
const ORE_RARE_BONUS = 150 // bonus credits per unit mined from a rare (gold) vein
function deepFactor(): number { return Math.min(1, ship.position.length() / DEEP_REF) }
let oreSeq = 0
let lastOreStream = 0
const _oreDir = new THREE.Vector3()
function spawnOreSite(): void {
  const a = Math.random() * Math.PI * 2
  const r = ORE_NEAR + Math.random() * (ORE_FAR - ORE_NEAR)
  _oreDir.set(Math.cos(a) * r, (Math.random() - 0.5) * 120, Math.sin(a) * r)
  const id = `ore-${oreSeq++}`
  // Deeper space mixes in rare gold veins — richer reserves + a credit jackpot when mined.
  const rare = Math.random() < deepFactor() * 0.55
  const reserves = rare
    ? 24 + Math.floor(Math.random() * 20) // richer
    : 10 + Math.floor(Math.random() * 13)
  const pos = ship.position.clone().add(_oreDir)
  field.asteroids.push({ id, position: pos, reserves })
  const mesh = buildMineableAsteroid(rare)
  mesh.position.copy(pos)
  scene.add(mesh)
  rockMeshes.set(id, { mesh, initial: reserves, rare })
}
function streamOre(): void {
  for (let i = field.asteroids.length - 1; i >= 0; i--) {
    const ast = field.asteroids[i]
    if (ast.reserves > 0 && ast.position.distanceTo(ship.position) <= ORE_CULL) continue
    const rm = rockMeshes.get(ast.id)
    if (rm) { scene.remove(rm.mesh); disposeObject(rm.mesh); rockMeshes.delete(ast.id) }
    field.asteroids.splice(i, 1)
  }
  while (field.asteroids.length < ORE_TARGET) spawnOreSite()
}

// --- Procedural galaxy: stream celestial bodies in/out around the player.
const STREAM_RADIUS = 55000
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

// Galaxy bodies are the barren backwater — cratered rock/moon worlds only. The vivid,
// varied surfaces (earth/venus/gas) are reserved for the named solar planets.
const GALAXY_KINDS: PlanetTextureKind[] = ['moon', 'rocky']

function buildCelestial(c: Celestial): THREE.Object3D {
  const rand = celestialRng(c.seed)
  const group = new THREE.Group()
  if (c.type === 'planet' || c.type === 'moon') {
    const isPlanet = c.type === 'planet'
    // Celestials carry no surface kind — derive a stable one from the seed, then texture it.
    const kind: PlanetTextureKind = isPlanet ? GALAXY_KINDS[Math.floor(rand() * GALAXY_KINDS.length)] : 'moon'
    // Low-saturation greys/browns — barren rock, not vivid worlds.
    const baseColor = new THREE.Color().setHSL(0.05 + rand() * 0.07, 0.2, 0.42).getHex()
    const segs = isPlanet ? 48 : 32
    const geo = new THREE.SphereGeometry(c.radius, segs, Math.max(16, segs >> 1))
    const maps = generatePlanetTextures(kind, c.seed, baseColor, 256, c.radius)
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: maps.colorMap, bumpMap: maps.bumpMap, bumpScale: c.radius * 0.025, roughness: 0.96, metalness: 0,
    }))
    group.add(body)
  } else if (c.type === 'asteroid-cluster') {
    const mat = makeAsteroidMaterial(c.seed, 0x6b6258, 256)
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

// Scatter spawns near the origin so pilots don't all stack on the same point (#1).
// Well inside the 1600 safe-zone radius, so you never spawn into pirates.
function randomSpawn(): THREE.Vector3 {
  if (CAPTURE_OG) return new THREE.Vector3(320, -18, 220)
  const a = Math.random() * Math.PI * 2
  const r = 200 + Math.random() * 400 // 200–600: visibly different, still well inside the 1600 safe zone
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 100, Math.sin(a) * r)
}
const _spawnUp = new THREE.Vector3(0, 1, 0)
const _spawnMat = new THREE.Matrix4()

const ship = createShipState(randomSpawn())
/** Aim the ship at the refinery on spawn, so new pilots open on somewhere to go. */
function faceRefinery(): void {
  _spawnMat.lookAt(ship.position, REFINERY_POS, _spawnUp)
  ship.quaternion.setFromRotationMatrix(_spawnMat)
}
faceRefinery()
let shipMesh = buildCraft(selectedShipType, PLAYER_TINT)
scene.add(shipMesh)

// Boost flare — an additive cone of exhaust that follows the ship (independent of which
// hull is equipped). Flares up on boost; stretches on the ignition kick. Bloom makes it pop.
const boostFlare = new THREE.Mesh(
  new THREE.ConeGeometry(0.7, 4, 14, 1, true),
  new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying float vT;
      void main() {
        vT = (position.y + 2.0) / 4.0; // 0 = nozzle (base), 1 = tail (tip)
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying float vT;
      void main() {
        float flick = 0.78 + 0.22 * sin(uTime * 20.0 + vT * 10.0); // plasma flicker
        vec3 hot = vec3(0.85, 0.96, 1.0);  // white-hot nozzle core
        vec3 cool = vec3(0.28, 0.60, 1.0); // cyan tail
        vec3 col = mix(hot, cool, vT);
        float a = uOpacity * (1.0 - vT) * flick; // bright at the nozzle, fades down the tail
        gl_FragColor = vec4(col, a);
      }
    `,
  }),
)
boostFlare.frustumCulled = false
scene.add(boostFlare)
const _flareBack = new THREE.Vector3()

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

// --- Loot: glowing crates dropped by pirates / floating in space. Magnet-collect for credits.
interface Loot { mesh: THREE.Group; value: number; rare: boolean }
const lootCrates: Loot[] = []
const LOOT_MAGNET = 70 // crates start drifting toward you within this range
const LOOT_PICKUP = 14 // collected within this range
let lastTreasure = 0
function spawnLoot(pos: THREE.Vector3): void {
  const rare = Math.random() < 0.12
  const value = rare ? 500 : 60 + Math.floor(Math.random() * 140)
  const mesh = buildLootCrate(rare)
  mesh.position.copy(pos)
  scene.add(mesh)
  lootCrates.push({ mesh, value, rare })
}
const explosions: { mesh: THREE.Mesh; born: number }[] = []
let weaponActive = false
let pirateSpawnCount = 0
let nextSpawnAt = Infinity
const MAX_PIRATES = 2
const _fwd = new THREE.Vector3()

// Safe zones — no pirates near the hand-placed outposts. Trade routes between them are risky;
// arriving at a station means you can breathe.
const SAFE_RADIUS = 1600
const SAFE_ANCHORS = [new THREE.Vector3(0, 0, 0), REFINERY_POS, COLONY_POS]
function inSafeZone(pos: THREE.Vector3): boolean {
  if (SAFE_ANCHORS.some((a) => pos.distanceToSquared(a) < SAFE_RADIUS * SAFE_RADIUS)) return true
  // Near a planet's surface, hostiles break off — descend to fly/admire in peace.
  // Reach scales with the body's radius so big and small worlds both feel safe at the surface.
  for (const p of [...PLANETS, SPAWN_PLANET]) {
    const reach = p.radius * 1.5 + SAFE_RADIUS
    if (pos.distanceToSquared(p.position) < reach * reach) return true
  }
  return false
}

// --- Quantum travel
const quantum = createQuantum()
const _qLook = new THREE.Vector3()
let jumpTargetName = '' // destination of the current jump (for the HUD)
let selectedJumpIdx = 0 // index into PLANETS (named solar system) — the quantum destination, cycled with [N]
interface QuantumDestination {
  id: string
  name: string
  kind: string
  position: THREE.Vector3
  radius?: number
}
let customJumpDestination: QuantumDestination | null = null

const _navDir = new THREE.Vector3()
function planetDestination(idx: number): QuantumDestination {
  const p = PLANETS[idx] ?? PLANETS[0]
  return {
    id: `planet.${p.name}`,
    name: p.name,
    kind: p.hasRings ? 'Ringed planet' : 'Planet',
    position: p.position.clone(),
    radius: p.radius,
  }
}

function activeQuantumDestination(): QuantumDestination {
  return customJumpDestination ?? planetDestination(selectedJumpIdx)
}

function activeDestinationSnapshot(): SolarMapNavigationTarget {
  const dest = activeQuantumDestination()
  return {
    id: dest.id,
    name: dest.name,
    kind: dest.kind,
    worldPosition: dest.position.clone(),
    radius: dest.radius,
  }
}

/** Arrival point just OFF the selected target's surface (never inside it), plus its name + distance. */
function destinationArrival(dest = activeQuantumDestination()): { position: THREE.Vector3; name: string; dist: number } {
  _navDir.copy(ship.position).sub(dest.position)
  if (_navDir.lengthSq() < 1) _navDir.set(0, 0, 1)
  _navDir.normalize()
  const standoff = dest.radius ? Math.max(dest.radius * 1.5, 650) : 0
  const position = dest.position.clone().addScaledVector(_navDir, standoff)
  return { position, name: dest.name, dist: ship.position.distanceTo(position) }
}

function setQuantumDestinationFromAtlas(target: SolarMapNavigationTarget): SolarMapDestinationResult {
  if (target.id === 'player' || target.id === 'sun' || target.id.startsWith('peer.')) {
    return { ok: false, reason: 'moving or reference-only target' }
  }
  const planetIdx = PLANETS.findIndex((p) => target.id === `planet.${p.name}` || target.name === p.name)
  if (planetIdx >= 0) {
    selectedJumpIdx = planetIdx
    customJumpDestination = null
    return { ok: true }
  }
  if (target.worldPosition.distanceTo(ship.position) < QUANTUM_TUNING.minTravelDistance) {
    return { ok: false, reason: 'target too close for quantum' }
  }
  customJumpDestination = {
    id: target.id,
    name: target.name,
    kind: target.kind,
    position: target.worldPosition.clone(),
    radius: target.radius,
  }
  return { ok: true }
}

/** Index of the closest named planet — seeds the selection so the first jump is sensible. */
function nearestPlanetIdx(): number {
  let idx = 0, bestD = Infinity
  for (let i = 0; i < PLANETS.length; i++) {
    const d = PLANETS[i].position.distanceToSquared(ship.position)
    if (d < bestD) { bestD = d; idx = i }
  }
  return idx
}

const _toShip = new THREE.Vector3()
const _t1 = new THREE.Vector3()
const _t2 = new THREE.Vector3()
const _probe = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
// Angular offsets (× probe radius) sampled around the ship's footprint to catch nearby peaks.
const PROBE_OFFSETS: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
/** Keep the ship above surfaces. Nearby solid planets clamp to the *sampled terrain height*
 *  under the ship (low flight over hills & valleys); the sun, gas giants and distant bodies
 *  use a fast spherical clamp. Inward velocity is killed so you slide along the surface. */
function resolvePlanetCollisions(): void {
  const hit = (cx: number, cy: number, cz: number, radius: number, surface?: SurfaceKind, seed = 0, color = 0x999999): void => {
    _toShip.set(ship.position.x - cx, ship.position.y - cy, ship.position.z - cz)
    const dist = _toShip.length()
    if (dist <= 1e-3) return
    _toShip.multiplyScalar(1 / dist) // surface normal
    let minDist: number
    if (surface && surface !== 'gas' && surface !== 'venus' && dist < radius * 2.5) {
      // Low altitude: follow the real terrain. Sample under the ship AND a ring of nearby
      // points, clamp to the *highest* — otherwise a peak beside us (while our footprint sits
      // in a valley) is ignored and we fly through it. Height matches the close LOD mesh
      // (height × radius × 0.055 × dispScale[=1.6]); a small clearance keeps us just above.
      _t1.crossVectors(_toShip, _up)
      if (_t1.lengthSq() < 1e-6) _t1.set(1, 0, 0) // over a pole — any tangent works
      _t1.normalize()
      _t2.crossVectors(_toShip, _t1).normalize()
      const off = 0.012 // angular probe radius around the ship's footprint
      let maxH = samplePlanetSurface(surface, seed, _toShip.x, _toShip.y, _toShip.z, color, radius).height
      for (const [a, b] of PROBE_OFFSETS) {
        _probe.copy(_toShip).addScaledVector(_t1, a * off).addScaledVector(_t2, b * off).normalize()
        const h = samplePlanetSurface(surface, seed, _probe.x, _probe.y, _probe.z, color, radius).height
        if (h > maxH) maxH = h
      }
      minDist = radius + maxH * radius * 0.055 * 1.6 + radius * 0.004 + 6
    } else {
      minDist = radius * 1.06 + 30 // sun / gas giants / distant: fast spherical clamp
    }
    if (dist < minDist) {
      ship.position.set(cx, cy, cz).addScaledVector(_toShip, minDist)
      const vn = ship.velocity.dot(_toShip)
      if (vn < 0) ship.velocity.addScaledVector(_toShip, -vn)
    }
  }
  hit(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z, SUN_RADIUS)
  for (const p of PLANETS) hit(p.position.x, p.position.y, p.position.z, p.radius, p.surface, p.seed, p.color)
  hit(SPAWN_PLANET.position.x, SPAWN_PLANET.position.y, SPAWN_PLANET.position.z, SPAWN_PLANET.radius)
}

// Capital ship hull — fit collision spheres along the longest axis of the *actual* bounding box,
// so it works for both the procedural hull and any GLB regardless of its scale or modelled axis.
const _capWorld = new THREE.Vector3()
function fitCapitalColliders(root: THREE.Group): CapitalCollider[] {
  // Measure in the parent's local space: zero out transform, get bounds, restore.
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const ctr = new THREE.Vector3()
  const savedPos = root.position.clone()
  const savedQuat = root.quaternion.clone()
  root.position.set(0, 0, 0)
  root.quaternion.identity()
  root.updateMatrixWorld(true)
  box.setFromObject(root)
  root.position.copy(savedPos)
  root.quaternion.copy(savedQuat)
  root.updateMatrixWorld(true)
  if (box.isEmpty()) return []
  box.getSize(size)
  box.getCenter(ctr)
  const dims = [size.x, size.y, size.z]
  let axis = 0 // longest axis = the hull's spine
  if (dims[1] > dims[axis]) axis = 1
  if (dims[2] > dims[axis]) axis = 2
  const len = dims[axis]
  const r = (dims[(axis + 1) % 3] + dims[(axis + 2) % 3]) * 0.25 + len * 0.04 // cross-section radius
  const cols: { p: THREE.Vector3; r: number }[] = []
  const n = 5
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5 // -0.5..0.5 along the spine
    const p = ctr.clone()
    p.setComponent(axis, ctr.getComponent(axis) + t * len * 0.8)
    cols.push({ p, r })
  }
  return cols
}
function resolveCapitalCollision(): void {
  for (const setpiece of capitalSetpieces) {
    for (const c of setpiece.colliders) {
      _capWorld.copy(c.p)
      setpiece.root.localToWorld(_capWorld) // local hull point → world (follows each ship's rotation/drift)
      _toShip.subVectors(ship.position, _capWorld)
      const dist = _toShip.length()
      if (dist < c.r && dist > 1e-3) {
        _toShip.multiplyScalar(1 / dist)
        ship.position.copy(_capWorld).addScaledVector(_toShip, c.r)
        const vn = ship.velocity.dot(_toShip)
        if (vn < 0) ship.velocity.addScaledVector(_toShip, -vn) // kill inward velocity → slide
      }
    }
  }
}

const boltGeo = new THREE.SphereGeometry(0.4, 8, 8)
const boltHaloGeo = new THREE.SphereGeometry(0.85, 8, 8)
const explosionGeo = new THREE.SphereGeometry(1, 10, 10)

// Per-ship-type bolt colors (player); pirates fire warm orange. Friendly hulls read cool/bright,
// hostiles read orange — so you can tell incoming fire apart at a glance.
const BOLT_COLORS: Record<ShipType, number> = {
  hauler: 0x8ff0ff, fighter: 0xffd23a, miner: 0xaef67a, interceptor: 0xc08aff,
}
const boltMatCache = new Map<string, THREE.MeshBasicMaterial>()
function boltMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}:${opacity}`
  let m = boltMatCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    boltMatCache.set(key, m)
  }
  return m
}

function makeBolt(faction: 'player' | 'pirate'): THREE.Mesh {
  const color = faction === 'player' ? BOLT_COLORS[selectedShipType] : 0xff7b4a
  // Bright additive core + soft halo → bloom turns it into a glowing plasma tracer (not a flat dot).
  const core = new THREE.Mesh(boltGeo, boltMat(color, 0.95))
  core.scale.set(1, 1, 2.6) // elongated tracer; z aligns to travel via lookAt
  const halo = new THREE.Mesh(boltHaloGeo, boltMat(color, 0.28))
  halo.scale.set(1, 1, 1.6)
  core.add(halo)
  return core
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
  const depth = deepFactor()
  if (pirates.length >= MAX_PIRATES + Math.round(depth * 2)) return // up to +2 more in deep space
  if (inSafeZone(ship.position)) return
  const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
  // Deeper space: tankier pirates worth a bigger bounty (risk scales with reward).
  const pirate = spawnPirate(`pir-${pirateSpawnCount}`, pos, 1 + depth * 1.6, Math.round(PIRATE_REWARD * (1 + depth * 2)))
  pirates.push(pirate)
  const mesh = buildCraft('interceptor', 0xc0392b)
  mesh.position.copy(pos)
  scene.add(mesh)
  pirateMeshes.set(pirate.id, mesh)
  loadPirateModel().then((model) => {
    if (!model) return
    if (pirateMeshes.get(pirate.id) !== mesh) {
      disposeObject(model)
      return
    }
    model.position.copy(mesh.position)
    model.quaternion.copy(mesh.quaternion)
    scene.remove(mesh)
    disposeObject(mesh)
    scene.add(model)
    pirateMeshes.set(pirate.id, model)
  })
  void now
}

function respawnPlayer(now: number): void {
  spawnExplosion(ship.position, now)
  audio.blip('explosion')
  damageFlash()
  ship.position.copy(randomSpawn())
  faceRefinery()
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
  shipMesh = buildCraft(type, PLAYER_TINT) // procedural hull shows immediately
  shipMesh.position.copy(ship.position)
  shipMesh.quaternion.copy(ship.quaternion)
  scene.add(shipMesh)
  selectedShipType = type
  playerHealth.max = SHIP_STATS[type].hull
  playerHealth.hull = playerHealth.max
  saveHangar()
  // Upgrade to the generated GLB model if available (async; keeps the procedural hull on failure).
  loadCraftModelForType(type).then((model) => {
    if (!model || selectedShipType !== type) return // asset missing, or the type changed mid-load
    scene.remove(shipMesh)
    disposeObject(shipMesh)
    shipMesh = model
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)
    scene.add(shipMesh)
  })
}

function updateWalletHUD(): void {
  creditsEl.textContent = String(Math.floor(econ.credits))
  cargoEl.textContent = `${Math.floor(cargoUsed(econ))}/${effCargo()}`
  // Rank: name + progress to next, with a one-shot promotion banner when it climbs.
  const rank = rankForCredits(econ.earned)
  rankNameEl.textContent = rank.bonus > 0 ? `${rank.name} +${Math.round(rank.bonus * 100)}%` : rank.name
  rankBarEl.style.width = `${Math.round(rankProgress(econ.earned) * 100)}%`
  const nxt = nextRank(rank)
  rankNextEl.textContent = nxt ? `→ ${nxt.name} (${nxt.min.toLocaleString()})` : 'MAX'
  if (lastRankIndex >= 0 && rank.index > lastRankIndex) showPromotion(rank.name)
  lastRankIndex = rank.index
}

function currentProgress(): PlayerProgress {
  return {
    credits: econ.credits,
    earned: econ.earned,
    cargo: { ORE: econ.cargo.ORE, ALLOY: econ.cargo.ALLOY },
    upgrades: { cargo: upgrades.tiers.cargo, speed: upgrades.tiers.speed, boost: upgrades.tiers.boost, mining: upgrades.tiers.mining },
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

// --- Remote ships
interface RemoteShip { mesh: THREE.Group; peer: PeerState; label: CSS2DObject }
const remotes = new Map<string, RemoteShip>()
const PALETTE = [0xc75d5d, 0x5d8ac7, 0xc7a85d, 0x9b5dc7, 0x5dc7b8, 0xc75da6]

const solarMap = new SolarSystemMap({
  getSnapshot: () => ({
    playerPosition: ship.position.clone(),
    playerQuaternion: ship.quaternion.clone(),
    nearbyCelestials: queryCelestials(ship.position, 90000),
    remotes: [...remotes.values()].map(({ mesh, peer }) => {
      const velocity = new THREE.Vector3()
      if (peer.prev && peer.receivedAt > peer.prev.receivedAt) {
        const dt = (peer.receivedAt - peer.prev.receivedAt) / 1000
        if (dt > 0) velocity.fromArray(peer.p).sub(new THREE.Vector3().fromArray(peer.prev.p)).multiplyScalar(1 / dt)
      }
      return {
        id: peer.id,
        name: peer.name,
        color: PALETTE[peer.color % PALETTE.length],
        position: mesh.position.clone(),
        velocity,
        ageMs: Math.max(0, performance.now() - peer.receivedAt),
      }
    }),
    selectedDestinationName: activeQuantumDestination().name,
    activeDestination: activeDestinationSnapshot(),
  }),
  onClose: () => {
    if (running && !docked && !chatOpen) requestFlightPointerLock()
  },
  onSetDestination: setQuantumDestinationFromAtlas,
})
document.body.appendChild(solarMap.root)

function dock(id: string): void {
  docked = true
  if (!dockedEver) markOnboard('scc.ob.docked', (v) => { dockedEver = v }) // onboarding step 2 — opening the UI counts
  solarMap.close()
  miningActive = false
  leaderboardPanelEl.hidden = true // don't strand the leaderboard open behind the station menu
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
  requestFlightPointerLock()
}

// --- Input
const keys = new Set<string>()
let mousePitch = 0
let mouseYaw = 0
let assist = true

addEventListener('keydown', (e) => {
  if (chatOpen) return // chat input owns the keyboard while open
  if (solarMap.isOpen) return // map owns M/Escape via its capture listener
  if (e.code === 'KeyM' && running) {
    e.preventDefault()
    keys.clear()
    miningActive = false
    weaponActive = false
    mineEl.hidden = true
    beam.visible = false
    impact.visible = false
    leaderboardPanelEl.hidden = true
    audio.setMining(false, false)
    if (document.pointerLockElement) document.exitPointerLock()
    solarMap.open()
    return
  }
  if (e.code === 'Enter' && running && !docked) { openChat(); return }
  if (e.code === 'Space') e.preventDefault()
  if (e.repeat) return
  keys.add(e.code)
  if (e.code === 'KeyV') {
    assist = !assist
    assistEl.textContent = assist ? 'COUPLED' : 'DECOUPLED'
  }
  if (e.code === 'Space' && running && !docked && dockable) dock(dockable)
  if (e.code === 'KeyN' && running && !docked && quantum.phase === 'idle') {
    customJumpDestination = null
    selectedJumpIdx = (selectedJumpIdx + 1) % PLANETS.length // cycle the quantum destination
    audio.blip('nav')
  }
  if (e.code === 'KeyL' && running && !docked) {
    const willShow = leaderboardPanelEl.hidden
    leaderboardPanelEl.hidden = !willShow
    if (willShow) fetchLeaderboard(lbListHudEl) // refresh standings each time it opens
  }
  if (e.code === 'KeyJ' && running && !docked) {
    if (quantum.phase === 'idle') {
      const dest = destinationArrival()
      const started = startTravel(quantum, dest.position)
      if (started.ok) {
        jumpTargetName = dest.name
        audio.blip('nav')
      }
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

// Mouse self-centering rate (1/s). Tuned so a 60 fps frame matches the old *0.92 feel
// (e^(-5/60) ≈ 0.92), but now frame-rate independent so it feels identical at any refresh rate.
const MOUSE_DECAY = 5
function readInput(dt: number): ControlInput {
  // Mouse deflection decays toward center — feels like a virtual joystick (frame-rate independent)
  const keep = Math.exp(-MOUSE_DECAY * dt)
  mousePitch *= keep
  mouseYaw *= keep
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

const net = new NetClient(nicknameEl.value || 'PILOT', identity, {
  onChallenge: (message) => {
    signMessage(message).then((sig) => {
      if (pendingPubkey) net.submitAuth(pendingPubkey, sig)
    }).catch(() => { setWalletStatus('Signature cancelled.'); pendingPubkey = null })
  },
  onAuthOk: (pubkey, sessionId) => {
    walletSession = { pubkey, sessionId, connectedAt: Date.now() }
    saveWalletSession(localStorage, walletSession)
    pendingPubkey = null
    lockWalletButton(pubkey)
    setWalletStatus(`Connected ${pubkey.slice(0, 4)}…${pubkey.slice(-4)} — press LAUNCH to play`)
  },
  onAuthError: () => {
    pendingPubkey = null
    setWalletStatus('Wallet not linked — already has a pilot, or signing failed.')
  },
  onProgress(p) {
    // Server is the source of truth — adopt saved progress when it arrives.
    econ.credits = p.credits
    econ.earned = p.earned ?? p.credits // migration: pre-earned saves seed lifetime from balance
    econ.cargo.ORE = p.cargo.ORE
    econ.cargo.ALLOY = p.cargo.ALLOY
    upgrades.tiers.cargo = p.upgrades.cargo
    upgrades.tiers.speed = p.upgrades.speed
    upgrades.tiers.boost = p.upgrades.boost
    upgrades.tiers.mining = p.upgrades.mining ?? 0
    ownedShips.clear()
    for (const t of p.hangar.owned) if (t in SHIP_STATS) ownedShips.add(t as ShipType)
    ownedShips.add('hauler')
    const sel = (p.hangar.selected in SHIP_STATS ? p.hangar.selected : 'hauler') as ShipType
    setPlayerCraft(ownedShips.has(sel) ? sel : 'hauler')
    saveEconomy(econ)
    saveUpgrades(upgrades)
    saveHangar()
    updateWalletHUD()
    finishOnboarding() // a returning token already knows the ropes
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
    remotes.set(peer.id, { mesh, peer, label: labelObj })
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
    netConnected = connected
    netEl.textContent = connected ? 'SECTOR LINK: ONLINE' : 'SECTOR LINK: OFFLINE (solo)'
    onlineEl.textContent = String(online)
    if (connected) {
      // Show our own presence immediately, then confirm with the server (don't wait the 6s tick).
      statOnlineEl.textContent = String(Math.max(1, Number(statOnlineEl.textContent) || 0))
      setTimeout(refreshLandingStats, 500)
    }
  },
  onChat(name, text) {
    addChatLine(name, text)
  },
  onKicked() {
    // Same Pilot Code launched elsewhere — this tab is now read-only to avoid save conflicts.
    sessionKicked = true
    netEl.textContent = 'SECTOR LINK: SIGNED IN ELSEWHERE'
    objectiveEl.textContent = '⚠ This Pilot Code is now active in another tab/device. Refresh to play here.'
    objectiveEl.hidden = false
  },
})
net.setSession(walletSession?.sessionId ?? null) // resume a verified wallet session if we have one
net.connect() // connect on page load as a viewer (presence) — counts toward "online" on the landing

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
  while (chatLines.length > 200) chatLines.shift()?.remove() // keep the session's history, capped for memory
  chatLogEl.scrollTop = chatLogEl.scrollHeight // newest at the bottom
  // Fade visually after a while so the idle HUD stays clean — but keep it in the log,
  // so opening chat ([Enter]) reveals the full scrollable history.
  setTimeout(() => { line.style.opacity = '0' }, 9000)
}

function openChat(): void {
  if (chatOpen || !running || docked) return
  chatOpen = true
  document.exitPointerLock()
  chatLogEl.classList.add('open') // expand into the scrollable history
  chatLogEl.scrollTop = chatLogEl.scrollHeight
  chatInputEl.hidden = false
  chatInputEl.value = ''
  chatInputEl.focus()
}

function closeChat(): void {
  chatOpen = false
  chatLogEl.classList.remove('open')
  chatInputEl.hidden = true
  chatInputEl.blur()
  if (running && !docked) requestFlightPointerLock()
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

// Nameplates fade out with distance so far-off pilots don't clutter the screen.
const NAMEPLATE_FADE_NEAR = 1200
const NAMEPLATE_FADE_FAR = 2600
function updateRemotes(): void {
  const renderTime = performance.now() - INTERP_DELAY_MS
  for (const { mesh, peer, label } of remotes.values()) {
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
    // Distance-fade the nameplate: crisp up close, gone far away.
    const d = ship.position.distanceTo(mesh.position)
    const op = 1 - THREE.MathUtils.clamp((d - NAMEPLATE_FADE_NEAR) / (NAMEPLATE_FADE_FAR - NAMEPLATE_FADE_NEAR), 0, 1)
    label.visible = op > 0.02
    ;(label.element as HTMLElement).style.opacity = String(op)
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

function spawnFloat(text: string, pos: THREE.Vector3, now: number, color?: string): void {
  const div = document.createElement('div')
  div.className = 'ore-float'
  div.textContent = text
  if (color) div.style.color = color
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

// --- Loot: spin crates, drift them toward the ship within magnet range, collect on contact,
// and occasionally spawn a free treasure crate nearby to reward exploration.
const _lootDir = new THREE.Vector3()
const _lootTmp = new THREE.Vector3()
function updateLootCrates(now: number, dt: number): void {
  if (now - lastTreasure > 22000 && lootCrates.length < 8) {
    _lootDir.set(Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.3, Math.random() * 2 - 1)
    if (_lootDir.lengthSq() < 1e-3) _lootDir.set(0, 0, 1)
    _lootDir.normalize()
    spawnLoot(_lootTmp.copy(ship.position).addScaledVector(_lootDir, 250 + Math.random() * 250))
    lastTreasure = now
  }
  for (let i = lootCrates.length - 1; i >= 0; i--) {
    const loot = lootCrates[i]
    loot.mesh.rotation.y += 1.5 * dt
    loot.mesh.rotation.x += 0.8 * dt
    const d = loot.mesh.position.distanceTo(ship.position)
    if (d < LOOT_PICKUP) {
      gainCredits(econ, loot.value)
      refreshWallet()
      spawnFloat(`+${loot.value} cr`, loot.mesh.position, now, loot.rare ? '#ffd24d' : '#ffe08a')
      audio.blip('trade')
      scene.remove(loot.mesh)
      disposeObject(loot.mesh)
      lootCrates.splice(i, 1)
    } else if (d < LOOT_MAGNET) {
      loot.mesh.position.lerp(ship.position, (1 - d / LOOT_MAGNET) * dt * 4) // magnet pull
    }
  }
}

// --- Combat HUD overlay: target brackets, off-screen threat arrows, and a lead pip.
const _proj = new THREE.Vector3()
const _lead = new THREE.Vector3()
function drawCombatHud(): void {
  const W = combatCanvas.width, H = combatCanvas.height
  cctx.clearRect(0, 0, W, H)
  if (!pirates.length) return
  const cx = W / 2, cy = H / 2
  let nearest: Pirate | null = null, nd = Infinity

  for (const p of pirates) {
    _proj.copy(p.position).project(camera)
    const infront = _proj.z < 1
    const sx = (_proj.x * 0.5 + 0.5) * W
    const sy = (-_proj.y * 0.5 + 0.5) * H
    const dist = ship.position.distanceTo(p.position)
    const onScreen = infront && sx >= 0 && sx <= W && sy >= 0 && sy <= H

    if (onScreen) {
      const s = 16
      cctx.strokeStyle = '#ff5d5d'; cctx.lineWidth = 2
      cctx.beginPath()
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
        cctx.moveTo(sx + ox * s, sy + oy * s); cctx.lineTo(sx + ox * s, sy + oy * (s - 6))
        cctx.moveTo(sx + ox * s, sy + oy * s); cctx.lineTo(sx + ox * (s - 6), sy + oy * s)
      }
      cctx.stroke()
      cctx.fillStyle = '#ff8a8a'; cctx.font = '11px ui-monospace, monospace'; cctx.textAlign = 'center'
      cctx.fillText(`${Math.round(dist)}m`, sx, sy + s + 14)
    } else {
      let dx = sx - cx, dy = sy - cy
      if (!infront) { dx = -dx; dy = -dy } // behind: flip so the arrow points the right way
      const ang = Math.atan2(dy, dx)
      const r = Math.min(W, H) * 0.4
      const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r
      cctx.save(); cctx.translate(ax, ay); cctx.rotate(ang)
      cctx.fillStyle = '#ff5d5d'
      cctx.beginPath(); cctx.moveTo(13, 0); cctx.lineTo(-8, -7); cctx.lineTo(-8, 7); cctx.closePath(); cctx.fill()
      cctx.restore()
    }
    if (infront && dist < nd) { nd = dist; nearest = p }
  }

  // Lead indicator on the nearest pirate ahead — put your crosshair here to land hits.
  if (nearest) {
    const t = nd / PROJECTILE_SPEED
    _lead.copy(nearest.velocity).multiplyScalar(t).add(nearest.position)
    _proj.copy(_lead).project(camera)
    if (_proj.z < 1) {
      const lx = (_proj.x * 0.5 + 0.5) * W, ly = (-_proj.y * 0.5 + 0.5) * H
      cctx.strokeStyle = '#9fffb0'; cctx.lineWidth = 2
      cctx.beginPath(); cctx.arc(lx, ly, 8, 0, Math.PI * 2); cctx.stroke()
      cctx.beginPath()
      cctx.moveTo(lx - 13, ly); cctx.lineTo(lx - 4, ly); cctx.moveTo(lx + 4, ly); cctx.lineTo(lx + 13, ly)
      cctx.moveTo(lx, ly - 13); cctx.lineTo(lx, ly - 4); cctx.moveTo(lx, ly + 4); cctx.lineTo(lx, ly + 13)
      cctx.stroke()
    }
  }
}

// --- Chase camera
const camOffset = new THREE.Vector3()
const camTarget = new THREE.Vector3()
let camBoost = false // last-known boost input, read by the camera for FOV punch
let camThrust = 0 // last-known commanded thrust 0..1, drives the engine flare (#2)
let prevBoost = false // edge-detect boost engage for the ignition kick
let boostKick = 0 // 1 on ignition, decays — drives camera pull-back, FOV punch, flare stretch
// G-force sway: the camera lags opposite to acceleration, so thrust/braking has weight.
const prevCamVel = new THREE.Vector3()
const gSway = new THREE.Vector3()
const _accel = new THREE.Vector3()
const _gTarget = new THREE.Vector3()
const G_SWAY_K = 0.03   // accel (m/s²) → offset (m)
const G_SWAY_MAX = 2.6  // clamp so it never gets nauseating
const G_SWAY_RESP = 6   // spring stiffness
function updateCamera(dt: number): void {
  // Acceleration this frame → a damped offset opposite to it (push back on boost, dip on brake).
  _accel.copy(ship.velocity).sub(prevCamVel).multiplyScalar(1 / Math.max(dt, 1e-4))
  prevCamVel.copy(ship.velocity)
  _gTarget.copy(_accel).multiplyScalar(-G_SWAY_K)
  if (_gTarget.lengthSq() > G_SWAY_MAX * G_SWAY_MAX) _gTarget.setLength(G_SWAY_MAX)
  gSway.lerp(_gTarget, 1 - Math.exp(-G_SWAY_RESP * dt))

  // Ignition kick: pull the camera back along its boom and punch FOV for a beat.
  camOffset.set(0, 3.2, 9.5 + boostKick * 4).applyQuaternion(ship.quaternion)
  camTarget.copy(ship.position).add(camOffset).add(gSway)
  camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt))
  camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-10 * dt))
  // FOV gives a gentle sense of speed: a touch wider under boost / quantum travel. No hard punches.
  const targetFov = (quantum.phase === 'traveling' ? 78 : camBoost ? 82 : 72) + boostKick * 6
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt))
  camera.updateProjectionMatrix()
}

// --- Launch flow
function launch(): void {
  const callsign = nicknameEl.value.trim() || 'PILOT'
  localStorage.setItem('callsign', callsign)
  net.enterGame(callsign) // promote from viewer (presence) to an active pilot
  if (statsTimer) clearInterval(statsTimer)
  overlayEl.hidden = true
  overlayEl.style.display = 'none'
  hudEl.hidden = CAPTURE_OG
  statusEl.hidden = CAPTURE_OG
  helpEl.hidden = CAPTURE_OG
  crosshairEl.hidden = CAPTURE_OG
  walletEl.hidden = CAPTURE_OG
  minimapWrapEl.hidden = CAPTURE_OG
  leaderboardPanelEl.hidden = true
  updateWalletHUD() // HUD only — don't net.saveProgress before onProgress restores, or we'd overwrite saved data
  hullBarEl.style.width = '100%'
  nextSpawnAt = performance.now() + 8000 // first hostiles arrive after ~8s
  audio.init()
  audio.resume()
  requestFlightPointerLock()
  running = true
  selectedJumpIdx = nearestPlanetIdx() // start aimed at the closest planet
  customJumpDestination = null
  setPlayerCraft(selectedShipType) // apply hull (and load its GLB model) on launch
}
launchEl.addEventListener('click', launch)
nicknameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch() })
if (CAPTURE_OG) {
  nicknameEl.value = 'test'
  requestAnimationFrame(() => launch())
}
renderer.domElement.addEventListener('click', () => {
  if (running && !docked && !chatOpen && !solarMap.isOpen && document.pointerLockElement !== renderer.domElement) {
    requestFlightPointerLock()
  }
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  labelRenderer.setSize(innerWidth, innerHeight)
  combatCanvas.width = innerWidth
  combatCanvas.height = innerHeight
})

// --- Main loop
let running = false
let last = performance.now()

// --- Minimap (top-down radar, north-up, player-centered)
const MAP_RANGE = 4500 // world units from player to minimap edge
function atmoColorFor(surface: string): string {
  return surface === 'earth' ? '#88bbff'
    : surface === 'venus' ? '#e8c070'
    : surface === 'mars' ? '#d98a5a'
    : surface === 'gas' ? '#d8c0a0'
    : '#9fb4c8'
}

const _skyN = new THREE.Vector3()
const _skySun = new THREE.Vector3()
// Atmospheric-entry sky: the closer you get to a planet's surface, the more the screen
// fills with that planet's air color — brighter on the sun-facing (day) side, fading to
// dark space at night. A sense of descending into the atmosphere and flying under its sky.
function updateAtmoVeil(): number {
  let prox = 0
  let surface = 'rocky'
  let nx = 0, ny = 0, nz = 0
  for (const p of [...PLANETS, SPAWN_PLANET]) {
    const d = ship.position.distanceTo(p.position)
    const pr = 1 - Math.min(1, Math.max(0, (d - p.radius * 1.06) / (p.radius * 1.6)))
    if (pr > prox) { prox = pr; surface = p.surface; nx = p.position.x; ny = p.position.y; nz = p.position.z }
  }
  if (prox > 0.01) {
    // Day/night at our spot on the planet → sky brightness.
    _skyN.set(ship.position.x - nx, ship.position.y - ny, ship.position.z - nz).normalize()
    _skySun.set(SUN_POSITION.x - ship.position.x, SUN_POSITION.y - ship.position.y, SUN_POSITION.z - ship.position.z).normalize()
    const day = THREE.MathUtils.clamp(_skyN.dot(_skySun) * 0.5 + 0.5, 0, 1)
    const sky = atmoColorFor(surface)
    atmoVeilEl.style.background = `radial-gradient(ellipse at center, transparent 22%, ${sky} 128%)`
    atmoVeilEl.style.opacity = String(Math.min(0.82, prox) * (0.18 + day * 0.82))
  } else {
    atmoVeilEl.style.background = 'none'
    atmoVeilEl.style.opacity = '0'
  }
  return prox
}

const _altN = new THREE.Vector3()
// Low-altitude readout: height above the nearest solid planet's sampled terrain.
function updateAltitudeHUD(): void {
  let best: typeof PLANETS[number] | null = null
  let bestD = Infinity
  for (const p of PLANETS) {
    const d = ship.position.distanceTo(p.position)
    if (d < bestD) { bestD = d; best = p }
  }
  if (best && bestD < best.radius * 2.5) {
    _altN.set(ship.position.x - best.position.x, ship.position.y - best.position.y, ship.position.z - best.position.z).normalize()
    const solid = best.surface !== 'gas' && best.surface !== 'venus'
    const s = solid ? samplePlanetSurface(best.surface, best.seed, _altN.x, _altN.y, _altN.z, best.color, best.radius) : null
    const terrainR = s ? best.radius + s.height * best.radius * 0.055 * 1.6 : best.radius
    const alt = Math.max(0, Math.round(bestD - terrainR))
    altLabelEl.textContent = `ALT ${alt.toLocaleString()} m`
    altLineEl.hidden = false
  } else {
    altLineEl.hidden = true
  }
}

function updateDepthHUD(): void {
  const df = deepFactor()
  let label: string, color: string
  if (df < 0.12) { label = 'CORE SPACE'; color = '#6fdc8c' }
  else if (df < 0.45) { label = 'FRONTIER'; color = '#bfe06f' }
  else if (df < 0.75) { label = 'DEEP SPACE'; color = '#ffb347' }
  else { label = 'FAR REACHES'; color = '#ff5d5d' }
  depthLabelEl.textContent = label
  depthLabelEl.style.color = color
  depthBarEl.style.width = `${Math.round(df * 100)}%`
  depthBarEl.style.background = color
}

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

  // The Solar Atlas owns the screen and runs its own render loop while open —
  // skip the game's sim/render so two WebGL contexts don't fight for the GPU.
  if (solarMap.isOpen) return

  station.rotation.z += dt * 0.05
  colony.rotation.y += dt * 0.03
  starfield.position.copy(ship.position) // keep the star backdrop centered on the player
  nebula.position.copy(ship.position) // nebula skydome rides with the player too
  for (const g of planetGroups) g.rotation.y += dt * (g.userData.spin as number) // living, rotating worlds
  capital.rotation.y += dt * 0.0015 // capital ship drifts almost imperceptibly
  capitalCarrier.rotation.y -= dt * 0.0011 // different silhouette, different lazy drift
  ;(sun.userData.sunMat as THREE.ShaderMaterial).uniforms.uTime.value = now * 0.001 // boil the star surface
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
    audio.setThrust(qr.phase === 'traveling' ? 0.75 : 0.2, qr.phase === 'traveling', qr.phase === 'traveling' ? 0.95 : 0)
    audio.setAmbience({
      atmosphere: 0,
      quantum: qr.phase === 'spooling' ? 0.55 : 1,
      speedFrac: qr.phase === 'traveling' ? 1.2 : 0.25,
    })
    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
    )
  } else if (running && !docked) {
    // Idle: small nav hint under the minimap (no big banner).
    quantumEl.hidden = true
    const dest = destinationArrival()
    navHintEl.textContent = `[N] pick planet | ${dest.name} | ${(dest.dist / 1000).toFixed(1)} km   |   [J] jump`
    const input = readInput(dt)
    stepShip(ship, input, dt, { maxSpeed: effSpeed(), boostMultiplier: effBoost() })
    resolvePlanetCollisions()
    resolveCapitalCollision()
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)

    speedEl.textContent = String(Math.round(ship.velocity.length()))
    boostEl.style.visibility = input.boost ? 'visible' : 'hidden'
    camBoost = input.boost
    if (input.boost && !prevBoost) {
      boostKick = 1
      audio.playBoostPunch(ship.velocity.length() / effSpeed())
    } // ignition punch
    prevBoost = input.boost

    // Engine audio tracks commanded thrust; wind layer tracks actual speed.
    camThrust = Math.min(1, input.thrust.length())
    audio.setThrust(camThrust, input.boost, ship.velocity.length() / effSpeed())

    // Market prices drift back toward base over time.
    marketStep(market, dt)

    // Mining: transfer ORE from the nearest in-range asteroid while the laser is held.
    const mineResult = mineStep(field, ship.position, econ, dt, miningActive, effCargo(), miningYield(upgrades))
    if (mineResult.mined > 0 && mineResult.asteroid) {
      if (!minedEver) markOnboard('scc.ob.mined', (v) => { minedEver = v }) // onboarding step 1
      const rm = rockMeshes.get(mineResult.asteroid.id)
      if (rm?.rare) gainCredits(econ, mineResult.mined * ORE_RARE_BONUS) // rare vein jackpot, on top of the ORE
      updateWalletHUD()
      if (rm) {
        const ratio = Math.max(0, mineResult.asteroid.reserves / rm.initial)
        rm.mesh.scale.setScalar(0.3 + 0.7 * ratio)
        if (mineResult.asteroid.reserves <= 0) rm.mesh.visible = false
      }
      // Accumulate mined ORE into periodic floating "+N ORE" cues (gold for a rare vein).
      oreAccum += mineResult.mined
      if (now - lastFloat > 500 && oreAccum >= 1) {
        spawnFloat(`+${Math.floor(oreAccum)} ORE`, mineResult.asteroid.position, now, rm?.rare ? '#ffd24d' : undefined)
        oreAccum -= Math.floor(oreAccum)
        lastFloat = now
      }
      if (now - lastSave > 2000) { saveEconomy(econ); net.saveProgress(currentProgress()); lastSave = now }
    }
    updateMiningVFX(miningActive && mineResult.inRange, mineResult.asteroid?.position ?? null, now)
    audio.setMining(miningActive, mineResult.inRange)
    mineEl.hidden = !(miningActive && mineResult.inRange)

    // Keep the ore pool flowing around the player: cull depleted/distant veins, respawn fresh ones.
    if (now - lastOreStream > 400) { streamOre(); lastOreStream = now }

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
      nextSpawnAt = now + 19000
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
        gainCredits(econ, p.reward)
        finishOnboarding() // graduates the onboarding objective
        refreshWallet()
        spawnLoot(p.position) // drop a loot crate where it died
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
    updateDepthHUD()
    updateAltitudeHUD()
    const atmosphere = updateAtmoVeil()
    if (quantum.phase === 'idle') {
      audio.setAmbience({ atmosphere, quantum: 0, speedFrac: ship.velocity.length() / effSpeed() })
    }
  } else {
    // Menu background: slow orbit around the station
    const t = now * 0.0001
    camera.position.set(Math.cos(t) * 220 + 120, 60, Math.sin(t) * 220 - 350)
    camera.lookAt(station.position)
  }

  updateOreFloats(now)
  updateExplosions(now)

  // Subtle quantum motion: faint streaks ease in during the jump (spool-up pulls them gently
  // toward the vanishing point, travel lets them drift past). Kept light — easy on the eyes.
  let warpIntensity = 0, warpInward = false
  if (running && !docked) {
    if (quantum.phase === 'spooling') {
      warpIntensity = (1 - quantum.spoolRemaining / QUANTUM_TUNING.spoolTime) * 0.3
      warpInward = true
    } else if (quantum.phase === 'traveling') {
      warpIntensity = 0.45
    }
  } else {
    camBoost = false // don't strand a wide FOV while docked/in menu
  }
  updateWarpField(warpField, warpIntensity, dt, warpInward)
  if (running) updateDustField(dustField, camera.position)

  // Combat HUD — target brackets, threat arrows, lead pip (hidden while docked/in menu).
  if (running && !docked) drawCombatHud()
  else cctx.clearRect(0, 0, combatCanvas.width, combatCanvas.height)

  if (running && !docked) updateLootCrates(now, dt) // spin / magnet / collect loot crates

  // Engine flare: reacts to thrust (a soft glow when accelerating, #2), flares hard on
  // boost, and stretches on the ignition kick. Rides the ship's tail.
  boostKick = Math.max(0, boostKick - dt * 3.5)
  _flareBack.set(0, 0, 3.2).applyQuaternion(shipMesh.quaternion)
  boostFlare.position.copy(shipMesh.position).add(_flareBack)
  boostFlare.quaternion.copy(shipMesh.quaternion)
  boostFlare.rotateX(Math.PI / 2) // cone tip trails back along the ship's +z
  const flareMat = boostFlare.material as THREE.ShaderMaterial
  const flareTarget = running && quantum.phase === 'idle'
    ? camThrust * 0.3 + (camBoost ? 0.45 : 0) // thrust glow + boost punch
    : 0
  const flareOp = flareMat.uniforms.uOpacity.value as number
  flareMat.uniforms.uOpacity.value = flareOp + (flareTarget - flareOp) * (1 - Math.exp(-12 * dt))
  flareMat.uniforms.uTime.value = performance.now() * 0.001
  boostFlare.visible = (flareMat.uniforms.uOpacity.value as number) > 0.01
  boostFlare.scale.set(1, 1 + boostKick * 1.2 + camThrust * 0.4, 1) // stretches with thrust too

  // Onboarding objective — new pilots get a "next step" until they hunt their first pirate.
  // (Frozen if kicked: the objective slot shows the "signed in elsewhere" warning instead.)
  if (!sessionKicked) {
    const obj = running && !docked ? currentObjective() : null
    objectiveEl.hidden = !obj
    if (obj) objectiveEl.textContent = `▸ ${obj}`
  }

  composer.render()
  labelRenderer.render(scene, camera)
}
requestAnimationFrame(frame)
