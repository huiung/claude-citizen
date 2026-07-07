import type { SurfaceKind } from '../sim/solarSystem'

/** Per-kind atmosphere look. Pure data so the numbers are testable and reviewable
 *  without reading GLSL. Realism notes: airless rocky bodies barely glow; Mars's thin
 *  CO2 air famously makes BLUE sunsets; Venus/gas air is thick so the glow bleeds
 *  far across the disc (low power). */
export interface AtmosphereParams {
  /** limb tint on the un-sunset part of the shell */
  baseColor: number
  /** lit-limb (day side) Rayleigh tint the base shifts toward */
  rayleighColor: number
  /** warm (or Mars-blue) band across the terminator */
  sunsetColor: number
  /** Fresnel exponent — lower = thicker air bleeding further over the disc */
  power: number
  /** overall multiplier */
  intensity: number
}

export const ATMOSPHERE_PARAMS: Readonly<Record<SurfaceKind, AtmosphereParams>> = {
  earth: { baseColor: 0x88bbff, rayleighColor: 0x5f9dff, sunsetColor: 0xff9a55, power: 3.0, intensity: 1.0 },
  venus: { baseColor: 0xe8c070, rayleighColor: 0xf0d898, sunsetColor: 0xffb060, power: 2.2, intensity: 1.15 },
  mars: { baseColor: 0xc9a184, rayleighColor: 0xd9b49a, sunsetColor: 0x8fb2e0, power: 3.4, intensity: 0.55 },
  rocky: { baseColor: 0x9fb4c8, rayleighColor: 0x9fb4c8, sunsetColor: 0xffb070, power: 3.6, intensity: 0.3 },
  gas: { baseColor: 0xd8c0a0, rayleighColor: 0xcfd8e8, sunsetColor: 0xffab60, power: 2.2, intensity: 1.0 },
}
