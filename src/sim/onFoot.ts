// On-foot (planetfall) movement maths.
//
// Scalar and frame-relative on purpose: the walker lives on a sphere, so "up" is a different
// direction at every point and there is no global ground plane to reason about. Everything here
// works in the walker's own tangent frame — a heading angle, a forward/right pair, a radius from
// the planet centre — and the caller supplies the basis vectors. That keeps the parts worth
// testing (speed normalisation, gravity and ground snap, the ship keep-out, the stride phase)
// free of three.js scene state.
//
// Scale reference: the ship hulls are 4–17 units long and DOCK_RANGE is "200 // metres", so one
// world unit is one metre near the ground. A 1.8-unit human is therefore a human.

/** Total height of the pedestrian figure, feet to crown. */
export const WALKER_HEIGHT = 1.8

/** Torso height — where the third-person camera aims and where the boarding range is measured
 *  from. Aiming at the feet puts the horizon uncomfortably high in frame. */
export const WALKER_CHEST_HEIGHT = 1.25

/** Capsule radius used for the ship keep-out. Shoulders, not a point. */
export const WALKER_RADIUS = 0.4

/** Walk / run ground speed (m/s). Deliberately a brisk walk rather than a sprint: the pad is 90
 *  units across, so anything faster crosses the whole playable surface in under ten seconds and
 *  the scale contrast that the arrival is for stops reading. */
export const WALK_SPEED = 3.4
export const RUN_SPEED = 7.2

/** Surface gravity for the walker, in m/s². Not the ship's `gravityAccel` field — that one is
 *  tuned for orbital mechanics at a compressed 4300-unit planet radius and is far too weak to
 *  make a 1.8m step off a 3-unit kerb look like anything. A pedestrian needs Earth's number. */
export const WALKER_GRAVITY = 9.81

/** Terminal-ish clamp so a fall off the pad's skirt cannot tunnel through the ground snap in one
 *  frame at a low frame rate. At 55 m/s a 0.05s frame moves 2.75 units — still under the deck
 *  thickness, so the snap always catches it. */
const WALKER_MAX_FALL_SPEED = 55

/** How far the walker's chest can be from the ship's hull surface and still board. Generous: the
 *  prompt is the discoverability mechanism and a tight radius makes it flicker as you walk. */
export const BOARD_RANGE = 6

export interface OnFootInput {
  /** -1..1, positive = the way the walker faces. */
  forward: number
  /** -1..1, positive = the walker's right. */
  strafe: number
  run: boolean
}

/** Ground velocity in the walker's own frame, in m/s.
 *
 *  Diagonals are normalised rather than summed: without this, forward+strafe is 1.41x walking
 *  straight, which is the oldest bug in first-person movement and immediately obvious as soon as
 *  anyone circles the ship.
 */
export function walkVelocity(input: OnFootInput): { forward: number; right: number } {
  const mag = Math.hypot(input.forward, input.strafe)
  if (mag < 1e-4) return { forward: 0, right: 0 }
  const speed = (input.run ? RUN_SPEED : WALK_SPEED) / mag
  return { forward: input.forward * speed, right: input.strafe * speed }
}

export interface VerticalState {
  /** Distance from the planet centre. */
  radius: number
  /** Radial velocity, positive outward. */
  velocity: number
  grounded: boolean
}

/** Gravity plus a hard snap to the ground radius.
 *
 *  Snap rather than a spring or a penetration solve: the ground here is an analytic query with no
 *  thickness, so there is nothing to be pushed out of, and the only real event is the 3-unit drop
 *  off the pad's deck onto the city sheet. A snap makes that a clean step down; a spring would
 *  make it a bounce.
 */
export function stepVertical(state: VerticalState, groundRadius: number, dt: number): VerticalState {
  let velocity = Math.max(-WALKER_MAX_FALL_SPEED, state.velocity - WALKER_GRAVITY * dt)
  let radius = state.radius + velocity * dt
  if (radius <= groundRadius) {
    radius = groundRadius
    velocity = 0
    return { radius, velocity, grounded: true }
  }
  return { radius, velocity, grounded: false }
}

/** Push a tangent-plane offset out of a circular keep-out, returning the corrected offset.
 *
 *  The ship is a solid the walker must not walk through, and it is the one obstacle in the slice
 *  that the player is guaranteed to try. A circle around the hull's centre rather than its box:
 *  the hull is parked at an arbitrary heading on a curved deck, the walker only ever meets it from
 *  the side, and a cylinder is both cheap and impossible to squeeze a corner of.
 *
 *  Returns the input unchanged when it is already clear, so the caller can skip the write.
 */
export function pushOutOfKeepOut(x: number, z: number, keepOutRadius: number): { x: number; z: number } {
  const d = Math.hypot(x, z)
  if (d >= keepOutRadius) return { x, z }
  if (d < 1e-4) return { x: keepOutRadius, z: 0 } // dead centre: any direction is as good as another
  const s = keepOutRadius / d
  return { x: x * s, z: z * s }
}

/** Walk-cycle phase in radians from distance travelled. One full stride per `strideLength`, so the
 *  legs stay in step with the ground at any speed without a separate animation clock. */
export function strideParams(distanceWalked: number, strideLength = 1.55): number {
  return (distanceWalked / strideLength) * Math.PI * 2
}

/** Clamp for the third-person camera's pitch (radians), where the camera orbits a pivot at the
 *  walker's shoulder and always aims back at it: negative swings the camera down and the view up.
 *
 *  Asymmetric because the two ends fail differently. Looking up at the ship you just flew down is
 *  the point of the mode, so the negative limit is as generous as the caller's ground clamp can
 *  absorb — past this the boom is below the deck at any sensible zoom and the clamp, not the pitch,
 *  is deciding the shot. Looking down is limited only by the camera reaching top-down, where the
 *  walker stops reading as a figure. */
export const FOOT_PITCH_MIN = -0.55
export const FOOT_PITCH_MAX = 1.05

export function clampFootPitch(pitch: number): number {
  return Math.min(FOOT_PITCH_MAX, Math.max(FOOT_PITCH_MIN, pitch))
}
