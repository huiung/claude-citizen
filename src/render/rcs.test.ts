import { describe, expect, it } from 'vitest'
import {
  approachRcsDrive,
  rcsManeuverLoad,
  rcsPortDrive,
  rcsPortLayout,
  rcsPortStyle,
  RCS_FALL_RATE,
  RCS_MAX_SCALE,
  RCS_RISE_RATE,
  type RcsHullExtents,
  type RcsPort,
} from './rcs'

/** Roughly a game hull: ~9 long, ~5 across, ~2.5 tall, centred. */
function hullBox(): RcsHullExtents {
  return { minX: -2.5, maxX: 2.5, minY: -1.25, maxY: 1.25, minZ: -4.5, maxZ: 4.5 }
}

function byName(ports: RcsPort[], name: string): RcsPort {
  const found = ports.find((p) => p.name === name)
  if (!found) throw new Error(`no port named ${name}`)
  return found
}

describe('rcsPortLayout', () => {
  it('lays out an opposing pair for each of the three axes, twelve ports in all', () => {
    const ports = rcsPortLayout(hullBox())
    expect(ports).toHaveLength(12)
    expect(new Set(ports.map((p) => p.name)).size).toBe(12)
    for (const axis of ['tPitch', 'tYaw', 'tRoll'] as const) {
      const positive = ports.filter((p) => p[axis] > 0)
      const negative = ports.filter((p) => p[axis] < 0)
      expect(positive).toHaveLength(2)
      expect(negative).toHaveLength(2)
    }
  })

  it('inscribes every puff in the hull box even at maximum drive', () => {
    // Load-bearing, not cosmetic. `main.ts` seats a landing ship on the deck by its hull bounding box,
    // and three.js's Box3.setFromObject does not skip invisible children, so a puff that overhangs the
    // keel would park every ship a fraction of a unit above the pad whether it was lit or not.
    expect(rcsPortStyle(1).scale).toBeLessThanOrEqual(RCS_MAX_SCALE)
    for (const box of [
      hullBox(),
      { minX: -0.4, maxX: 0.4, minY: -0.3, maxY: 0.3, minZ: -6, maxZ: 6 }, // long and very thin
      { minX: -8, maxX: 8, minY: -8, maxY: 8, minZ: -8, maxZ: 8 },         // cubic and large
    ]) {
      for (const p of rcsPortLayout(box)) {
        const reach = p.radius * RCS_MAX_SCALE
        expect(p.x - reach).toBeGreaterThanOrEqual(box.minX - 1e-9)
        expect(p.x + reach).toBeLessThanOrEqual(box.maxX + 1e-9)
        expect(p.y - reach).toBeGreaterThanOrEqual(box.minY - 1e-9)
        expect(p.y + reach).toBeLessThanOrEqual(box.maxY + 1e-9)
        expect(p.z - reach).toBeGreaterThanOrEqual(box.minZ - 1e-9)
        expect(p.z + reach).toBeLessThanOrEqual(box.maxZ + 1e-9)
      }
    }
  })

  it('pushes each port out to the silhouette on its own axis', () => {
    // The first layout put the yaw pair a third of the way out and both puffs came back invisible in
    // capture: a hull's box width is set by its outrigger nacelles, so a third of the way out is inside
    // the fuselage. A port that is not on the outline is occluded on some hull in the fleet.
    const box = hullBox()
    const ports = rcsPortLayout(box)
    const halfW = (box.maxX - box.minX) / 2
    const halfH = (box.maxY - box.minY) / 2
    for (const name of ['nose_port', 'tail_port']) {
      expect(Math.abs(byName(ports, name).x)).toBeGreaterThan(halfW * 0.6)
    }
    for (const name of ['nose_top', 'tail_top']) {
      expect(byName(ports, name).y).toBeGreaterThan(halfH * 0.6)
    }
    // The roll pair goes further out than the yaw pair: it sits amidships, where the widest point of a
    // hull's box is actually made of hull.
    expect(Math.abs(byName(ports, 'tip_port_top').x))
      .toBeGreaterThan(Math.abs(byName(ports, 'nose_port').x))
  })

  it('puts each pitch and yaw pair on opposite ends of the hull, as a couple', () => {
    // Both ports of a pair on the same end would translate the ship as well as turn it, and would read
    // as a manoeuvring jet rather than as attitude control.
    const ports = rcsPortLayout(hullBox())
    expect(byName(ports, 'nose_bottom').z).toBeLessThan(byName(ports, 'tail_top').z)
    expect(byName(ports, 'nose_port').z).toBeLessThan(byName(ports, 'tail_starboard').z)
    // ...and the two ports of a pitch couple are on opposite sides of the centreline.
    expect(byName(ports, 'nose_bottom').y).toBeLessThan(byName(ports, 'tail_top').y)
    expect(byName(ports, 'nose_port').x).toBeLessThan(byName(ports, 'tail_starboard').x)
  })

  it('scales the puff with the hull so a small and a large hull read alike', () => {
    const small = rcsPortLayout({ minX: -1, maxX: 1, minY: -0.5, maxY: 0.5, minZ: -3, maxZ: 3 })
    const large = rcsPortLayout({ minX: -5, maxX: 5, minY: -3, maxY: 3, minZ: -9, maxZ: 9 })
    expect(large[0].radius).toBeGreaterThan(small[0].radius)
    expect(small[0].radius).toBeGreaterThan(0)
    expect(large[0].radius).toBeLessThanOrEqual(0.45)
  })

  it('survives a degenerate box instead of producing NaN positions', () => {
    // Reached whenever a hull is asked for its layout before anything is in it — a GLB that 404s leaves
    // the procedural placeholder, and the placeholder can be empty for a frame.
    const ports = rcsPortLayout({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 })
    for (const p of ports) {
      expect(Number.isFinite(p.x + p.y + p.z + p.radius)).toBe(true)
    }
  })
})

describe('rcsPortDrive', () => {
  it('fires the ports whose torque matches the demand and no others', () => {
    const ports = rcsPortLayout(hullBox())
    const lit = ports.filter((p) => rcsPortDrive(p, 1, 0, 0) > 0).map((p) => p.name)
    expect(lit.sort()).toEqual(['nose_bottom', 'tail_top'])
  })

  it('fires the opposing pair when the pilot releases and the hull has to be stopped', () => {
    // The counter-burn is the cue the whole feature exists for: after release the demand inverts, so
    // the thrusters that stop the turn are a different, visible pair from the ones that started it.
    const ports = rcsPortLayout(hullBox())
    const started = ports.filter((p) => rcsPortDrive(p, 0, 1, 0) > 0).map((p) => p.name).sort()
    const stopping = ports.filter((p) => rcsPortDrive(p, 0, -1, 0) > 0).map((p) => p.name).sort()
    expect(started).toEqual(['nose_port', 'tail_starboard'])
    expect(stopping).toEqual(['nose_starboard', 'tail_port'])
    expect(started.some((n) => stopping.includes(n))).toBe(false)
  })

  it('lights both axes partially on a diagonal instead of picking a winner', () => {
    const ports = rcsPortLayout(hullBox())
    const pitchPort = byName(ports, 'nose_bottom')
    const yawPort = byName(ports, 'nose_port')
    expect(rcsPortDrive(pitchPort, 0.5, 0.5, 0)).toBeCloseTo(0.5, 6)
    expect(rcsPortDrive(yawPort, 0.5, 0.5, 0)).toBeCloseTo(0.5, 6)
  })

  it('clamps to [0, 1] and never goes negative', () => {
    const port = byName(rcsPortLayout(hullBox()), 'nose_bottom')
    expect(rcsPortDrive(port, 5, 0, 0)).toBe(1)
    expect(rcsPortDrive(port, -5, 0, 0)).toBe(0)
    expect(rcsPortDrive(port, 0, 0, 0)).toBe(0)
  })
})

describe('approachRcsDrive', () => {
  it('rises much faster than it falls', () => {
    expect(RCS_RISE_RATE).toBeGreaterThan(RCS_FALL_RATE)
    const dt = 1 / 60
    const up = approachRcsDrive(0, 1, dt)
    const down = 1 - approachRcsDrive(1, 0, dt)
    expect(up).toBeGreaterThan(down)
    expect(up).toBeGreaterThan(0.3) // the opening crack has to be visible in a single frame
  })

  it('stays in range for any dt, including a frozen frame and a long stall', () => {
    for (const dt of [0, 1 / 240, 1 / 60, 0.05, 2]) {
      expect(approachRcsDrive(0, 1, dt)).toBeGreaterThanOrEqual(0)
      expect(approachRcsDrive(0, 1, dt)).toBeLessThanOrEqual(1)
      expect(approachRcsDrive(1, 0, dt)).toBeGreaterThanOrEqual(0)
    }
    expect(approachRcsDrive(0.4, 1, 0)).toBeCloseTo(0.4, 9) // dev.freeze holds the puff, not resets it
  })
})

describe('rcsPortStyle', () => {
  it('switches the mesh off rather than drawing an invisible one', () => {
    expect(rcsPortStyle(0).visible).toBe(false)
    expect(rcsPortStyle(0.001).visible).toBe(false)
    expect(rcsPortStyle(0.4).visible).toBe(true)
  })

  it('brightens, opens up and grows with drive', () => {
    const dim = rcsPortStyle(0.15)
    const hot = rcsPortStyle(1)
    expect(hot.intensity).toBeGreaterThan(dim.intensity)
    expect(hot.opacity).toBeGreaterThan(dim.opacity)
    expect(hot.scale).toBeGreaterThan(dim.scale)
    expect(hot.intensity).toBeGreaterThan(1) // needs to be over unity to reach the bloom threshold
    expect(hot.opacity).toBeLessThanOrEqual(1)
  })
})

describe('rcsManeuverLoad', () => {
  it('reads full effort from a single-axis slam', () => {
    expect(rcsManeuverLoad(0, 1, 0)).toBe(1)
    expect(rcsManeuverLoad(-1, 0, 0)).toBe(1)
  })

  it('is zero on a hull nobody is turning, and clamped otherwise', () => {
    expect(rcsManeuverLoad(0, 0, 0)).toBe(0)
    expect(rcsManeuverLoad(3, -4, 0)).toBe(1)
    expect(rcsManeuverLoad(0.3, 0.1, -0.2)).toBeCloseTo(0.3, 6)
  })
})
