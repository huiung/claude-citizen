import { Vector3 } from 'three'
import type { ControlInput } from '../sim/physics'

export interface MobileFlightState {
  stickX: number
  stickY: number
  thrustHeld: boolean
  boostHeld: boolean
  brakeHeld: boolean
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
}

export function mobileFlightInput(state: MobileFlightState): ControlInput {
  const brake = state.brakeHeld
  return {
    thrust: new Vector3(0, 0, brake || !state.thrustHeld ? 0 : 1),
    pitch: clampAxis(-state.stickY),
    yaw: clampAxis(state.stickX),
    roll: 0,
    boost: state.boostHeld && !brake,
    brake,
    assist: true,
  }
}
