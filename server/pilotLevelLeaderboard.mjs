import { isOperatorBotEntry, LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'

// NOTE: pilot level/XP is CLIENT-REPORTED via the ordinary 'save' sync and is NOT yet
// server-validated (unlike Career's `earned`, which `guardEconomyGrowth` bounds). A
// fabricated save could inflate level/xp here. A follow-up should add a server-authoritative
// XP guard (e.g. bound per-save XP gain against server-recorded kills/quests). Scope boundary
// for this slice: read what the client reports, mirror the existing leaderboard pattern.

function isWalletKey(key) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key ?? ''))
}

function shortWallet(key) {
  const text = String(key ?? '')
  if (!isWalletKey(text)) return null
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function cleanPilotStats(raw) {
  return {
    level: Math.max(0, Math.floor(Number(raw?.level) || 0)),
    xp: Math.max(0, Math.floor(Number(raw?.xp) || 0)),
  }
}

// Pilot level/XP rides the ordinary progress save (client-reported). `sanitizeProgress` strips
// unknown fields, so re-attach the sanitized pilot block from the raw client save here — mirrors
// the way mergeRaceStats/mergeBlackHoleStats re-attach server-side stats onto a clean progress row.
export function mergePilotStats(progress, source) {
  if (!source?.pilot) return progress
  return { ...progress, pilot: cleanPilotStats(source.pilot) }
}

function pilotScore(entry) {
  return cleanPilotStats(entry?.pilot)
}

export function pilotLevelLeaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const entries = Object.entries(store)
    .filter(([, entry]) => pilotScore(entry).level > 0)
    .filter(([key, entry]) => !isOperatorBotEntry(key, entry))

  // Same callsign/wallet dedup as Career: a wallet row claims its callsign, hiding weaker anon
  // rows that share it (PILOT is exempt — it's the default name many anons keep).
  const bestWalletScoreByName = new Map()
  for (const [key, entry] of entries) {
    if (!isWalletKey(key)) continue
    const name = String(entry.name ?? 'PILOT').trim().toLowerCase()
    if (name === 'pilot') continue
    const stats = pilotScore(entry)
    const prev = bestWalletScoreByName.get(name)
    if (!prev || stats.level > prev.level || (stats.level === prev.level && stats.xp > prev.xp)) {
      bestWalletScoreByName.set(name, stats)
    }
  }

  const ranked = entries
    .filter(([key, entry]) => {
      if (isWalletKey(key)) return true
      const name = String(entry.name ?? 'PILOT').trim().toLowerCase()
      const walletScore = bestWalletScoreByName.get(name)
      if (walletScore === undefined) return true
      const stats = pilotScore(entry)
      return stats.level > walletScore.level
        || (stats.level === walletScore.level && stats.xp > walletScore.xp)
    })
    .sort(([keyA, a], [keyB, b]) => {
      const ap = pilotScore(a)
      const bp = pilotScore(b)
      return (bp.level - ap.level)
        || (bp.xp - ap.xp)
        || String(keyA).localeCompare(String(keyB))
    })
    .slice(0, LEADERBOARD_MAX_RANK)
    .map(([key, entry], index) => {
      const stats = pilotScore(entry)
      const callsign = entry.name ?? 'PILOT'
      const wallet = shortWallet(key)
      const row = {
        rank: index + 1,
        name: wallet ? `${callsign} (${wallet})` : callsign,
        level: stats.level,
        xp: stats.xp,
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
