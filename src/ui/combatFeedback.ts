export interface TimedCombatFeedback {
  text?: string
  subtext?: string
  born: number
  until: number
  color: string
}

export interface CombatFeedbackState {
  hitMarker: TimedCombatFeedback
  killBanner: TimedCombatFeedback | null
}

const HIT_MARKER_MS = 240
const KILL_BANNER_MS = 2300

export function createCombatFeedbackState(): CombatFeedbackState {
  return {
    hitMarker: { born: 0, until: 0, color: '#fff2a8' },
    killBanner: null,
  }
}

export function combatFeedbackAlpha(feedback: TimedCombatFeedback | null, now: number): number {
  if (!feedback || now >= feedback.until) return 0
  const duration = Math.max(1, feedback.until - feedback.born)
  const t = Math.max(0, Math.min(1, (now - feedback.born) / duration))
  if (t < 0.18) return t / 0.18
  if (t < 0.45) return 1
  return Math.max(0, 1 - ((t - 0.45) / 0.55))
}

export function registerHitMarker(state: CombatFeedbackState, now: number): void {
  state.hitMarker = {
    born: now,
    until: now + HIT_MARKER_MS,
    color: '#fff2a8',
  }
}

export function registerKillBanner(state: CombatFeedbackState, text: string, subtext: string | undefined, now: number): void {
  state.killBanner = {
    text,
    subtext,
    born: now,
    until: now + KILL_BANNER_MS,
    color: '#ff5dff',
  }
}
