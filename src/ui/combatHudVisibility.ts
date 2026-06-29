export interface CombatHudVisibilityState {
  running: boolean
  docked: boolean
  bot: boolean
  botActivityKind?: string | null
}

export function shouldShowCombatHud(state: CombatHudVisibilityState): boolean {
  if (!state.running || state.docked) return false
  if (!state.bot) return true
  return state.botActivityKind === 'pvp-training'
}
