/** Attitude thrusters — the feedback half of giving a ship mass.
 *
 *  Bounding angular acceleration on its own does not read as "heavy", it reads as "unresponsive".
 *  What makes Star Citizen's weight legible is that the pilot is told what the hull is doing: the RCS
 *  visibly fires to spin the ship up, goes quiet through the turn, and fires on the OPPOSITE side to
 *  stop it. That last burn is the whole point. In vacuum a steady rotation costs nothing, so thrusters
 *  firing mid-turn would be a lie; the two moments that cost torque are the two moments the pilot
 *  needs to see, and they are exactly when `stepShip` reports a rate error.
 *
 *  Deliberately no scene lights. A three.js light extends the per-fragment light loop for every lit
 *  material in the scene, so twelve of them would be paid for by the planets. These are additive
 *  billboard-ish puffs on unlit materials, which cost their own fragments and nothing else.
 *
 *  Pure module: numbers in, numbers out, no three.js. `render/shipyard.ts` turns the layout into
 *  meshes and `main.ts` drives them from `ShipState.rcsDemand`.
 */

/** White-blue, hotter and colder than the drive's cyan so a manoeuvre never reads as thrust. */
export const RCS_PORT_COLOR = 0xcfeeff

/** userData keys that mark a mesh as an unlit additive effect bolted onto a hull rather than part of
 *  its structure.
 *
 *  Read by `ui/cameraView`, which derives the pilot's eye point from the hull's geometry and must not
 *  let decoration vote on it: the thruster puffs sit at hull extremities including above the nose, and
 *  the eye is lifted clear of whatever structure is under and just ahead of it. Without this, bolting on
 *  a feedback layer would relocate the cockpit. `craftEngineGlow` is listed for the same reason even
 *  though its discs are all far aft of the probe window today — it is decoration either way, and the
 *  next mount table that puts a glow forward should not have to rediscover this.
 */
export const HULL_FX_MESH_KEYS = ['craftRcsPort', 'craftEngineGlow'] as const

/** Hull-local extents the port layout is derived from. Plain numbers rather than a THREE.Box3 so this
 *  module stays testable without a renderer; the caller unpacks whatever box it has. */
export interface RcsHullExtents {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface RcsPort {
  /** Hull-local position, model units. */
  x: number
  y: number
  z: number
  /** Unit torque this port produces, in the same local (pitch, yaw, roll) axes `stepShip` integrates.
   *  Conventions, all derived from the quaternion integration in sim/physics and forward = -Z:
   *  +pitch puts the nose up, +yaw swings it to port (-X), +roll lifts the starboard wing. */
  tPitch: number
  tYaw: number
  tRoll: number
  /** Puff radius at full drive, model units. */
  radius: number
  /** Authoring name, also the mesh name, so a capture can be diagnosed from the node tree. */
  name: string
}

// Placement, as fractions of the hull's half-extents. Every one of these was moved at least once in
// response to a capture, and the two failure modes bracket each other:
//
//   * too far in and the puff is INSIDE the hull. The first pass put the yaw pair at 0.34 of half-width
//     and both puffs came back invisible on the hauler, whose box width is set by outrigger nacelles —
//     a third of the way out is still deep inside the central cargo container.
//   * too far out and the puff is floating in SPACE. Pushing them to the box face put the interceptor's
//     yaw puff a full hull-width clear of the ship, because a box's widest point is its swept wingtips
//     amidships and the tail it was placed near is narrow.
//
// So: the yaw pair sits inboard of the widest point, where a wing or a nacelle actually is; the pitch
// pair goes nearly to the spine and keel, which are real structure over a hull's whole length; and the
// roll pair goes right out to the widest point, but AMIDSHIPS, where that width is not a lie.
const END_SPAN = 0.35   // pitch/yaw pairs, fore and aft — see the couple note below
const LAT_SPAN = 0.72   // yaw pair, either side of the centreline
const VERT_SPAN = 0.88  // pitch pair, spine and keel
const TIP_SPAN = 0.95   // roll pair, out at the widest point
const TIP_VERT = 0.45   // roll pair, above/below the wing plane

// Radius as a fraction of the hull's longest dimension, so an 8-unit interceptor and a 15-unit corvette
// both get puffs that read at the same distance. Clamped because the fleet's outliers (the capital
// hulls, if this is ever pointed at one) would otherwise get either specks or floodlights.
const RADIUS_FRACTION = 0.03
const RADIUS_MIN = 0.06
const RADIUS_MAX = 0.45

/** The largest `rcsPortStyle().scale` can ever be. Not a free constant — it is read back out of that
 *  function by a test, because the layout uses it to guarantee that a puff cannot enlarge the hull's
 *  bounding box, and that guarantee is load-bearing: `main.ts` seats a landing ship by its hull box, so
 *  a puff hanging below the keel would park every ship a fraction of a unit off the deck. Three.js's
 *  `Box3.setFromObject` does NOT skip invisible children, so switching an idle puff off is not enough. */
export const RCS_MAX_SCALE = 1.33

/** Twelve ports: a pitch pair fore and aft, a yaw pair fore and aft, and a roll pair at the wingtips.
 *
 *  Fore and aft in opposing pairs because that is how a couple works — pushing the nose up without a
 *  matching burn at the tail would translate the ship as well as rotate it, and the visual would read
 *  as a manoeuvring jet rather than as attitude control. Each port carries the torque it contributes so
 *  brightness is a dot product against demand rather than a switch statement per axis.
 */
export function rcsPortLayout(box: RcsHullExtents): RcsPort[] {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const cz = (box.minZ + box.maxZ) / 2
  const halfW = Math.max(1e-4, (box.maxX - box.minX) / 2)
  const halfH = Math.max(1e-4, (box.maxY - box.minY) / 2)
  const halfL = Math.max(1e-4, (box.maxZ - box.minZ) / 2)
  // Scaled off the hull's LONGEST dimension, then capped by its SHORTEST: a puff wider than the hull is
  // thin cannot be inscribed at all, and on a long needle of a fighter the length would otherwise vote
  // for a radius the fuselage has no room for.
  const spanRadius = Math.max(halfW, halfH, halfL) * 2 * RADIUS_FRACTION
  const fits = Math.min(halfW, halfH, halfL) / RCS_MAX_SCALE
  const radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, spanRadius), fits)

  // Every position is additionally clamped so the puff, at maximum drive, stays inscribed in the box.
  // That is not cosmetic: `main.ts` seats a landing ship on the deck by its hull bounding box, and
  // three.js's `Box3.setFromObject` does not skip invisible children, so a puff overhanging the keel
  // would park every ship a fraction of a unit off the pad whether it was lit or not.
  const clear = radius * RCS_MAX_SCALE
  const inset = (span: number, half: number): number => Math.min(span * half, Math.max(0, half - clear))

  const noseZ = cz - inset(END_SPAN, halfL)
  const tailZ = cz + inset(END_SPAN, halfL)
  const topY = cy + inset(VERT_SPAN, halfH)
  const botY = cy - inset(VERT_SPAN, halfH)
  const portX = cx - inset(LAT_SPAN, halfW)
  const starX = cx + inset(LAT_SPAN, halfW)
  const tipX = inset(TIP_SPAN, halfW)
  const tipY = inset(TIP_VERT, halfH)

  const port = (name: string, x: number, y: number, z: number, t: [number, number, number]): RcsPort =>
    ({ name, x, y, z, tPitch: t[0], tYaw: t[1], tRoll: t[2], radius })

  // Exhaust leaves in the direction the hull is being pushed away FROM, so a burn that lifts the nose
  // shows its plume UNDER the nose. That is why the +pitch pair is nose-bottom and tail-top, and not
  // the pair a reader might expect from the axis names.
  return [
    port('nose_bottom', cx, botY, noseZ, [1, 0, 0]),
    port('tail_top', cx, topY, tailZ, [1, 0, 0]),
    port('nose_top', cx, topY, noseZ, [-1, 0, 0]),
    port('tail_bottom', cx, botY, tailZ, [-1, 0, 0]),
    port('nose_port', portX, cy, noseZ, [0, 1, 0]),
    port('tail_starboard', starX, cy, tailZ, [0, 1, 0]),
    port('nose_starboard', starX, cy, noseZ, [0, -1, 0]),
    port('tail_port', portX, cy, tailZ, [0, -1, 0]),
    port('tip_starboard_bottom', cx + tipX, cy - tipY, cz, [0, 0, 1]),
    port('tip_port_top', cx - tipX, cy + tipY, cz, [0, 0, 1]),
    port('tip_starboard_top', cx + tipX, cy + tipY, cz, [0, 0, -1]),
    port('tip_port_bottom', cx - tipX, cy - tipY, cz, [0, 0, -1]),
  ]
}

/** How hard a port should be firing, in [0, 1], for a signed per-axis demand.
 *
 *  A clamped dot product, so a diagonal manoeuvre lights the ports of both axes partially instead of
 *  picking a winner, and a port whose torque opposes the demand goes fully dark rather than dim.
 */
export function rcsPortDrive(port: RcsPort, pitch: number, yaw: number, roll: number): number {
  const d = port.tPitch * pitch + port.tYaw * yaw + port.tRoll * roll
  return d <= 0 ? 0 : d >= 1 ? 1 : d
}

/** A thruster lights the instant the valve opens and trails off as the gas clears, so the rise is
 *  near-instant and the fall is not. Symmetric smoothing loses the crack of the initial burn, which is
 *  the part that has to be legible; too slow a fall smears a slam and its counter-burn together. */
export const RCS_RISE_RATE = 26
export const RCS_FALL_RATE = 8

export function approachRcsDrive(current: number, target: number, dt: number): number {
  const rate = target > current ? RCS_RISE_RATE : RCS_FALL_RATE
  const next = current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)))
  return next < 0 ? 0 : next > 1 ? 1 : next
}

export interface RcsPortStyle {
  /** False below the point where the puff is indistinguishable from nothing — the mesh is switched off
   *  rather than drawn transparent, so an idle hull costs no extra draw calls at all. */
  visible: boolean
  /** Colour multiplier for the additive material; above 1 it blooms. */
  intensity: number
  opacity: number
  /** Multiple of the port's authored radius. */
  scale: number
}

const RCS_VISIBLE_FLOOR = 0.015

// Calibrated against capture, not guessed. The first pass was hot enough that a single attitude puff
// bloomed brighter than the hull's main drive bells, which inverts the signalling — an RCS jet is a
// nudge, the engines are the ship's power. Still comfortably over unity so bloom catches it, because the
// alternative failure (a puff too dim to notice) is the one that makes the whole layer pointless.
export function rcsPortStyle(drive: number): RcsPortStyle {
  const d = drive < 0 ? 0 : drive > 1 ? 1 : drive
  return {
    visible: d > RCS_VISIBLE_FLOOR,
    intensity: 0.45 + d * 1.75,
    opacity: Math.min(0.9, d * 0.9),
    scale: 0.38 + d * 0.95,
  }
}

/** One 0..1 scalar for "the RCS is working", for the cues that are not per-port: the drive's audio and
 *  bloom load up while the pilot is fighting the hull's inertia, so a hard turn is audible and not only
 *  visible. The max rather than the length, so a pure single-axis slam already reads as full effort. */
export function rcsManeuverLoad(pitch: number, yaw: number, roll: number): number {
  const m = Math.max(Math.abs(pitch), Math.abs(yaw), Math.abs(roll))
  return m > 1 ? 1 : m < 0 ? 0 : m
}
