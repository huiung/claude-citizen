import { LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'

function cleanStats(raw) {
  return {
    rankedKills: Math.max(0, Math.floor(Number(raw?.rankedKills) || 0)),
    rankedDeaths: Math.max(0, Math.floor(Number(raw?.rankedDeaths) || 0)),
    rankedStreak: Math.max(0, Math.floor(Number(raw?.rankedStreak) || 0)),
    bestRankedStreak: Math.max(0, Math.floor(Number(raw?.bestRankedStreak) || 0)),
    lastRankedKillAt: Math.max(0, Math.floor(Number(raw?.lastRankedKillAt) || 0)),
  }
}

function ensureEntry(store, key, name) {
  if (!key) return null
  const entry = store[key] && typeof store[key] === 'object' ? store[key] : {}
  entry.name = String(name ?? entry.name ?? 'PILOT').slice(0, 16)
  entry.pvp = cleanStats(entry.pvp)
  store[key] = entry
  return entry
}

export function mergePvpStats(progress, previousEntry) {
  if (!previousEntry?.pvp) return progress
  return { ...progress, pvp: cleanStats(previousEntry.pvp) }
}

export function recordRankedPvpKill(store, { killerKey, killerName, victimKey, victimName, now }) {
  const killer = ensureEntry(store, killerKey, killerName)
  const victim = ensureEntry(store, victimKey, victimName)
  if (!killer || !victim || killerKey === victimKey) return false

  killer.pvp.rankedKills += 1
  killer.pvp.rankedStreak += 1
  killer.pvp.bestRankedStreak = Math.max(killer.pvp.bestRankedStreak, killer.pvp.rankedStreak)
  killer.pvp.lastRankedKillAt = Math.max(0, Math.floor(Number(now) || 0))

  victim.pvp.rankedDeaths += 1
  victim.pvp.rankedStreak = 0
  return true
}

function pvpScore(entry) {
  const pvp = cleanStats(entry?.pvp)
  return pvp
}

export function pvpLeaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const ranked = Object.values(store)
    .filter((entry) => pvpScore(entry).rankedKills > 0)
    .sort((a, b) => {
      const ap = pvpScore(a)
      const bp = pvpScore(b)
      return (bp.rankedKills - ap.rankedKills)
        || (bp.bestRankedStreak - ap.bestRankedStreak)
        || (ap.rankedDeaths - bp.rankedDeaths)
        || (bp.lastRankedKillAt - ap.lastRankedKillAt)
    })
    .slice(0, LEADERBOARD_MAX_RANK)
    .map((entry, index) => {
      const pvp = pvpScore(entry)
      return {
        rank: index + 1,
        name: entry.name ?? 'PILOT',
        kills: pvp.rankedKills,
        deaths: pvp.rankedDeaths,
        streak: pvp.rankedStreak,
        bestStreak: pvp.bestRankedStreak,
      }
    })

  const safeOffset = Math.min(Math.max(0, Math.floor(offset)), LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE)
  const safeLimit = LEADERBOARD_PAGE_SIZE
  return {
    rows: ranked.slice(safeOffset, safeOffset + safeLimit),
    total: ranked.length,
    offset: safeOffset,
    limit: safeLimit,
    maxRank: LEADERBOARD_MAX_RANK,
  }
}
