import { describe, expect, it } from 'vitest'
import {
  CAREER_SCRUB_CEILING, guardEconomyGrowth, guardPilotGrowth, MAX_CREDIT_RISE_FLOOR, MAX_EARN_RATE, MAX_EARN_WINDOW_SEC,
  MAX_PILOT_LEVEL, MAX_XP_RATE, MAX_XP_WINDOW_SEC,
  cumulativeXp, levelForTotal,
  sanitizeCrafting, sanitizeProgress, scrubCareerOutliers,
} from './progress.mjs'

describe('server XP curve (mirror of src/sim/pilotLevel.ts)', () => {
  it('matches the client cumulative-XP totals', () => {
    expect(cumulativeXp(1, 0)).toBe(0)
    expect(cumulativeXp(2, 0)).toBe(80)              // xpForLevel(1)
    expect(cumulativeXp(5, 0)).toBe(1200)            // 80+200+360+560
    expect(cumulativeXp(3, 40)).toBe(80 + 200 + 40)  // prior costs + xp-into-level
  })

  it('round-trips level/xp through cumulative + inverse', () => {
    for (const [lvl, xp] of [[1, 0], [3, 40], [5, 0], [10, 15], [19, 100]]) {
      expect(levelForTotal(cumulativeXp(lvl, xp))).toEqual({ level: lvl, xp })
    }
  })

  it('caps at MAX_PILOT_LEVEL with xp pinned to 0', () => {
    expect(MAX_PILOT_LEVEL).toBe(20)
    expect(levelForTotal(cumulativeXp(20, 0))).toEqual({ level: 20, xp: 0 })
    expect(levelForTotal(99_999_999)).toEqual({ level: 20, xp: 0 })
  })

  it('clamps bad input', () => {
    expect(cumulativeXp(-5, -9)).toBe(0)       // level floored to 1, xp floored to 0
    expect(levelForTotal(-100)).toEqual({ level: 1, xp: 0 })
  })
})

describe('guardEconomyGrowth', () => {
  const row = (earned, credits, careerAt) => ({ earned, credits, ...(careerAt !== undefined ? { _careerAt: careerAt } : {}) })

  it('clamps a 40M earned jump over a short interval to the time budget; credits use the floor', () => {
    const now = 10_000_000
    const prev = row(5000, 5000, now - 2000) // last save 2s ago → 2000 earn budget
    const out = guardEconomyGrowth({ earned: 40_000_000, credits: 40_000_000 }, prev, now)
    expect(out.earned).toBe(5000 + MAX_EARN_RATE * 2) // earned: tight rate×elapsed cap (Career anti-cheat)
    expect(out.credits).toBe(5000 + MAX_CREDIT_RISE_FLOOR) // credits: flat floor allowance (>> earn budget)
    expect(out._careerAt).toBe(now)
  })

  it('accepts a +100k credit win on a near-zero-elapsed save, but clamps the same-size earned rise', () => {
    const now = 10_000_000
    const prev = row(50_000, 50_000, now - 1) // ~0s elapsed → ~0 earn budget
    const out = guardEconomyGrowth({ earned: 150_000, credits: 150_000 }, prev, now)
    expect(out.credits).toBe(150_000) // +100k credit rise fits under the 250k floor → not clamped
    expect(out.earned).toBeLessThan(150_000) // same-size earned rise IS clamped to the earn budget
    expect(out.earned).toBeCloseTo(50_000 + MAX_EARN_RATE * 0.001, 0)
  })

  it('allows a legit increase within the time budget', () => {
    const now = 10_000_000
    const prev = row(1000, 1000, now - 60_000) // 60s → 60k budget
    const out = guardEconomyGrowth({ earned: 31_000, credits: 25_000 }, prev, now)
    expect(out.earned).toBe(31_000)
    expect(out.credits).toBe(25_000)
  })

  it('never lowers lifetime earned, but lets credits be spent freely', () => {
    const now = 10_000_000
    const out = guardEconomyGrowth({ earned: 10, credits: 8000 }, row(50_000, 50_000, now - 1000), now)
    expect(out.earned).toBe(50_000) // monotonic
    expect(out.credits).toBe(8000)  // spending allowed
  })

  it('caps a first save / legacy row to a single window of budget', () => {
    const now = 10_000_000
    const first = guardEconomyGrowth({ earned: 40_000_000, credits: 40_000_000 }, null, now)
    expect(first.earned).toBe(MAX_EARN_RATE * MAX_EARN_WINDOW_SEC) // 1000 * 3600 = 3.6M
    const legacy = guardEconomyGrowth({ earned: 8_500_000, credits: 100 }, row(8_000_000, 100), now)
    expect(legacy.earned).toBe(8_500_000) // +500k < 3.6M budget
  })

  it('window-caps the budget even after a long offline gap', () => {
    const now = 10_000_000_000
    const prev = row(1000, 1000, now - 7 * 24 * 3600 * 1000) // a week ago
    const out = guardEconomyGrowth({ earned: 40_000_000, credits: 40_000_000 }, prev, now)
    expect(out.earned).toBe(1000 + MAX_EARN_RATE * MAX_EARN_WINDOW_SEC)
  })
})

describe('scrubCareerOutliers', () => {
  it('clamps a legacy outlier row to the ceiling and stamps it', () => {
    const store = { cheater: { earned: 40_000_000, credits: 40_000_000, name: 'X' } }
    const scrubbed = scrubCareerOutliers(store, 12345)
    expect(store.cheater.earned).toBe(CAREER_SCRUB_CEILING)
    expect(store.cheater.credits).toBe(CAREER_SCRUB_CEILING)
    expect(store.cheater._careerAt).toBe(12345)
    expect(scrubbed.map((s) => s.key)).toEqual(['cheater'])
  })

  it('leaves normal rows and already-guarded rows untouched', () => {
    const store = {
      legit: { earned: 8_000_000, credits: 100_000 },
      guarded: { earned: 40_000_000, credits: 40_000_000, _careerAt: 999 },
    }
    const scrubbed = scrubCareerOutliers(store, 12345)
    expect(store.legit.earned).toBe(8_000_000)
    expect(store.guarded.earned).toBe(40_000_000) // _careerAt → earned legitimately under the guard
    expect(scrubbed).toEqual([])
  })
})

describe('progress sanitization', () => {
  it('keeps known crafted inventory items and drops unknown entries', () => {
    const clean = sanitizeProgress({
      credits: 123,
      earned: 456,
      cargo: { ORE: 7, ALLOY: 8 },
      upgrades: { cargo: 1, speed: 2, boost: 3, mining: 4 },
      hangar: { selected: 'fighter', owned: ['hauler', 'fighter'] },
      crafting: {
        cores: 2.9,
        items: [
          {
            id: 'item-1',
            recipeId: 'aurum-trail-kit',
            rarity: 'rare',
            variant: 'Blue Aurum Trail',
            createdAt: 123.9,
            tradable: false,
          },
          {
            id: 'item-comet',
            recipeId: 'comet-wake-kit',
            rarity: 'legendary',
            variant: '',
            createdAt: 321,
            tradable: true,
          },
          { id: 'bad', recipeId: 'bad-kit', rarity: 'legendary', variant: 'Bad', createdAt: 1 },
          { id: 'bad-rarity', recipeId: 'void-runner-kit', rarity: 'mythic', variant: 'Bad', createdAt: 1 },
        ],
      },
    })

    expect(clean?.crafting).toEqual({
      cores: 2,
      items: [
        {
          id: 'item-1',
          recipeId: 'aurum-trail-kit',
          rarity: 'rare',
          variant: 'Blue Aurum Trail',
          createdAt: 123,
          tradable: false,
        },
        {
          id: 'item-comet',
          recipeId: 'comet-wake-kit',
          rarity: 'legendary',
          variant: 'Celestial Comet Wake',
          createdAt: 321,
          tradable: true,
        },
      ],
      equipped: { trail: null, hull: null, aura: null },
      pityCount: 0,
    })
  })

  it('migrates old saves without crafting to an empty crafting state', () => {
    const clean = sanitizeProgress({
      credits: 100,
      cargo: { ORE: 0, ALLOY: 0 },
      upgrades: {},
      hangar: {},
    })

    expect(clean?.crafting).toEqual({ cores: 0, items: [], equipped: { trail: null, hull: null, aura: null }, pityCount: 0 })
  })

  it('migrates legacy crafted cosmetic ids into common inventory items', () => {
    const clean = sanitizeProgress({
      credits: 100,
      cargo: { ORE: 0, ALLOY: 0 },
      upgrades: {},
      hangar: {},
      crafting: {
        cosmetics: ['aurum-trail-kit', 'bad-kit', 'void-runner-kit'],
      },
    })

    expect(clean?.crafting.items.map((item) => [item.id, item.recipeId, item.rarity, item.tradable])).toEqual([
      ['legacy-aurum-trail-kit-0', 'aurum-trail-kit', 'common', true],
      ['legacy-void-runner-kit-1', 'void-runner-kit', 'common', true],
    ])
  })
})

describe('daily sanitization', () => {
  const base = {
    credits: 1, earned: 1, cargo: { ORE: 0, ALLOY: 0 },
    upgrades: { cargo: 0, speed: 0, boost: 0, mining: 0 },
    hangar: { selected: 'hauler', owned: ['hauler'] },
  }

  it('passes through a valid daily block', () => {
    const out = sanitizeProgress({ ...base, daily: {
      day: '2026-06-26', claimed: ['mine_ore'], setBonusClaimed: false, streak: 4, lastStreakDay: '2026-06-26',
    } })
    expect(out.daily).toEqual({
      day: '2026-06-26', claimed: ['mine_ore'], setBonusClaimed: false, streak: 4, lastStreakDay: '2026-06-26',
    })
  })

  it('clamps streak and caps claimed to 3 distinct strings', () => {
    const out = sanitizeProgress({ ...base, daily: {
      day: '2026-06-26', claimed: ['a', 'a', 'b', 'c', 'd', 5], streak: 1e9, lastStreakDay: 'x',
    } })
    expect(out.daily.streak).toBe(9999)
    expect(out.daily.claimed).toEqual(['a', 'b', 'c'])
    expect(out.daily.lastStreakDay).toBe('') // not date-shaped
  })

  it('defaults a missing or garbage daily block', () => {
    expect(sanitizeProgress(base).daily).toEqual({
      day: '', claimed: [], setBonusClaimed: false, streak: 0, lastStreakDay: '',
    })
    expect(sanitizeProgress({ ...base, daily: 'nope' }).daily.streak).toBe(0)
  })
})

describe('sanitizeCrafting equipped', () => {
  const item = { id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'legendary', variant: 'Radiant Aurum Trail', createdAt: 1, tradable: true }

  it('defaults equipped to empty slots for old state', () => {
    expect(sanitizeCrafting({ cores: 0, items: [] }).equipped).toEqual({ trail: null, hull: null, aura: null })
  })

  it('keeps an equipped slot only when the item id is present', () => {
    const out = sanitizeCrafting({ cores: 0, items: [item], equipped: { trail: 'i1', hull: 'ghost', aura: null } })
    expect(out.equipped).toEqual({ trail: 'i1', hull: null, aura: null })
  })

  it('passes through and clamps pityCount', () => {
    expect(sanitizeCrafting({ cores: 0, items: [] }).pityCount).toBe(0)        // missing → 0
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 12 }).pityCount).toBe(12)
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: -4 }).pityCount).toBe(0)   // clamp low
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 999 }).pityCount).toBe(20) // clamp to guarantee
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 7.9 }).pityCount).toBe(7)  // floored
  })
})

const NOW = 1_000_000_000_000 // fixed server clock for deterministic tests

describe('guardPilotGrowth', () => {
  it('passes a null pilot through untouched', () => {
    const r = guardPilotGrowth(undefined, null, NOW)
    expect(r.pilot).toBeUndefined()
    expect(r.pilotAt).toBe(NOW)
  })

  it('first save grants one window of budget and caps an instant level-20 claim', () => {
    // No prev / no _pilotAt → budget = MAX_XP_RATE * MAX_XP_WINDOW_SEC = 6000 XP.
    // 6000 XP cannot reach level 20 (cumulative to 20 is tens of thousands), so it is bounded down.
    const r = guardPilotGrowth({ level: 20, xp: 0 }, null, NOW)
    expect(r.pilot.level).toBeLessThan(20)
    expect(r.pilotAt).toBe(NOW)
  })

  it('accepts a legitimate small claim within budget', () => {
    const r = guardPilotGrowth({ level: 5, xp: 0 }, null, NOW) // 1200 total, under 6000 budget
    expect(r.pilot).toEqual({ level: 5, xp: 0 })
  })

  it('bounds the per-save rise against elapsed time', () => {
    // prev level 5 (1200 total), stamped 10s ago → budget = MAX_XP_RATE*10 = 1000 XP.
    // acceptedTotal = 1200 + 1000 = 2200; cumulative to level 6 is 2000, to level 7 is 3080,
    // so 2200 → { level: 6, xp: 200 }.
    const prev = { pilot: { level: 5, xp: 0 }, _pilotAt: NOW - 10_000 }
    const r = guardPilotGrowth({ level: 20, xp: 0 }, prev, NOW)
    expect(r.pilot).toEqual({ level: 6, xp: 200 })
  })

  it('never lets total XP fall below the stored value (monotonic)', () => {
    const prev = { pilot: { level: 8, xp: 100 }, _pilotAt: NOW - 1000 }
    const r = guardPilotGrowth({ level: 2, xp: 0 }, prev, NOW) // client claims LOWER
    expect(r.pilot).toEqual({ level: 8, xp: 100 }) // floored to the stored total
  })
})

describe('visitedCities sanitization', () => {
  it('whitelists real megacity names, dedupes, and keeps insertion order', () => {
    const clean = sanitizeProgress({
      visitedCities: ['Seoul', 'Seoul', 'Atlantis', 'Tokyo', 42, 'São Paulo'],
    })
    expect(clean.visitedCities).toEqual(['Seoul', 'Tokyo', 'São Paulo'])
  })

  it('defaults to an empty array when absent or malformed', () => {
    expect(sanitizeProgress({}).visitedCities).toEqual([])
    expect(sanitizeProgress({ visitedCities: 'Seoul' }).visitedCities).toEqual([])
  })
})

describe('economy guard field passthrough', () => {
  it('preserves non-economy fields (visitedCities) through the guarded spread', () => {
    const g = guardEconomyGrowth({ credits: 0, earned: 0, visitedCities: ['Seoul'] }, null, 1_000_000)
    expect(g.visitedCities).toEqual(['Seoul'])
  })
})
