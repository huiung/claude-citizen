// Sector 1 story campaign — a linear quest chain that paces a player through the level-1→5 loop.
// Pure + deterministic (mirrors journey.ts / daily.ts). The active step advances when its counter
// hits the target; the caller applies the XP + credit rewards and reacts to sector unlocks.

export type CampaignCounter = 'kill_pirates' | 'mine_ore' | 'kill_named'

export interface CampaignStepDef {
  id: string
  label: string
  counter: CampaignCounter
  target: number
  xpReward: number
  creditReward: number
  unlockSector?: number
}

// Steps 3 and 4 both use 'kill_named' — main.ts spawns the matching named enemy for the active step
// (Vex Marrow, then the heavier Raider Captain), so each named kill advances exactly one step.
export const SECTOR1_CAMPAIGN: readonly CampaignStepDef[] = [
  { id: 's1-patrol', label: 'Patrol the Refinery Belt — destroy 5 raiders', counter: 'kill_pirates', target: 5, xpReward: 150, creditReward: 800 },
  { id: 's1-supply', label: 'Cut their supply — mine 200 ORE', counter: 'mine_ore', target: 200, xpReward: 200, creditReward: 1200 },
  { id: 's1-wanted', label: 'Wanted — hunt the raider Vex Marrow', counter: 'kill_named', target: 1, xpReward: 300, creditReward: 2500 },
  { id: 's1-captain', label: 'Break the raider captain', counter: 'kill_named', target: 1, xpReward: 500, creditReward: 5000, unlockSector: 2 },
]

export interface CampaignState {
  step: number          // index into SECTOR1_CAMPAIGN; === length when complete
  progress: number      // progress into the active step's counter
  sectorUnlocked: number // highest sector index the player may enter (starts at 1)
}

export function emptyCampaign(): CampaignState {
  return { step: 0, progress: 0, sectorUnlocked: 1 }
}

export function currentCampaignStep(s: CampaignState): CampaignStepDef | null {
  return s.step >= 0 && s.step < SECTOR1_CAMPAIGN.length ? SECTOR1_CAMPAIGN[s.step] : null
}

export interface CampaignAdvance {
  advanced: boolean
  completed: CampaignStepDef | null // the step just finished (caller grants its rewards), or null
}

export function recordCampaignEvent(s: CampaignState, counter: CampaignCounter, amount: number): CampaignAdvance {
  const step = currentCampaignStep(s)
  if (!step || step.counter !== counter) return { advanced: false, completed: null }
  s.progress += Math.max(0, amount)
  if (s.progress < step.target) return { advanced: false, completed: null }
  s.step += 1
  s.progress = 0
  if (step.unlockSector) s.sectorUnlocked = Math.max(s.sectorUnlocked, step.unlockSector)
  return { advanced: true, completed: step }
}

const STORAGE_KEY = 'scc.campaign.v1'

export function loadCampaign(storage: Storage): CampaignState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyCampaign()
    const p = JSON.parse(raw)
    if (typeof p?.step !== 'number') return emptyCampaign()
    return {
      step: Math.max(0, Math.floor(p.step)),
      progress: Math.max(0, p.progress ?? 0),
      sectorUnlocked: Math.max(1, p.sectorUnlocked ?? 1),
    }
  } catch {
    return emptyCampaign()
  }
}

export function saveCampaign(s: CampaignState, storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable — campaign is ephemeral then */
  }
}
