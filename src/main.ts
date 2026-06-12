import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { createShipState, stepShip, type ControlInput } from './sim/physics'
import { buildShip } from './render/ship'
import { buildAsteroids, buildLights, buildPlanet, buildStarfield, buildStation } from './render/world'
import { NetClient, type PeerState } from './net/client'

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
scene.add(station)
buildLights(scene)

// --- Player
const ship = createShipState(new THREE.Vector3(0, 0, 0))
const shipMesh = buildShip(0x4f8a5f)
scene.add(shipMesh)

// --- Input
const keys = new Set<string>()
let mousePitch = 0
let mouseYaw = 0
let assist = true

addEventListener('keydown', (e) => {
  if (e.repeat) return
  keys.add(e.code)
  if (e.code === 'KeyV') {
    assist = !assist
    assistEl.textContent = assist ? 'COUPLED' : 'DECOUPLED'
  }
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return
  mouseYaw -= e.movementX * 0.0015
  mousePitch -= e.movementY * 0.0015
  mouseYaw = THREE.MathUtils.clamp(mouseYaw, -1, 1)
  mousePitch = THREE.MathUtils.clamp(mousePitch, -1, 1)
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

function frame(now: number): void {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now

  station.rotation.z += dt * 0.05

  if (running) {
    stepShip(ship, readInput(), dt)
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)

    speedEl.textContent = String(Math.round(ship.velocity.length()))
    boostEl.style.visibility = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 'visible' : 'hidden'

    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
    )
    updateRemotes()
    updateCamera(dt)
  } else {
    // Menu background: slow orbit around the station
    const t = now * 0.0001
    camera.position.set(Math.cos(t) * 220 + 120, 60, Math.sin(t) * 220 - 350)
    camera.lookAt(station.position)
  }

  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}
requestAnimationFrame(frame)
