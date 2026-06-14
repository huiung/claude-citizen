import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { createShipState, stepShip, type ControlInput } from './sim/physics'
import { buildShip } from './render/ship'
import {
  buildAsteroids, buildColony, buildLights, buildMineableAsteroid, buildPlanet,
  buildStarfield, buildStation, COLONY_POS, MINEABLE_SITES, REFINERY_POS,
} from './render/world'
import { NetClient, type PeerState } from './net/client'
import { dockableTarget, type DockTarget } from './sim/docking'
import { cargoUsed, loadEconomy, OUTPOSTS, saveEconomy } from './sim/economy'
import { createAsteroidField, mineStep } from './sim/mining'
import { createMarket, step as marketStep } from './sim/market'
import { generateContracts } from './sim/contracts'
import { boostMultiplier, cargoCapacity, loadUpgrades, saveUpgrades, topSpeed } from './sim/upgrades'
import {
  canFire, createHealth, createWeapon, fire as fireWeapon, type HitTarget, hullFraction,
  isDead, type Projectile, resolveHits, spawnProjectile, stepProjectiles, stepWeapon,
} from './sim/combat'
import { type Pirate, PIRATE_REWARD, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
import { GameAudio } from './audio/sound'
import { StationMenu } from './ui/stationMenu'

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

nicknameEl.value = localStorage.getItem('callsign') ?? ''

// --- Renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true })
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
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 50000)

scene.add(buildStarfield(), buildPlanet(), buildAsteroids())
const station = buildStation()
const colony = buildColony()
scene.add(station, colony)
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

// --- Player
const ship = createShipState(new THREE.Vector3(0, 0, 0))
const shipMesh = buildShip(0x4f8a5f)
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
const playerHealth = createHealth(100)
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
  const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
  const pirate = spawnPirate(`pir-${pirateSpawnCount}`, pos)
  pirates.push(pirate)
  const mesh = buildShip(0xc0392b)
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

function updateWalletHUD(): void {
  creditsEl.textContent = String(Math.floor(econ.credits))
  cargoEl.textContent = `${Math.floor(cargoUsed(econ))}/${cargoCapacity(upgrades)}`
}

function refreshWallet(): void {
  updateWalletHUD()
  saveEconomy(econ)
  saveUpgrades(upgrades)
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
  weaponActive = false
  ship.velocity.set(0, 0, 0)
  audio.setThrust(0, false)
  audio.setMining(false, false)
  audio.blip('dock')
  document.exitPointerLock()
  stationMenu.open({ outpostId: id, econ, market, upgrades, contracts, audio })
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
  if (e.code === 'Space') e.preventDefault()
  if (e.repeat) return
  keys.add(e.code)
  if (e.code === 'KeyV') {
    assist = !assist
    assistEl.textContent = assist ? 'COUPLED' : 'DECOUPLED'
  }
  if (e.code === 'Space' && running && !docked && dockable) dock(dockable)
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

const net = new NetClient(nicknameEl.value || 'PILOT', {
  onPeerJoin(peer) {
    const mesh = buildShip(PALETTE[peer.color % PALETTE.length])
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
  overlayEl.hidden = true
  overlayEl.style.display = 'none'
  hudEl.hidden = false
  statusEl.hidden = false
  helpEl.hidden = false
  crosshairEl.hidden = false
  walletEl.hidden = false
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

let captureCameraLocked = false

declare global {
  interface Window {
    __sccCapture?: {
      damagePlayer: (hull: number) => void
      launch: () => void
      reset: () => void
      setCamera: (pos: [number, number, number], target: [number, number, number]) => void
      setMining: (active: boolean) => void
      setPlayerHull: (hull: number) => void
      setPose: (pos: [number, number, number], target: [number, number, number]) => void
      setWeapon: (active: boolean) => void
      spawnPirateAt: (pos: [number, number, number], hull?: number) => void
      unlockCamera: () => void
    }
  }
}

if (new URLSearchParams(location.search).has('capture')) {
  const captureTarget = new THREE.Vector3()

  const syncCaptureHUD = () => {
    hullBarEl.style.width = `${Math.round(hullFraction(playerHealth) * 100)}%`
    enemiesEl.textContent = String(pirates.length)
    updateWalletHUD()
  }

  window.__sccCapture = {
    damagePlayer(hull) {
      playerHealth.hull = THREE.MathUtils.clamp(hull, 0, playerHealth.max)
      damageFlash()
      syncCaptureHUD()
    },
    launch() {
      if (running) return
      overlayEl.hidden = true
      overlayEl.style.display = 'none'
      hudEl.hidden = false
      statusEl.hidden = false
      helpEl.hidden = false
      crosshairEl.hidden = false
      walletEl.hidden = false
      refreshWallet()
      nextSpawnAt = Infinity
      running = true
      syncCaptureHUD()
    },
    reset() {
      econ.credits = 500
      econ.cargo.ORE = 0
      econ.cargo.ALLOY = 0
      upgrades.tiers.cargo = 0
      upgrades.tiers.speed = 0
      upgrades.tiers.boost = 0
      for (const entry of Object.values(market.entries)) entry.impulse = 0
      for (const contract of contracts) contract.status = 'offered'
      for (const site of field.asteroids) {
        const original = MINEABLE_SITES.find((s) => s.id === site.id)
        site.reserves = original?.reserves ?? site.reserves
        const rock = rockMeshes.get(site.id)
        if (rock) {
          rock.initial = site.reserves
          rock.mesh.visible = true
          rock.mesh.scale.setScalar(1)
        }
      }
      for (const floating of oreFloats.splice(0)) scene.remove(floating.obj)
      for (const mesh of projectileMeshes.values()) scene.remove(mesh)
      projectileMeshes.clear()
      projectiles.splice(0)
      for (const mesh of pirateMeshes.values()) scene.remove(mesh)
      pirateMeshes.clear()
      pirates.splice(0)
      for (const e of explosions.splice(0)) scene.remove(e.mesh)
      oreAccum = 0
      lastFloat = 0
      pirateSpawnCount = 0
      nextSpawnAt = Infinity
      playerHealth.hull = playerHealth.max
      miningActive = false
      weaponActive = false
      docked = false
      dockable = null
      captureCameraLocked = false
      stationMenu.close()
      dockPromptEl.hidden = true
      mineEl.hidden = true
      beam.visible = false
      impact.visible = false
      ship.position.set(0, 0, 0)
      ship.velocity.set(0, 0, 0)
      ship.quaternion.identity()
      shipMesh.position.copy(ship.position)
      shipMesh.quaternion.copy(ship.quaternion)
      refreshWallet()
      syncCaptureHUD()
    },
    setCamera(pos, target) {
      captureCameraLocked = true
      camera.position.fromArray(pos)
      captureTarget.fromArray(target)
      camera.lookAt(captureTarget)
    },
    setMining(active) {
      miningActive = active
    },
    setPlayerHull(hull) {
      playerHealth.hull = THREE.MathUtils.clamp(hull, 0, playerHealth.max)
      syncCaptureHUD()
    },
    setPose(pos, target) {
      docked = false
      stationMenu.close()
      ship.position.fromArray(pos)
      ship.velocity.set(0, 0, 0)
      shipMesh.position.copy(ship.position)
      captureTarget.fromArray(target)
      shipMesh.lookAt(captureTarget)
      ship.quaternion.copy(shipMesh.quaternion)
      if (!captureCameraLocked) updateCamera(1)
    },
    setWeapon(active) {
      weaponActive = active
    },
    spawnPirateAt(pos, hull) {
      if (pirates.length >= MAX_PIRATES) return
      const pirate = spawnPirate(`cap-pir-${pirateSpawnCount++}`, new THREE.Vector3(...pos))
      if (typeof hull === 'number') {
        pirate.health.max = Math.max(1, hull)
        pirate.health.hull = pirate.health.max
      }
      pirates.push(pirate)
      const mesh = buildShip(0xc0392b)
      mesh.position.copy(pirate.position)
      mesh.lookAt(ship.position)
      scene.add(mesh)
      pirateMeshes.set(pirate.id, mesh)
      syncCaptureHUD()
    },
    unlockCamera() {
      captureCameraLocked = false
    },
  }
}

// --- Main loop
let running = false
let last = performance.now()

function frame(now: number): void {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now

  station.rotation.z += dt * 0.05
  colony.rotation.y += dt * 0.03

  if (running && !docked) {
    const input = readInput()
    stepShip(ship, input, dt, { maxSpeed: topSpeed(upgrades), boostMultiplier: boostMultiplier(upgrades) })
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)

    speedEl.textContent = String(Math.round(ship.velocity.length()))
    boostEl.style.visibility = input.boost ? 'visible' : 'hidden'

    // Engine audio tracks commanded thrust.
    audio.setThrust(Math.min(1, input.thrust.length()), input.boost)

    // Market prices drift back toward base over time.
    marketStep(market, dt)

    // Mining: transfer ORE from the nearest in-range asteroid while the laser is held.
    const mineResult = mineStep(field, ship.position, econ, dt, miningActive, cargoCapacity(upgrades))
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
      if (now - lastSave > 2000) { saveEconomy(econ); lastSave = now }
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

    if (now >= nextSpawnAt) {
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
    if (!captureCameraLocked) updateCamera(dt)
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
