export function shouldRunBackgroundWorldWork(state: { running: boolean; docked: boolean }): boolean {
  return state.running && !state.docked
}

export function shouldRenderWorldFrame(state: { running: boolean; docked: boolean; solarMapOpen: boolean }): boolean {
  if (state.solarMapOpen) return false
  return !(state.running && state.docked)
}
