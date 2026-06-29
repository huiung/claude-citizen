import { describe, expect, it } from 'vitest'
import {
  SECTOR1_CAMPAIGN, currentCampaignStep, emptyCampaign, loadCampaign, recordCampaignEvent, saveCampaign,
} from './campaign'

function memStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

describe('campaign chain', () => {
  it('starts on the first step', () => {
    expect(currentCampaignStep(emptyCampaign())?.id).toBe(SECTOR1_CAMPAIGN[0].id)
  })

  it("only the active step's counter advances it", () => {
    const s = emptyCampaign() // step 0 wants kill_pirates
    expect(recordCampaignEvent(s, 'mine_ore', 999).advanced).toBe(false)
    expect(s.step).toBe(0)
  })

  it('advances when the target is met and reports the completed step', () => {
    const s = emptyCampaign()
    const step0 = SECTOR1_CAMPAIGN[0]
    for (let i = 0; i < step0.target - 1; i++) expect(recordCampaignEvent(s, 'kill_pirates', 1).advanced).toBe(false)
    const r = recordCampaignEvent(s, 'kill_pirates', 1)
    expect(r.advanced).toBe(true)
    expect(r.completed?.id).toBe(step0.id)
    expect(s.step).toBe(1)
    expect(s.progress).toBe(0)
  })

  it('runs all the way through and unlocks Sector 2 on the final step', () => {
    const s = emptyCampaign()
    recordCampaignEvent(s, 'kill_pirates', SECTOR1_CAMPAIGN[0].target) // step 0 → 1
    recordCampaignEvent(s, 'mine_ore', SECTOR1_CAMPAIGN[1].target)     // step 1 → 2
    recordCampaignEvent(s, 'kill_named', SECTOR1_CAMPAIGN[2].target)   // step 2 → 3
    const last = recordCampaignEvent(s, 'kill_named', SECTOR1_CAMPAIGN[3].target) // step 3 → done
    expect(last.completed?.unlockSector).toBe(2)
    expect(s.sectorUnlocked).toBe(2)
    expect(currentCampaignStep(s)).toBeNull()
  })

  it('persists and clamps bad data', () => {
    const storage = memStorage()
    const s = emptyCampaign()
    recordCampaignEvent(s, 'kill_pirates', 2)
    saveCampaign(s, storage)
    expect(loadCampaign(storage)).toEqual(s)
    storage.setItem('scc.campaign.v1', '{"step":-1}')
    expect(loadCampaign(storage).step).toBe(0)
    storage.setItem('scc.campaign.v1', '{"step":9999}')
    expect(loadCampaign(storage).step).toBe(SECTOR1_CAMPAIGN.length)
  })
})
