// Pure helpers for Browse (spectator) mode: who to follow and what they're doing. No DOM/THREE
// side effects — positions are plain [x,y,z] tuples so this unit-tests cleanly.

export interface FollowPeer {
  id: string
  name: string
  position: [number, number, number] // interpolated world position
  lastActiveAt: number               // ms timestamp of the peer's most recent update
}

/** Pick whom Browse should follow. Priority: the showcase bot (name === botName) → else the most
 *  recently active peer → else null (caller falls back to the hub orbit). */
// _currentId: reserved for signature stability; the caller only invokes this when there is no live target to keep, so no stability/anti-thrash clause is needed here.
export function pickFollowTarget(peers: FollowPeer[], _currentId: string | null, botName = 'CLAUDE'): string | null {
  if (peers.length === 0) return null
  const bot = peers.find((p) => p.name === botName)
  if (bot) return bot.id
  let best = peers[0]
  for (const p of peers) if (p.lastActiveAt > best.lastActiveAt) best = p
  return best.id
}

/** Step to the next/prev peer id for manual cycling (wraps). currentId unchanged if no peers;
 *  first peer if currentId is null or not in the list. */
export function cycleFollowTarget(peers: FollowPeer[], currentId: string | null, dir: 1 | -1): string | null {
  if (peers.length === 0) return currentId
  const ids = peers.map((p) => p.id)
  const i = currentId ? ids.indexOf(currentId) : -1
  if (i < 0) return ids[0]
  return ids[(i + dir + ids.length) % ids.length]
}

export interface ActivityZone { label: string; center: [number, number, number]; radius: number }

/** Describe a pilot's activity by fixed-zone proximity: the label of the first zone whose center is
 *  within its radius (pass zones in priority order), else `fallback`. Mining isn't position-inferable
 *  (the ore belt streams around each pilot), so the bot's own chat carries that play-by-play. */
export function describePilotActivity(
  position: [number, number, number],
  zones: ActivityZone[],
  fallback = 'cruising deep space',
): string {
  const [x, y, z] = position
  for (const zone of zones) {
    const dx = x - zone.center[0], dy = y - zone.center[1], dz = z - zone.center[2]
    if (dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius) return zone.label
  }
  return fallback
}
