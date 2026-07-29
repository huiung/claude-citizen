import type { LandingApproach } from '../sim/landing'

// The approach cue: one line that names the skypad and says the ONE thing still standing between
// the ship and the LAND prompt.
//
// Landing needed three conditions to coincide — inside the pad radius, under 40m, under 30 m/s —
// and said nothing at all while any of them was unmet, which is indistinguishable from "this game
// has no landing". A pilot who is told "TOO FAST 187 → BRAKE UNDER 30" fixes it in one press.

/** Beyond this lateral offset the pilot is still flying TO the city, not lining up on the deck, and
 *  the cue should point them at the beam rather than ask for metre-accurate strafing. */
export const CUE_APPROACH_LATERAL = 400

/** Below this the cue is hidden entirely — a pad on the far side of the planet is not guidance. */
export const CUE_MAX_RANGE = 14000

/** Distances the way a HUD says them: metres up close, one decimal of a km beyond 1km. */
export function formatCueDistance(metres: number): string {
  const m = Math.max(0, metres)
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

/**
 * The cue line for an approach, or null when the ship is eligible — at that point the shared
 * dock/land prompt says PRESS SPACE TO LAND and a second line would just compete with it.
 *
 * `blocker` decides only whether there is anything to say; the emphasis comes from the numbers,
 * because the two orders differ. Eligibility tests lateral offset first, but a pilot 1.6 km up and
 * 200 m to one side needs to hear DESCEND — being told to strafe onto a deck that is still a
 * kilometre below them is worse than silence.
 *
 * Key letters are spelled out because the cue exists for pilots who have not read the controls:
 * "BRAKE" alone does not tell anyone that brake is X.
 */
export function landingCueText(
  approach: LandingApproach, cityName: string, padRadius: number, maxAlt: number, maxSpeed: number,
): string | null {
  if (approach.blocker === 'ready') return null
  const city = cityName.toUpperCase()
  const { lateral, alt, speed } = approach
  if (lateral > CUE_APPROACH_LATERAL) {
    return `◎ ${city} SKYPAD · ${formatCueDistance(lateral)} — FLY TO THE BEAM`
  }
  if (alt > maxAlt) {
    const drift = lateral > padRadius ? ` · ${formatCueDistance(lateral)} OFF CENTRE` : ''
    return `▾ ${city} SKYPAD · ALT ${formatCueDistance(alt)} — DESCEND UNDER ${maxAlt} m${drift}`
  }
  if (alt < 0) {
    // Reachable: the terrain clamp holds the hull a little lower than the deck face, so a pilot who
    // descends beside the deck and then slides over it arrives under the landing envelope.
    return `▴ ${city} SKYPAD · BELOW THE DECK — CLIMB WITH R`
  }
  if (lateral > padRadius) {
    return `◎ ${city} SKYPAD · ${formatCueDistance(lateral)} OFF CENTRE — STRAFE ONTO THE DECK`
  }
  return `⚠ ${city} SKYPAD · ${Math.round(speed)} m/s — BRAKE WITH X UNDER ${maxSpeed} m/s`
}

export interface MarkerPlacement {
  /** viewport pixels */
  x: number
  y: number
  /** true when the pad is off-screen or behind and the marker was pinned to the border */
  edge: boolean
}

/**
 * Where to draw the skypad marker for a pad whose projected position is `ndcX`/`ndcY`.
 *
 * A marker that simply vanishes when the pad leaves the frame is worse than none: the pilot cannot
 * tell "not on screen" from "not there". Off-screen pads are pinned to the border in their own
 * direction, and a pad BEHIND the camera has its direction negated first — a perspective projection
 * mirrors points behind the eye, so using the raw NDC would send the marker to the wrong edge and
 * turn the player around.
 */
export function placeSkypadMarker(
  ndcX: number, ndcY: number, behindCamera: boolean, width: number, height: number, margin: number,
): MarkerPlacement {
  let nx = behindCamera ? -ndcX : ndcX
  let ny = behindCamera ? -ndcY : ndcY
  if (behindCamera) {
    // Behind the camera the projection is meaningless as a position — only as a direction. Push it
    // out to the border so the marker is always ON the edge, never floating mid-screen over a pad
    // the pilot cannot see. A pad dead astern has no direction at all; put it at the bottom, which
    // is where a chase camera shows what is behind the ship.
    const longest = Math.max(Math.abs(nx), Math.abs(ny))
    if (longest < 1e-6) { nx = 0; ny = -1 } else { nx /= longest; ny /= longest }
  }
  const px = (nx * 0.5 + 0.5) * width
  const py = (1 - (ny * 0.5 + 0.5)) * height
  const maxX = Math.max(margin, width - margin)
  const maxY = Math.max(margin, height - margin)
  const x = Math.min(maxX, Math.max(margin, px))
  const y = Math.min(maxY, Math.max(margin, py))
  return { x, y, edge: behindCamera || x !== px || y !== py }
}
