import { isOperatorBotEntry, LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'

function isWalletKey(key) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key ?? ''))
}

function shortWallet(key) {
  const text = String(key ?? '')
  if (!isWalletKey(text)) return null
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function cleanBlackHoleStats(raw) {
  return {
    // smallest survived center-distance; 0 means "no record yet"
    bestDistance: Math.max(0, Math.floor(Number(raw?.bestDistance) || 0)),
    dives: Math.max(0, Math.floor(Number(raw?.dives) || 0)),
    lastDiveAt: Math.max(0, Math.floor(Number(raw?.lastDiveAt) || 0)),
  }
}

function ensureEntry(store, key, name) {
  if (!key) return null
  const entry = store[key] && typeof store[key] === 'object' ? store[key] : {}
  entry.name = String(name ?? entry.name ?? 'PILOT').slice(0, 16)
  entry.blackHole = cleanBlackHoleStats(entry.blackHole)
  store[key] = entry
  return entry
}

export function mergeBlackHoleStats(progress, previousEntry) {
  if (!previousEntry?.blackHole) return progress
  return { ...progress, blackHole: cleanBlackHoleStats(previousEntry.blackHole) }
}

export function recordBlackHoleRun(store, { key, name, distance, now }) {
  const safe = Math.max(0, Math.floor(Number(distance) || 0))
  if (!key || safe <= 0) return false
  const entry = ensureEntry(store, key, name)
  if (!entry) return false
  entry.blackHole.dives += 1
  entry.blackHole.lastDiveAt = Math.max(0, Math.floor(Number(now) || 0))
  if (entry.blackHole.bestDistance <= 0 || safe < entry.blackHole.bestDistance) {
    entry.blackHole.bestDistance = safe
  }
  return true
}

export function blackHoleLeaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const ranked = Object.entries(store)
    .filter(([, entry]) => cleanBlackHoleStats(entry?.blackHole).bestDistance > 0)
    .filter(([key, entry]) => isWalletKey(key) && !isOperatorBotEntry(key, entry))
    .sort(([keyA, a], [keyB, b]) => {
      const as = cleanBlackHoleStats(a?.blackHole)
      const bs = cleanBlackHoleStats(b?.blackHole)
      return (as.bestDistance - bs.bestDistance)   // smaller = closer = better (ascending)
        || (bs.dives - as.dives)
        || (bs.lastDiveAt - as.lastDiveAt)
        || String(keyA).localeCompare(String(keyB))
    })
    .slice(0, LEADERBOARD_MAX_RANK)
    .map(([key, entry], index) => {
      const stats = cleanBlackHoleStats(entry.blackHole)
      const callsign = entry.name ?? 'PILOT'
      const wallet = shortWallet(key)
      const row = {
        rank: index + 1,
        name: wallet ? `${callsign} (${wallet})` : callsign,
        distance: stats.bestDistance,
        dives: stats.dives,
      }
      if (wallet) {
        row.wallet = wallet
        row.callsign = callsign
      }
      return row
    })

  const safeOffset = Math.min(Math.max(0, Math.floor(offset)), LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE)
  return {
    rows: ranked.slice(safeOffset, safeOffset + LEADERBOARD_PAGE_SIZE),
    total: ranked.length,
    offset: safeOffset,
    limit: LEADERBOARD_PAGE_SIZE,
    maxRank: LEADERBOARD_MAX_RANK,
  }
}
