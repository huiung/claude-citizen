import { Vector3 } from 'three'

export interface TimeTrialGate {
  id: string
  position: Vector3
  radius: number
}

export interface TimeTrialState {
  gates: readonly TimeTrialGate[]
  active: boolean
  startArmed: boolean
  startTime: number
  nextGateIndex: number
  bestTime: number | null
  lastFinishTime: number | null
}

export type TimeTrialEvent = 'none' | 'start' | 'gate' | 'finish'

export interface TimeTrialUpdate {
  event: TimeTrialEvent
  time?: number
  gateIndex?: number
}

export function createTimeTrial(gates: readonly TimeTrialGate[], bestTime: number | null = null): TimeTrialState {
  return {
    gates,
    active: false,
    startArmed: true,
    startTime: 0,
    nextGateIndex: 0,
    bestTime,
    lastFinishTime: null,
  }
}

function insideGate(position: Vector3, gate: TimeTrialGate): boolean {
  return position.distanceToSquared(gate.position) <= gate.radius * gate.radius
}

export function updateTimeTrial(state: TimeTrialState, position: Vector3, nowSeconds: number): TimeTrialUpdate {
  if (state.gates.length === 0) return { event: 'none' }
  const gate = state.gates[state.nextGateIndex]
  if (!gate || !insideGate(position, gate)) {
    if (!state.active) rearmTimeTrialStart(state, position)
    return { event: 'none' }
  }

  if (!state.active) {
    if (!state.startArmed) return { event: 'none' }
    state.active = true
    state.startArmed = true
    state.startTime = nowSeconds
    state.nextGateIndex = Math.min(1, state.gates.length - 1)
    state.lastFinishTime = null
    return { event: 'start', gateIndex: 0 }
  }

  const gateIndex = state.nextGateIndex
  const isFinish = gateIndex >= state.gates.length - 1
  if (!isFinish) {
    state.nextGateIndex += 1
    return { event: 'gate', gateIndex }
  }

  const elapsed = Math.max(0, nowSeconds - state.startTime)
  state.active = false
  state.startArmed = false
  state.nextGateIndex = 0
  state.lastFinishTime = elapsed
  if (state.bestTime === null || elapsed < state.bestTime) state.bestTime = elapsed
  return { event: 'finish', gateIndex, time: elapsed }
}

export function rearmTimeTrialStart(state: TimeTrialState, position: Vector3): void {
  const start = state.gates[0]
  if (!start || !insideGate(position, start)) state.startArmed = true
}

export function formatTrialTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remaining = safe - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`
}

export function timeTrialStatusText(state: TimeTrialState, nowSeconds: number): string {
  const best = state.bestTime === null ? 'NO BEST' : `BEST ${formatTrialTime(state.bestTime)}`
  if (!state.active) return `HUB TIME TRIAL - ${best}`
  const elapsed = nowSeconds - state.startTime
  return `HUB TIME TRIAL - GATE ${state.nextGateIndex + 1}/${state.gates.length} - ${formatTrialTime(elapsed)} - ${best}`
}

export function timeTrialEventBannerText(update: TimeTrialUpdate, gateCount: number, newBest = false): string {
  if (update.event === 'start') return 'RACE STARTED'
  if (update.event === 'gate' && update.gateIndex !== undefined) return `GATE ${update.gateIndex + 1}/${gateCount}`
  if (update.event === 'finish' && update.time !== undefined) {
    return `${newBest ? 'NEW BEST' : 'FINISH'} - ${formatTrialTime(update.time)}`
  }
  return ''
}
