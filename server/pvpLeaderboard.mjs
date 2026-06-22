import { LEADERBOARD_MAX_RANK, LEADERBOARD_PAGE_SIZE } from './leaderboard.mjs'
import { createHash } from 'crypto'

export const PVP_KILL_AUDIT_LIMIT = 200

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

function isWalletKey(key) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key ?? ''))
}

export function mergePvpStats(progress, previousEntry) {
  if (!previousEntry?.pvp) return progress
  return { ...progress, pvp: cleanStats(previousEntry.pvp) }
}

export function recordRankedPvpKill(store, { killerKey, killerName, victimKey, victimName, now }) {
  if (!isWalletKey(killerKey) || !isWalletKey(victimKey)) return false
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

function auditHash(key) {
  return createHash('sha256').update(String(key ?? '')).digest('hex').slice(0, 12)
}

function cleanAuditName(name) {
  return String(name ?? 'PILOT').slice(0, 16)
}

function cleanAuditHash(hash) {
  const text = String(hash ?? '').toLowerCase()
  return /^[a-f0-9]{12}$/.test(text) ? text : auditHash(text)
}

function cleanAuditRow(raw) {
  if (raw?.zone !== 'ranked') return null
  return {
    at: Math.max(0, Math.floor(Number(raw.at) || 0)),
    zone: 'ranked',
    killerName: cleanAuditName(raw.killerName),
    victimName: cleanAuditName(raw.victimName),
    killerHash: cleanAuditHash(raw.killerHash),
    victimHash: cleanAuditHash(raw.victimHash),
    reward: Math.max(0, Math.floor(Number(raw.reward) || 0)),
    killerBalance: Math.max(0, Math.floor(Number(raw.killerBalance) || 0)),
    victimBalance: Math.max(0, Math.floor(Number(raw.victimBalance) || 0)),
  }
}

export function createPvpKillAuditLog(limit = PVP_KILL_AUDIT_LIMIT, seed) {
  const safeLimit = Math.max(1, Math.min(PVP_KILL_AUDIT_LIMIT, Math.floor(Number(limit) || PVP_KILL_AUDIT_LIMIT)))
  const rows = (Array.isArray(seed?.rows) ? seed.rows : [])
    .map(cleanAuditRow)
    .filter(Boolean)
    .slice(0, safeLimit)
  return {
    record(event) {
      if (event?.zone !== 'ranked') return null
      const row = {
        at: Math.max(0, Math.floor(Number(event.now) || Date.now())),
        zone: 'ranked',
        killerName: cleanAuditName(event.killerName),
        victimName: cleanAuditName(event.victimName),
        killerHash: auditHash(event.killerKey),
        victimHash: auditHash(event.victimKey),
        reward: Math.max(0, Math.floor(Number(event.reward) || 0)),
        killerBalance: Math.max(0, Math.floor(Number(event.killerBalance) || 0)),
        victimBalance: Math.max(0, Math.floor(Number(event.victimBalance) || 0)),
      }
      rows.unshift(row)
      rows.splice(safeLimit)
      return row
    },
    snapshot() {
      return {
        rows: rows.map((row) => ({ ...row })),
        total: rows.length,
        limit: safeLimit,
      }
    },
  }
}

function pvpScore(entry) {
  const pvp = cleanStats(entry?.pvp)
  return pvp
}

function shortWallet(key) {
  const text = String(key ?? '')
  if (!isWalletKey(text)) return null
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

export function pvpLeaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const ranked = Object.entries(store)
    .filter(([key, entry]) => isWalletKey(key) && pvpScore(entry).rankedKills > 0)
    .sort(([, a], [, b]) => {
      const ap = pvpScore(a)
      const bp = pvpScore(b)
      return (bp.rankedKills - ap.rankedKills)
        || (bp.bestRankedStreak - ap.bestRankedStreak)
        || (ap.rankedDeaths - bp.rankedDeaths)
        || (bp.lastRankedKillAt - ap.lastRankedKillAt)
    })
    .slice(0, LEADERBOARD_MAX_RANK)
    .map(([key, entry], index) => {
      const pvp = pvpScore(entry)
      const callsign = entry.name ?? 'PILOT'
      const wallet = shortWallet(key)
      const row = {
        rank: index + 1,
        name: wallet ? `${callsign} (${wallet})` : callsign,
        kills: pvp.rankedKills,
        deaths: pvp.rankedDeaths,
        streak: pvp.rankedStreak,
        bestStreak: pvp.bestRankedStreak,
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
