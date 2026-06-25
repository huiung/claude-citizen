const CRAFTING_COSMETICS = new Set(['aurum-trail-kit', 'nebula-hull-kit', 'void-runner-kit'])
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
  }
}
