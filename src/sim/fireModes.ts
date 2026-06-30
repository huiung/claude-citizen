// Pure right-click fire-mode profiles. A mode is a multiplier set applied to a base weapon
// {interval, damage, speed}; the three modes are tuned to EQUAL nominal DPS
// (pellets * damageMul / intervalMul ≈ 1) so variety is situational, not power creep.
import { Vector3 } from 'three'

export type FireModeId = 'rapid' | 'heavy' | 'scatter'

export interface FireMode {
  id: FireModeId
  label: string
  intervalMul: number
  damageMul: number
  pellets: number
  spreadRad: number // half-angle of the cone; 0 = no spread
  speedMul: number
}

export interface BaseWeapon { interval: number; damage: number; speed: number }
export interface ResolvedShot { interval: number; damage: number; pellets: number; spreadRad: number; speed: number }

// Starting values for live tuning. DPS check: rapid 1*1/1=1, heavy 1*2.2/2.2=1, scatter 4*0.25/1=1.
export const FIRE_MODES: FireMode[] = [
  { id: 'rapid',   label: 'RAPID',   intervalMul: 1,   damageMul: 1,    pellets: 1, spreadRad: 0,    speedMul: 1 },
  { id: 'heavy',   label: 'HEAVY',   intervalMul: 2.2, damageMul: 2.2,  pellets: 1, spreadRad: 0,    speedMul: 1.25 },
  { id: 'scatter', label: 'SCATTER', intervalMul: 1,   damageMul: 0.25, pellets: 4, spreadRad: 0.07, speedMul: 0.9 },
]

export function modeById(id: FireModeId): FireMode {
  return FIRE_MODES.find((m) => m.id === id) ?? FIRE_MODES[0]
}

export function cycleMode(id: FireModeId, dir: 1 | -1): FireModeId {
  const i = FIRE_MODES.findIndex((m) => m.id === id)
  const base = i < 0 ? 0 : i
  const n = FIRE_MODES.length
  return FIRE_MODES[(base + dir + n) % n].id
}

export function resolveShot(base: BaseWeapon, mode: FireMode): ResolvedShot {
  return {
    interval: base.interval * mode.intervalMul,
    damage: base.damage * mode.damageMul,
    speed: base.speed * mode.speedMul,
    pellets: mode.pellets,
    spreadRad: mode.spreadRad,
  }
}

// Rescale a weapon's remaining cooldown when the fire mode switches, preserving the elapsed FRACTION
// of the gap. The base weapon's interval cancels out, so only the two modes' intervalMuls matter:
// remaining' = remaining * (nextMul / prevMul). This stops the "fire RAPID, instant-swap to HEAVY,
// land a heavy slug after a rapid cooldown" trick — switching to a slower mode stretches the wait,
// so no mode-swap ever buys a faster-than-earned shot. Keeps the equal-DPS invariant honest.
export function rescaleCooldown(cooldown: number, prevIntervalMul: number, nextIntervalMul: number): number {
  if (cooldown <= 0 || prevIntervalMul <= 0) return cooldown
  return cooldown * (nextIntervalMul / prevIntervalMul)
}

// Fan `pellets` unit vectors around `forward`, each tilted up to `spreadRad` off-axis, evenly
// distributed in azimuth around the forward axis (Vogel-ish) with a small rng jitter on the tilt so
// volleys aren't a frozen pattern. pellets <= 1 (or spreadRad 0) returns forward alone.
export function spreadDirections(forward: Vector3, pellets: number, spreadRad: number, rng: () => number): Vector3[] {
  const fwd = forward.clone().normalize()
  if (pellets <= 1 || spreadRad <= 0) return [fwd]
  // Build an orthonormal basis (u, v) perpendicular to fwd.
  const ref = Math.abs(fwd.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const u = new Vector3().crossVectors(fwd, ref).normalize()
  const v = new Vector3().crossVectors(fwd, u).normalize()
  const out: Vector3[] = []
  for (let i = 0; i < pellets; i++) {
    const az = (i / pellets) * Math.PI * 2
    const tilt = spreadRad * (0.5 + 0.5 * rng()) // 50–100% of the cone, jittered
    const dir = fwd.clone().multiplyScalar(Math.cos(tilt))
    dir.addScaledVector(u, Math.sin(tilt) * Math.cos(az))
    dir.addScaledVector(v, Math.sin(tilt) * Math.sin(az))
    out.push(dir.normalize())
  }
  return out
}
