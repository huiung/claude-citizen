export interface JourneySnapshot {
  minedEver: boolean
  dockedEver: boolean
  pirateDestroyed: boolean
  upgradeCount: number
  earnedCredits: number
  ownedShips: number
  dailyClaimed: number
  craftedItems: number
  raceFinished: boolean
  blackHoleRecorded: boolean
}

export interface JourneyGoal {
  id: string
  label: string
  progress?: string
}

function creditsProgress(current: number, target: number): string {
  return `${Math.floor(current).toLocaleString()} / ${target.toLocaleString()} cr`
}

export function nextJourneyGoal(s: JourneySnapshot): JourneyGoal | null {
  if (!s.minedEver) {
    return { id: 'mine-first-ore', label: 'Mine your first ORE from a cyan-veined asteroid' }
  }
  if (!s.dockedEver) {
    return { id: 'dock-first-station', label: 'Dock at an outpost with Space to trade, upgrade, and craft' }
  }
  if (!s.pirateDestroyed) {
    return { id: 'destroy-first-pirate', label: 'Destroy your first pirate with Right-click fire' }
  }
  if (s.upgradeCount <= 0) {
    return { id: 'buy-first-upgrade', label: 'Buy your first station upgrade' }
  }
  if (s.earnedCredits < 1000) {
    return { id: 'reach-ensign', label: 'Reach Career Rank: Ensign', progress: creditsProgress(s.earnedCredits, 1000) }
  }
  if (s.dailyClaimed <= 0) {
    return { id: 'complete-first-daily', label: 'Complete one daily objective from the G panel', progress: '0 / 1 daily' }
  }
  if (s.craftedItems <= 0) {
    return { id: 'craft-first-cosmetic', label: 'Craft your first cosmetic kit at a station' }
  }
  if (s.ownedShips < 2) {
    return { id: 'buy-second-ship', label: 'Buy a second ship at a station', progress: `${s.ownedShips} / 2 ships` }
  }
  if (!s.raceFinished) {
    return { id: 'finish-first-race', label: 'Finish a race and record your first time' }
  }
  if (!s.blackHoleRecorded) {
    return { id: 'survive-black-hole', label: 'Survive a black hole dive and record a closest approach' }
  }
  if (s.earnedCredits < 5000) {
    return { id: 'reach-pilot', label: 'Reach Career Rank: Pilot', progress: creditsProgress(s.earnedCredits, 5000) }
  }
  return null
}
