import { describe, expect, it } from 'vitest'
import { nextJourneyGoal, type JourneySnapshot } from './journey'

function snap(overrides: Partial<JourneySnapshot> = {}): JourneySnapshot {
  return {
    minedEver: false,
    dockedEver: false,
    pirateDestroyed: false,
    upgradeCount: 0,
    earnedCredits: 0,
    ownedShips: 1,
    dailyClaimed: 0,
    craftedItems: 0,
    raceFinished: false,
    blackHoleRecorded: false,
    ...overrides,
  }
}

describe('nextJourneyGoal', () => {
  it('starts new pilots with the first mining step', () => {
    expect(nextJourneyGoal(snap())?.id).toBe('mine-first-ore')
  })

  it('walks pilots through station, combat, upgrade, daily, crafting, and exploration beats', () => {
    expect(nextJourneyGoal(snap({ minedEver: true }))?.id).toBe('dock-first-station')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true }))?.id).toBe('destroy-first-pirate')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true }))?.id).toBe('buy-first-upgrade')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 999 }))?.id).toBe('reach-ensign')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 1000 }))?.id).toBe('complete-first-daily')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 1000, dailyClaimed: 1 }))?.id).toBe('craft-first-cosmetic')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 1000, dailyClaimed: 1, craftedItems: 1 }))?.id).toBe('buy-second-ship')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 1000, dailyClaimed: 1, craftedItems: 1, ownedShips: 2 }))?.id).toBe('finish-first-race')
    expect(nextJourneyGoal(snap({ minedEver: true, dockedEver: true, pirateDestroyed: true, upgradeCount: 1, earnedCredits: 1000, dailyClaimed: 1, craftedItems: 1, ownedShips: 2, raceFinished: true }))?.id).toBe('survive-black-hole')
  })

  it('ends once the first career arc reaches Pilot rank', () => {
    const done = snap({
      minedEver: true,
      dockedEver: true,
      pirateDestroyed: true,
      upgradeCount: 1,
      earnedCredits: 5000,
      ownedShips: 2,
      dailyClaimed: 1,
      craftedItems: 1,
      raceFinished: true,
      blackHoleRecorded: true,
    })
    expect(nextJourneyGoal(done)).toBeNull()
  })
})
