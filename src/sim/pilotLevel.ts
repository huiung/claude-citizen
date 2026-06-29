// Pilot Level — the active progression spine: hunting and quests earn XP; levels grant power and
// access. Pure + deterministic (mirrors ranks.ts / journey.ts). Career Rank (ranks.ts) is a SEPARATE
// ladder — lifetime-earnings prestige + the credit bonus. This is the combat/quest growth axis.
import type { PirateTier } from './pirates'

export interface PilotProgress {
  level: number // 1-based
  xp: number    // XP into the CURRENT level (the remainder carries on level-up)
}

export const MAX_LEVEL = 20        // spine defined to 20; this slice only authors content to 5
export const SLICE_LEVEL_CAP = 5   // the vertical slice's content ceiling

export function emptyPilot(): PilotProgress {
  return { level: 1, xp: 0 }
}

/** XP needed to advance FROM `level` to `level + 1`. Gentle curve so 1→5 is one focused session. */
export function xpForLevel(level: number): number {
  if (level >= MAX_LEVEL) return Infinity
  return 60 * level + 20 * level * level // 1→2:80, 2→3:200, 3→4:360, 4→5:560
}

export interface XpResult {
  progress: PilotProgress
  leveledUp: number[] // the new level numbers reached, in order (empty if none)
}

export function addXp(p: PilotProgress, amount: number): XpResult {
  let level = p.level
  let xp = p.xp + Math.max(0, amount)
  const leveledUp: number[] = []
  while (level < MAX_LEVEL && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level)
    level += 1
    leveledUp.push(level)
  }
  if (level >= MAX_LEVEL) xp = 0
  return { progress: { level, xp }, leveledUp }
}

export interface LevelUnlock {
  hullBonus: number            // flat hull added at this level (felt-but-minor power bump)
  weaponDamageBonus: number    // flat projectile damage added at this level (PvE only — see main.ts)
  unlockSector: number | null  // sector index opened at this level, or null
  unlockUpgradeTier: number | null // raises the purchasable upgrade ceiling, or null
}

export function unlocksForLevel(level: number): LevelUnlock {
  return {
    hullBonus: (level - 1) * 5,
    weaponDamageBonus: (level - 1) * 1, // starting value, tuned live; base PROJECTILE_DAMAGE is 12
    unlockSector: level >= 5 ? 2 : null,
    unlockUpgradeTier: level >= 5 ? 5 : null,
  }
}

export function xpForKill(tier: PirateTier): number {
  return tier === 'named' ? 200 : tier === 'elite' ? 35 : 10
}

const STORAGE_KEY = 'scc.pilot.v1'

export function loadPilot(storage: Storage): PilotProgress {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyPilot()
    const p = JSON.parse(raw)
    if (typeof p?.level !== 'number' || typeof p?.xp !== 'number') return emptyPilot()
    return { level: Math.min(MAX_LEVEL, Math.max(1, Math.floor(p.level))), xp: Math.max(0, p.xp) }
  } catch {
    return emptyPilot()
  }
}

export function savePilot(p: PilotProgress, storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode) — progression is ephemeral then */
  }
}
