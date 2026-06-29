import { isOperatorBotEntry, LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'

function isWalletKey(key) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key ?? ''))
}

function shortWallet(key) {
  const text = String(key ?? '')
  if (!isWalletKey(text)) return null
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function cleanRaceStats(raw) {
  const bestTimeMs = Math.max(0, Math.floor(Number(raw?.bestTimeMs) || 0))
  return {
    bestTimeMs,
    finishes: Math.max(0, Math.floor(Number(raw?.finishes) || 0)),
    lastFinishAt: Math.max(0, Math.floor(Number(raw?.lastFinishAt) || 0)),
  }
}

function ensureEntry(store, key, name) {
  if (!key) return null
  const entry = store[key] && typeof store[key] === 'object' ? store[key] : {}
  entry.name = String(name ?? entry.name ?? 'PILOT').slice(0, 16)
  entry.race = cleanRaceStats(entry.race)
  store[key] = entry
  return entry
}

export function mergeRaceStats(progress, previousEntry) {
  if (!previousEntry?.race) return progress
  return { ...progress, race: cleanRaceStats(previousEntry.race) }
}

export function recordRankedRaceFinish(store, { key, name, timeMs, now }) {
  const safeTime = Math.max(0, Math.floor(Number(timeMs) || 0))
  if (!key || safeTime <= 0) return false
  const entry = ensureEntry(store, key, name)
  if (!entry) return false
  entry.race.finishes += 1
  entry.race.lastFinishAt = Math.max(0, Math.floor(Number(now) || 0))
  if (entry.race.bestTimeMs <= 0 || safeTime < entry.race.bestTimeMs) {
    entry.race.bestTimeMs = safeTime
  }
  return true
}

export function raceLeaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const ranked = Object.entries(store)
    .filter(([, entry]) => cleanRaceStats(entry?.race).bestTimeMs > 0)
    .filter(([key, entry]) => !isOperatorBotEntry(key, entry))
    .sort(([keyA, a], [keyB, b]) => {
      const ar = cleanRaceStats(a?.race)
      const br = cleanRaceStats(b?.race)
      return (ar.bestTimeMs - br.bestTimeMs)
        || (br.finishes - ar.finishes)
        || (br.lastFinishAt - ar.lastFinishAt)
        || String(keyA).localeCompare(String(keyB))
    })
    .slice(0, LEADERBOARD_MAX_RANK)
    .map(([key, entry], index) => {
      const race = cleanRaceStats(entry.race)
      const callsign = entry.name ?? 'PILOT'
      const wallet = shortWallet(key)
      const row = {
        rank: index + 1,
        name: wallet ? `${callsign} (${wallet})` : callsign,
        timeMs: race.bestTimeMs,
        finishes: race.finishes,
      }
      if (wallet) {
        row.wallet = wallet
        row.callsign = callsign
      }
      return row
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
