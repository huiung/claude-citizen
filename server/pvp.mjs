export const PVP_ZONE = { x: -850, y: -260, z: -3600, radius: 1250 }
export const PVP_HIT_RANGE = 900
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

export function isInPvpZone(p) {
  if (!Array.isArray(p) || p.length < 3) return false
  const dx = Number(p[0]) - PVP_ZONE.x
  const dy = Number(p[1]) - PVP_ZONE.y
  const dz = Number(p[2]) - PVP_ZONE.z
  return dx * dx + dy * dy + dz * dz <= PVP_ZONE.radius * PVP_ZONE.radius
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
  if (!isInPvpZone(attacker.p) || !isInPvpZone(target.p)) return { ok: false, reason: 'outside-zone' }
  if (distanceSq(attacker.p, target.p) > PVP_HIT_RANGE * PVP_HIT_RANGE) return { ok: false, reason: 'too-far' }
  if ((target.hull ?? 0) <= 0) return { ok: false, reason: 'dead-target' }

  const ship = normalizeShip(attacker.ship)
  const weapon = PVP_SHIPS[ship].weapon
  const lastHitAt = attacker.lastPvpHitAt ?? 0
  if (now - lastHitAt < weapon.interval * 1000 * 0.75) return { ok: false, reason: 'cooldown' }
  attacker.lastPvpHitAt = now

  const targetMaxHull = target.maxHull ?? PVP_SHIPS[normalizeShip(target.ship)].hull
  target.hull = Math.max(0, (target.hull ?? targetMaxHull) - weapon.damage)
  const hullAfterDamage = target.hull
  const killed = hullAfterDamage <= 0
  const reward = killed ? pvpRewardForPair(rewardMemory, attacker.id, target.id, now) : 0
  if (killed) resetPvpHull(target, target.ship)

  return {
    ok: true,
    damage: weapon.damage,
    killed,
    reward,
    hull: hullAfterDamage,
    maxHull: targetMaxHull,
  }
}
