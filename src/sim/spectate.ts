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
export function pickFollowTarget(peers: FollowPeer[], currentId: string | null, botName = 'CLAUDE'): string | null {
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
