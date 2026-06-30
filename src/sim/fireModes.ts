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

// spreadDirections is added in the next task.
export function spreadDirections(_forward: Vector3, _pellets: number, _spreadRad: number, _rng: () => number): Vector3[] {
  return [_forward.clone().normalize()]
}
