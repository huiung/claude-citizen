// Pure daily-objective + login-streak logic. No THREE, no DOM. Tested in daily.test.ts.

/** UTC 'YYYY-MM-DD' for an epoch-ms timestamp. */
export function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

export type ObjectiveKind =
  | 'mine_ore' | 'kill_pirates' | 'deliver_contracts' | 'earn_credits' | 'dock_outposts'

export interface Objective {
  /** Stable per kind — used as the claimed key (each kind appears at most once/day). */
  id: string
  kind: ObjectiveKind
  target: number
  label: string
}

interface PoolEntry { kind: ObjectiveKind; target: number; label: string }

const OBJECTIVE_POOL: PoolEntry[] = [
  { kind: 'mine_ore', target: 300, label: 'Mine 300 ORE' },
  { kind: 'kill_pirates', target: 6, label: 'Destroy 6 pirates' },
  { kind: 'deliver_contracts', target: 2, label: 'Complete 2 delivery contracts' },
  { kind: 'earn_credits', target: 40_000, label: 'Earn 40,000 credits' },
  { kind: 'dock_outposts', target: 3, label: 'Dock 3 times' },
]

/** Deterministic PRNG (same pattern as contracts.ts). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic 3-distinct-kind objective set for a UTC day key. */
export function dailyObjectives(key: string): Objective[] {
  const rng = mulberry32(hashString(key))
  const pool = OBJECTIVE_POOL.slice()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
  }
  return pool.slice(0, 3).map((e) => ({ id: e.kind, kind: e.kind, target: e.target, label: e.label }))
}
