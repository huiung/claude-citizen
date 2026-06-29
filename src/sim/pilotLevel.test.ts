import { describe, expect, it } from 'vitest'
import {
  MAX_LEVEL, addXp, emptyPilot, loadPilot, savePilot, unlocksForLevel, xpForKill, xpForLevel,
} from './pilotLevel'

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

describe('xpForLevel', () => {
  it('rises with level and caps at MAX_LEVEL', () => {
    expect(xpForLevel(2)).toBeGreaterThan(xpForLevel(1))
    expect(xpForLevel(MAX_LEVEL)).toBe(Infinity)
  })

  // Concrete pins: the server mirrors this curve in server/progress.mjs (cumulativeXp/levelForTotal)
  // and its drift test asserts the SAME totals. Pinning the per-level values here means a change to
  // this formula fails CI unless the server copy is updated to match — keeping the two in lockstep.
  it('pins the exact per-level XP cost', () => {
    expect(xpForLevel(1)).toBe(80)
    expect(xpForLevel(2)).toBe(200)
    expect(xpForLevel(3)).toBe(360)
    expect(xpForLevel(4)).toBe(560)
  })
})

describe('addXp', () => {
  it('accumulates XP without leveling when below threshold', () => {
    const r = addXp(emptyPilot(), 10)
    expect(r.progress.level).toBe(1)
    expect(r.progress.xp).toBe(10)
    expect(r.leveledUp).toEqual([])
  })

  it('levels up and carries the remainder', () => {
    const need = xpForLevel(1)
    const r = addXp(emptyPilot(), need + 5)
    expect(r.progress.level).toBe(2)
    expect(r.progress.xp).toBe(5)
    expect(r.leveledUp).toEqual([2])
  })

  it('handles multiple level-ups from one big award', () => {
    const big = xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + 1
    const r = addXp(emptyPilot(), big)
    expect(r.progress.level).toBe(4)
    expect(r.leveledUp).toEqual([2, 3, 4])
  })

  it('never goes negative on a negative award', () => {
    const r = addXp({ level: 1, xp: 5 }, -100)
    expect(r.progress.xp).toBe(5)
  })
})

describe('unlocksForLevel', () => {
  it('opens Sector 2 and a higher upgrade tier at level 5', () => {
    expect(unlocksForLevel(4).unlockSector).toBeNull()
    expect(unlocksForLevel(5).unlockSector).toBe(2)
    expect(unlocksForLevel(5).unlockUpgradeTier).toBe(5)
  })

  it('grants no combat bonus at level 1 and scales monotonically', () => {
    expect(unlocksForLevel(1).hullBonus).toBe(0)
    expect(unlocksForLevel(1).weaponDamageBonus).toBe(0)
    expect(unlocksForLevel(2).hullBonus).toBeGreaterThan(unlocksForLevel(1).hullBonus)
    expect(unlocksForLevel(2).weaponDamageBonus).toBeGreaterThan(unlocksForLevel(1).weaponDamageBonus)
    expect(unlocksForLevel(5).hullBonus).toBeGreaterThan(unlocksForLevel(4).hullBonus)
    expect(unlocksForLevel(5).weaponDamageBonus).toBeGreaterThan(unlocksForLevel(4).weaponDamageBonus)
  })

  it('matches the combat-bonus formulas at sample levels', () => {
    expect(unlocksForLevel(5).hullBonus).toBe(20)         // (5-1)*5
    expect(unlocksForLevel(5).weaponDamageBonus).toBe(4)  // (5-1)*1
    expect(unlocksForLevel(20).hullBonus).toBe(95)        // (20-1)*5
    expect(unlocksForLevel(20).weaponDamageBonus).toBe(19)
  })
})

describe('xpForKill', () => {
  it('rewards tougher tiers more', () => {
    expect(xpForKill('named')).toBeGreaterThan(xpForKill('elite'))
    expect(xpForKill('elite')).toBeGreaterThan(xpForKill('grunt'))
  })
})

describe('persistence', () => {
  it('round-trips and clamps bad data', () => {
    const s = memStorage()
    savePilot({ level: 3, xp: 40 }, s)
    expect(loadPilot(s)).toEqual({ level: 3, xp: 40 })
    s.setItem('scc.pilot.v1', '{"level":-2,"xp":-9}')
    expect(loadPilot(s)).toEqual({ level: 1, xp: 0 })
  })
})
