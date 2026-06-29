import { isOperatorBotEntry, LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'

// NOTE: pilot level/XP is CLIENT-REPORTED via the ordinary 'save' sync, but the save handler now
// bounds its per-save growth with `guardPilotGrowth` (server/progress.mjs) — a rate cap mirroring
// Career's `guardEconomyGrowth` — so a fabricated save can't instantly inflate level/xp here. This
// is a rate cap, not full authority: the server doesn't observe individual PvE kills, so sustained
// cheating is merely slowed and made conspicuous rather than impossible.

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

// Reattach the client-reported campaign that sanitizeProgress strips. Like pilot, campaign is
// client-reported (not server-owned), so it is read from the raw save `source`, not from `prev`.
// Lower-bound clamps only (step >= 0, progress >= 0, sectorUnlocked >= 1); the upper bound on `step`
// is enforced client-side by loadCampaign (src/sim/campaign.ts) — the server can't import that TS
// module, so it avoids duplicating the SECTOR1_CAMPAIGN step-count constant. Returns a fresh object
// (mirrors mergePilotStats). NOTE: client-reported, not yet server-validated — a follow-up may guard it.
export function mergeCampaignStats(progress, source) {
  const c = source?.campaign
  if (!c || typeof c.step !== 'number') return progress
  return {
    ...progress,
    campaign: {
      step: Math.max(0, Math.floor(c.step)),
      progress: Math.max(0, Math.floor(c.progress ?? 0)),
      sectorUnlocked: Math.max(1, Math.floor(c.sectorUnlocked ?? 1)),
    },
  }
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
