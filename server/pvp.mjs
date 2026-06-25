export const PVP_RANKED_MIN_TOKEN_BALANCE = 1000
export const PVP_ZONES = {
  practice: { id: 'practice', x: 92000, y: 26000, z: -210000, radius: 1800 },
  ranked: { id: 'ranked', x: 96000, y: 26000, z: -214000, radius: 2200 },
}
export const PVP_ZONE = PVP_ZONES.practice
export const PVP_HIT_RANGE = 900
/** A pilot stays hittable out-of-zone for this long after the last hit dealt or taken (pursuit window). */
export const PVP_COMBAT_TAG_MS = 10000
export const PVP_KILL_REWARD = 180
export const PVP_REPEAT_REWARD_COOLDOWN_MS = 5 * 60 * 1000

export const PVP_SHIPS = {
  hauler: { hull: 100, weapon: { damage: 10, interval: 0.18 } },
  fighter: { hull: 70, weapon: { damage: 12, interval: 0.16 } },
  miner: { hull: 160, weapon: { damage: 16, interval: 0.22 } },
  interceptor: { hull: 60, weapon: { damage: 9, interval: 0.14 } },
}

export function normalizeShip(type) {
  return Object.hasOwn(PVP_SHIPS, type) ? type : 'hauler'
}

export function resetPvpHull(client, ship = client.ship) {
  client.ship = normalizeShip(ship)
  client.maxHull = PVP_SHIPS[client.ship].hull
  client.hull = client.maxHull
}

export function applyPvpRespawn(client, { p, q, ship } = {}) {
  if (!client?.active) return { ok: false, reason: 'inactive' }
  if ((client.hull ?? 0) > 0) return { ok: false, reason: 'alive' }
  if (Array.isArray(p) && p.length >= 3) client.p = p.slice(0, 3).map(Number)
  if (Array.isArray(q) && q.length >= 4) client.q = q.slice(0, 4).map(Number)
  resetPvpHull(client, ship ?? client.ship)
  client.lastPvpCombatAt = null // a respawned pilot is no longer combat-tagged (fresh start)
  return { ok: true, hull: client.hull, maxHull: client.maxHull }
}

function isInsideZone(p, zone) {
  if (!Array.isArray(p) || p.length < 3) return false
  const dx = Number(p[0]) - zone.x
  const dy = Number(p[1]) - zone.y
  const dz = Number(p[2]) - zone.z
  return dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius
}

export function pvpZoneAt(p) {
  return Object.values(PVP_ZONES).find((zone) => isInsideZone(p, zone)) ?? null
}

export function isInPvpZone(p) {
  return pvpZoneAt(p) !== null
}

export function rankedPvpAccess(holderBalance) {
  return Number(holderBalance) >= PVP_RANKED_MIN_TOKEN_BALANCE
}

function distanceSq(a, b) {
  const dx = Number(a[0]) - Number(b[0])
  const dy = Number(a[1]) - Number(b[1])
  const dz = Number(a[2]) - Number(b[2])
  return dx * dx + dy * dy + dz * dz
}

export function pvpRewardForPair(rewardMemory, attackerId, targetId, now) {
  const key = `${attackerId}:${targetId}`
  const last = rewardMemory.get(key)
  if (last !== undefined && now - last < PVP_REPEAT_REWARD_COOLDOWN_MS) return 0
  rewardMemory.set(key, now)
  return PVP_KILL_REWARD
}

export function applyPvpHit({ attacker, target, now, rewardMemory }) {
  if (!attacker || !target || attacker === target) return { ok: false, reason: 'bad-target' }
  if (!attacker.active || !target.active) return { ok: false, reason: 'inactive' }
  const attackerZone = pvpZoneAt(attacker.p)
  const targetZone = pvpZoneAt(target.p)
  const sameZone = attackerZone && targetZone && attackerZone.id === targetZone.id
  const bothTagged = (attacker.lastPvpCombatAt != null && now - attacker.lastPvpCombatAt < PVP_COMBAT_TAG_MS)
    && (target.lastPvpCombatAt != null && now - target.lastPvpCombatAt < PVP_COMBAT_TAG_MS)
  // A fight can only START in-zone (seeds the tag); once both are tagged, a close pursuit may leave the zone.
  if (!sameZone && !bothTagged) return { ok: false, reason: 'outside-zone' }
  // Ranked access stays enforced whenever either party is in the ranked zone.
  if ((attackerZone?.id === 'ranked' || targetZone?.id === 'ranked')
    && (!rankedPvpAccess(attacker.holderBalance) || !rankedPvpAccess(target.holderBalance))) {
    return { ok: false, reason: 'ranked-locked' }
  }
  if (distanceSq(attacker.p, target.p) > PVP_HIT_RANGE * PVP_HIT_RANGE) return { ok: false, reason: 'too-far' }
  if ((target.hull ?? 0) <= 0) return { ok: false, reason: 'dead-target' }

  const ship = normalizeShip(attacker.ship)
  const weapon = PVP_SHIPS[ship].weapon
  const lastHitAt = attacker.lastPvpHitAt ?? 0
  if (now - lastHitAt < weapon.interval * 1000 * 0.75) return { ok: false, reason: 'cooldown' }
  attacker.lastPvpHitAt = now
  attacker.lastPvpCombatAt = now
  target.lastPvpCombatAt = now

  const targetMaxHull = target.maxHull ?? PVP_SHIPS[normalizeShip(target.ship)].hull
  target.hull = Math.max(0, (target.hull ?? targetMaxHull) - weapon.damage)
  const hullAfterDamage = target.hull
  const killed = hullAfterDamage <= 0
  const reward = killed ? pvpRewardForPair(rewardMemory, attacker.id, target.id, now) : 0

  return {
    ok: true,
    damage: weapon.damage,
    killed,
    reward,
    hull: hullAfterDamage,
    maxHull: targetMaxHull,
  }
}
