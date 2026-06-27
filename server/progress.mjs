const CRAFTING_COSMETICS = new Set(['aurum-trail-kit', 'nebula-hull-kit', 'comet-wake-kit', 'void-runner-kit'])
const CRAFTING_RARITIES = new Set(['common', 'rare', 'epic', 'legendary'])
const CRAFTING_VARIANTS = {
  'aurum-trail-kit': {
    common: 'Standard Aurum Trail',
    rare: 'Blue Aurum Trail',
    epic: 'Solar Aurum Trail',
    legendary: 'Radiant Aurum Trail',
  },
  'nebula-hull-kit': {
    common: 'Pale Nebula Hull',
    rare: 'Azure Nebula Hull',
    epic: 'Violet Nebula Hull',
    legendary: 'Supernova Nebula Hull',
  },
  'comet-wake-kit': {
    common: 'Dust Comet Wake',
    rare: 'Ion Comet Wake',
    epic: 'Solar Comet Wake',
    legendary: 'Celestial Comet Wake',
  },
  'void-runner-kit': {
    common: 'Void Runner Matte',
    rare: 'Void Runner Cyan',
    epic: 'Void Runner Eclipse',
    legendary: 'Void Runner Singularity',
  },
}

function defaultVariant(recipeId, rarity) {
  return CRAFTING_VARIANTS[recipeId]?.[rarity] ?? 'Crafted Cosmetic'
}

function sanitizeCraftedItem(value) {
  if (!value || typeof value !== 'object') return null
  const recipeId = typeof value.recipeId === 'string' ? value.recipeId.slice(0, 48) : ''
  const rarity = typeof value.rarity === 'string' ? value.rarity.slice(0, 16) : ''
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 96) : ''
  if (!id || !CRAFTING_COSMETICS.has(recipeId) || !CRAFTING_RARITIES.has(rarity)) return null
  const variant = typeof value.variant === 'string' && value.variant.trim()
    ? value.variant.trim().slice(0, 64)
    : defaultVariant(recipeId, rarity)
  return {
    id,
    recipeId,
    rarity,
    variant,
    createdAt: Math.max(0, Math.floor(Number(value.createdAt) || 0)),
    tradable: value.tradable !== false,
  }
}

function migrateLegacyCosmetics(value, offset) {
  const raw = Array.isArray(value) ? value : []
  const items = []
  for (const legacyId of raw) {
    const recipeId = typeof legacyId === 'string' ? legacyId.slice(0, 48) : ''
    if (!CRAFTING_COSMETICS.has(recipeId) || items.some((item) => item.recipeId === recipeId)) continue
    items.push({
      id: `legacy-${recipeId}-${offset + items.length}`,
      recipeId,
      rarity: 'common',
      variant: defaultVariant(recipeId, 'common'),
      createdAt: 0,
      tradable: true,
    })
  }
  return items
}

export function sanitizeCrafting(value) {
  const cores = Math.max(0, Math.min(999_999, Math.floor(Number(value?.cores) || 0)))
  const raw = Array.isArray(value?.items) ? value.items : []
  const items = []
  const seen = new Set()
  for (const rawItem of raw) {
    const item = sanitizeCraftedItem(rawItem)
    if (!item || seen.has(item.id)) continue
    items.push(item)
    seen.add(item.id)
    if (items.length >= 200) break
  }
  if (items.length < 200) {
    for (const item of migrateLegacyCosmetics(value?.cosmetics, items.length)) {
      if (seen.has(item.id)) continue
      items.push(item)
      seen.add(item.id)
      if (items.length >= 200) break
    }
  }
  const rawEquipped = value?.equipped && typeof value.equipped === 'object' ? value.equipped : {}
  const ids = new Set(items.map((it) => it.id))
  const equipped = { trail: null, hull: null, aura: null }
  for (const slot of ['trail', 'hull', 'aura']) {
    const id = rawEquipped[slot]
    if (typeof id === 'string' && ids.has(id)) equipped[slot] = id
  }
  const pityCount = Math.max(0, Math.min(20, Math.floor(Number(value?.pityCount) || 0)))
  return { cores, items, equipped, pityCount }
}

function sanitizeDaily(value) {
  const v = value && typeof value === 'object' ? value : {}
  const dateStr = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '')
  const claimed = Array.isArray(v.claimed)
    ? [...new Set(v.claimed.filter((x) => typeof x === 'string').map((x) => x.slice(0, 32)))].slice(0, 3)
    : []
  return {
    day: dateStr(v.day),
    claimed,
    setBonusClaimed: v.setBonusClaimed === true,
    streak: Math.max(0, Math.min(9999, Math.floor(Number(v.streak) || 0))),
    lastStreakDay: dateStr(v.lastStreakDay),
  }
}

/** Accept only the small, known progress shape - never trust the client blindly. */
export function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null
  const credits = Number(p.credits) || 0
  return {
    credits,
    // Lifetime earnings drive rank; older saves without it seed from current balance.
    earned: typeof p.earned === 'number' && p.earned >= 0 ? Number(p.earned) : credits,
    cargo: { ORE: Number(p.cargo?.ORE) || 0, ALLOY: Number(p.cargo?.ALLOY) || 0 },
    upgrades: {
      cargo: Number(p.upgrades?.cargo) || 0,
      speed: Number(p.upgrades?.speed) || 0,
      boost: Number(p.upgrades?.boost) || 0,
      mining: Number(p.upgrades?.mining) || 0,
    },
    hangar: {
      selected: String(p.hangar?.selected ?? 'hauler').slice(0, 16),
      owned: Array.isArray(p.hangar?.owned) ? p.hangar.owned.slice(0, 16).map((t) => String(t).slice(0, 16)) : ['hauler'],
    },
    crafting: sanitizeCrafting(p.crafting),
    daily: sanitizeDaily(p.daily),
  }
}

// --- Economy anti-cheat -----------------------------------------------------
// `earned` (lifetime, monotonic) is the Career leaderboard score, and `credits` feeds the
// cosmetic → marketplace → $CITIZEN path — so a fabricated value on either is high-stakes. The
// server bounds how fast EITHER can rise per save: at most MAX_EARN_RATE credits per second of
// SERVER-measured elapsed time (the window is capped so a long absence can't bank a huge budget).
// Spending — credits going DOWN — is always free. The client's absolute numbers are advisory; the
// server owns the accepted value. This single rule replaces ad-hoc per-save / daily caps.
// Rate covers legit bursts (a full-cargo sale is ~14k in one save) while the small window caps a
// single save at RATE*WINDOW = 600k, closing the first-save/offline-return hole. The bound is
// real-elapsed × rate, so spamming saves can't inflate it — fabricating 40M needs ~1.1h of real
// time (no longer instant, and a score climbing at exactly max-rate is easy to spot).
export const MAX_EARN_RATE = 10_000        // credits/sec accepted increase
export const MAX_EARN_WINDOW_SEC = 60      // elapsed cap → at most +600k accepted per save
export const CAREER_SCRUB_CEILING = 10_000_000 // one-time boot clamp (just above the ~8M legit top)

/**
 * Bound the per-save rise of `earned`/`credits` against a server-measured time budget. `prev` is the
 * previously stored row (or null on a first save); `nowMs` is the server clock. A missing/legacy
 * `prev._careerAt` grants one full window of budget. Returns a NEW row (clean + accepted earned/
 * credits + refreshed `_careerAt`). Pure — no I/O, no clock reads.
 */
export function guardEconomyGrowth(clean, prev, nowMs) {
  const prevEarned = Math.max(0, Number(prev?.earned) || 0)
  const prevCredits = Math.max(0, Number(prev?.credits) || 0)
  const prevAt = Number(prev?._careerAt)
  const lastAt = Number.isFinite(prevAt) ? prevAt : nowMs - MAX_EARN_WINDOW_SEC * 1000
  const elapsedSec = Math.min(MAX_EARN_WINDOW_SEC, Math.max(0, (nowMs - lastAt) / 1000))
  const budget = MAX_EARN_RATE * elapsedSec
  const claimedEarned = Number(clean.earned) || 0
  const claimedCredits = Number(clean.credits) || 0
  // earned is lifetime/monotonic: never below prev, never more than prev + budget.
  const earned = Math.min(Math.max(claimedEarned, prevEarned), prevEarned + budget)
  // credits may fall freely (spending); only a RISE is bounded by the same budget.
  const credits = claimedCredits <= prevCredits ? claimedCredits : Math.min(claimedCredits, prevCredits + budget)
  return { ...clean, earned, credits, _careerAt: nowMs }
}

/**
 * One-time boot hygiene: clamp pre-guard rows (no `_careerAt`) whose earned/credits exceed `ceiling`
 * down to it and stamp them, so an exploit that landed before the guard existed drops off the
 * leaderboard. Rows already stamped earned their value legitimately under the guard and are left
 * alone. Mutates `store`; returns the scrubbed rows for audit logging.
 */
export function scrubCareerOutliers(store, nowMs, ceiling = CAREER_SCRUB_CEILING) {
  const scrubbed = []
  for (const [key, row] of Object.entries(store ?? {})) {
    if (!row || typeof row !== 'object' || Number.isFinite(row._careerAt)) continue
    const earned = Number(row.earned) || 0
    const credits = Number(row.credits) || 0
    if (earned > ceiling || credits > ceiling) {
      row.earned = Math.min(earned, ceiling)
      row.credits = Math.min(credits, ceiling)
      row._careerAt = nowMs
      scrubbed.push({ key, earned, credits })
    }
  }
  return scrubbed
}
